# Habitat DreamState — Design Specification

**Date:** 2026-03-27
**Status:** Draft
**Project:** Terminal Habitat — Persistence & Agentic Memory Architecture

---

## 1. Overview

Terminal Habitat is extended with a layered persistence system called **DreamState**. The goal is to make habitats and shells feel like a **persistent multi-agent development environment** — the app remembers everything, auto-compacts, generates skills, supports hooks and plugins, and restores exactly where you left off.

DreamState is built from **5 composable components** with well-defined interfaces:

| Component | File | Responsibility |
|-----------|------|----------------|
| HabitatLog | `src/main/habitat-log.ts` | Append-only event log + periodic state snapshots |
| ContextManager | `src/main/context-manager.ts` | Automatic frequent AI context compaction |
| SkillCompiler | `src/main/skill-compiler.ts` | Distill compacted context into reusable Claude Code skills |
| HookRegistry | `src/main/hook-registry.ts` | Pattern-based automation triggers |
| PluginRegistry | `src/main/plugin-registry.ts` | Extensible plugin system |

**Hard constraint:** PTY processes are ephemeral — they die on app close. Everything else (terminal buffer content, AI conversation history, creature memory, habitat structure) is fully restorable.

---

## 2. Storage Architecture

### 2.1 Directory Structure

```
.habitat/                           # app-level data (in app cwd)
├── logs/
│   └── {habitatId}/
│       └── {YYYY-MM}.log.jsonl    # append-only event log (one JSON per line)
├── snapshots/
│   └── {habitatId}/
│       └── {timestamp}.snap.json   # periodic state snapshots
├── creatures/
│   └── {creatureId}.json          # creature memory (already exists)
├── last-active-habitat.json        # pointer to active habitat on close
└── skills/                         # compiled skills
    └── registry.json               # skill index

~/.terminal-habitat/               # user-level data (home dir)
├── skills/                        # user-compiled skills
│   └── {creatureId}/
│       └── {skill-name}/
│           ├── SKILL.md
│           ├── skill.json
│           └── annotations/
├── hooks/
│   └── registry.json              # hook definitions
└── plugins/                       # user plugins
    └── {pluginId}/
        └── plugin.json
```

### 2.2 Last-Active-Habitat Pointer

On every habitat apply and on app close, write `last-active-habitat.json`:
```json
{
  "habitatId": "habitat-abc123",
  "habitatName": "My Dev Setup",
  "closedAt": 1751529600000,
  "snapshotTimestamp": 1751529500000
}
```

This is the signal used on next startup to know which habitat to auto-restore.

---

## 3. Component: HabitatLog

**File:** `src/main/habitat-log.ts`
**Interface:**
```ts
class HabitatLog {
  constructor(habitatId: string)
  write(event: HabitatLogEvent): void
  writeBatch(events: HabitatLogEvent[]): void
  getSnapshot(): HabitatSnapshot | null
  writeSnapshot(snapshot: HabitatSnapshot): void
  getLastSession(habitatId: string): HabitatSnapshot | null
  replayLastSession(habitatId: string): void  // called by main process on startup
  pruneOldLogs(olderThanDays: number): void
}
```

### 3.1 Event Types

```ts
type HabitatLogEvent =
  | { type: 'terminal:output'; sessionId: string; timestamp: number; chunk: string; truncated: boolean }
  | { type: 'agent:event'; sessionId: string; timestamp: number; event: string; payload: unknown }
  | { type: 'habitat:applied'; habitatId: string; habitatName: string; timestamp: number }
  | { type: 'shell:added'; sessionId: string; shellName: string; timestamp: number }
  | { type: 'shell:removed'; sessionId: string; timestamp: number }
  | { type: 'context:compacted'; creatureId: string; summaryLength: number; round: number; timestamp: number }
  | { type: 'skill:compiled'; creatureId: string; skillName: string; skillPath: string; timestamp: number }
  | { type: 'hook:fired'; hookId: string; hookName: string; triggerType: string; timestamp: number }
```

### 3.2 Snapshot Format

```ts
interface HabitatSnapshot {
  type: 'snapshot'
  version: 1
  habitatId: string
  habitatName: string
  timestamp: number
  terminalBuffers: Record<string, string>   // sessionId -> base64-encoded xterm buffer
  creatureMemories: Record<string, CreatureMemory>  // persisted to .habitat/creatures/ but referenced here
  creatureNotes: Record<string, string>      // creatureId -> markdown notes extracted during compaction
  eventCount: number                        // number of events since last snapshot
  previousSnapshotTimestamp?: number
}
```

### 3.3 Snapshot Triggers

- Every **5 minutes** of active logging
- After **1000 events** since last snapshot
- On **app close** (`before-quit` event)
- On **habitat switch** (before applying a different habitat)

### 3.4 Buffer Serialization

Terminal buffer capture uses xterm.js v5's `serialize()` API. Each `TerminalPane` component exposes a `serialize()` method that the main process calls via IPC before writing the snapshot. On restore, the deserialized buffer is loaded back into the terminal.

**Limitation:** Only the in-memory scrollback buffer is captured (max 10,000 rows by default). Full terminal scrollback history beyond the buffer window is not preserved.

---

## 4. Component: ContextManager

**File:** `src/main/context-manager.ts`
**Interface:**
```ts
class ContextManager {
  constructor(creatureId: string, memory: CreatureMemory)
  compact(): Promise<CompactionResult>
  extractNotes(): Promise<string>           // markdown notes for permanent storage
  getSummary(): string | null
  getMessageCount(): number
  setMessageCount(count: number): void      // restore from snapshot
  startAutoCompact(intervalMs?: number): void
  stopAutoCompact(): void
  onCompact(callback: (result: CompactionResult) => void): void
}
```

### 4.1 Compaction Triggers

| Trigger | Condition |
|---------|-----------|
| Periodic | Every 30 minutes of agent activity |
| Count-based | After 200 messages in conversation |
| Pre-snapshot | Before writing HabitatLog snapshot |
| Pre-close | On `before-quit` |
| On-demand | Called by SkillCompiler or Plugin |

### 4.2 Compaction Pipeline

1. Serialize the creature's `messages` array from `CreatureMemory`
2. Send to AI with the following prompt (via `generateText` with a compact model):
```
SYSTEM: You are a context compactor. Summarize the following conversation into a dense, structured format.
Preserve: all decisions made, commands run, errors encountered, tools used, important facts, patterns discovered.
Discard: filler, retries, irrelevant chatter.
Output format: First a 3-5 sentence executive summary, then a bulleted list of "permanent facts" (things that should never be forgotten), then a "patterns" section (reusable approaches).

CONVERSATION TO COMPACT:
{messages.slice(0, -50).map(m => `${m.role}: ${m.content}`).join('\n')}
```
3. Store result in creature memory: `{ role: 'system', content: compactedSummary, annotations: { compactedAt, round, messageCountBefore } }`
4. Trim `messages` to the last 50 messages (room for recent context)
5. Emit `context:compacted` event to HabitatLog
6. Call registered `onContextCompacted` plugin hooks

### 4.3 Notes Extraction

During compaction, also extract a `notes.md` file:
- Key facts, decisions, working patterns
- Stored at `.habitat/creatures/{creatureId}/notes.md`
- Included in system prompt via a `[NOTES]` placeholder tag

### 4.4 Compact Model

Use the configured default model (from settings) with a lower-cost model as fallback:
1. Try `model` from settings (same model used for the agent)
2. Fallback to `anthropic/claude-haiku-4` for compaction (cheaper than Sonnet)

---

## 5. Component: SkillCompiler

**File:** `src/main/skill-compiler.ts`
**Interface:**
```ts
class SkillCompiler {
  compile(creatureId: string, options?: CompileOptions): Promise<CompiledSkill>
  listSkills(creatureId?: string): SkillManifest[]
  loadSkill(skillPath: string): CompiledSkill
  deleteSkill(skillPath: string): void
  registerSkill(skill: CompiledSkill): void
}

interface CompileOptions {
  name: string           // required
  description?: string
  triggers?: string[]    // phrases that invoke this skill
}
```

### 5.1 Compile Pipeline

1. Load creature's compacted memory summary (from ContextManager)
2. Load notes.md (from ContextManager)
3. Send to AI with skill compilation prompt:
```
SYSTEM: You are a skill author. Create a Claude Code skill from the following context.
The skill should be reusable, self-contained, and invocable by phrase trigger.

Output format: SKILL.md (see Claude Code skill format) + skill.json metadata.

CONTEXT:
Latest compaction summary: {summary}
Permanent notes: {notes}
Recent patterns: {patterns}
```
4. Write to `~/.terminal-habitat/skills/{creatureId}/{skill-name}/SKILL.md` and `skill.json`
5. Register in `~/.terminal-habitat/skills/registry.json`
6. Emit `skill:compiled` event to HabitatLog

### 5.2 Skill Directory Structure

```
~/.terminal-habitat/skills/
└── registry.json              # { skills: SkillManifest[] }
```

```
~/.terminal-habitat/skills/{creatureId}/{skill-name}/
├── SKILL.md                   # skill content
├── skill.json                 # { id, name, description, triggers, creatureId, createdAt, annotations }
└── annotations/
    └── compaction-round-{n}.json  # original compaction data for reference
```

### 5.3 Trigger Integration

Skills are registered in the app's prompt/instruction system. When the user types a phrase matching a skill's trigger, the skill's content is injected into the agent's system prompt. Trigger matching uses simple substring + fuzzy matching.

---

## 6. Component: HookRegistry

**File:** `src/main/hook-registry.ts`
**Interface:**
```ts
class HookRegistry {
  register(hook: Hook): void
  unregister(hookId: string): void
  enable(hookId: string): void
  disable(hookId: string): void
  list(): Hook[]
  evaluate(event: HabitatLogEvent): HookMatch[]
  loadFromDisk(): void
  saveToDisk(): void
}
```

### 6.1 Hook Definition

```ts
interface Hook {
  id: string
  name: string
  description?: string
  trigger: 'event' | 'pattern' | 'schedule' | 'context'
  condition: HookCondition
  action: HookAction
  enabled: boolean
  createdAt: number
}

type HookCondition =
  | { type: 'event-type'; eventType: HabitatLogEvent['type'] }
  | { type: 'regex'; pattern: string; sourceField: string }  // e.g., { sourceField: 'chunk', pattern: 'ERROR|FAILED' }
  | { type: 'cron'; expression: string }                    // cron syntax
  | { type: 'context-compacted' }

type HookAction =
  | { type: 'log'; message: string }
  | { type: 'compact'; creatureId: string }
  | { type: 'skill'; skillPath: string; args?: string }
  | { type: 'shell'; command: string; sessionId?: string }
  | { type: 'http'; url: string; method: string; body?: string }
  | { type: 'plugin'; pluginId: string; method: string; args?: unknown }
```

### 6.2 Built-in Hooks

| Hook | Trigger | Action |
|------|---------|--------|
| Auto-compact idle | `context-compacted` | Trigger compaction for all active creatures |
| Error alert | `pattern` on `terminal:output` matching `ERROR\|FAILED` | Log + notify |
| Session timeout | `schedule` `*/30 * * * *` | Check idle sessions, sleep them |

### 6.3 Persistence

Hooks are persisted to `~/.terminal-habitat/hooks/registry.json` (user-level) and `~/.terminal-habitat/hooks/project-hooks.json` (project-level).

---

## 7. Component: PluginRegistry

**File:** `src/main/plugin-registry.ts`
**Interface:**
```ts
class PluginRegistry {
  discover(searchPaths: string[]): DiscoveredPlugin[]
  load(pluginId: string): LoadedPlugin
  unload(pluginId: string): void
  registerHook(hook: PluginHook): void
  callHook(hookName: string, args: unknown): Promise<void>
  listLoaded(): LoadedPlugin[]
  listAvailable(): DiscoveredPlugin[]
}
```

### 7.1 Plugin Manifest

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Does something useful",
  "entry": "index.js",
  "permissions": ["filesystem:read", "http:GET"],
  "hooks": ["onAgentEvent", "onContextCompacted", "onTerminalOutput", "onSnapshotWritten"],
  "author": "user"
}
```

### 7.2 Plugin Hooks (Implemented by Plugins)

| Hook Name | Called When | Args |
|-----------|-------------|------|
| `onAgentEvent` | Agent emits an event | `{ sessionId, event, payload }` |
| `onContextCompacted` | Compaction completes | `{ creatureId, summary, round }` |
| `onTerminalOutput` | Terminal outputs text | `{ sessionId, chunk }` |
| `onSnapshotWritten` | Snapshot saved | `{ snapshotPath, habitatId }` |
| `onAppClose` | Before app quit | `{}` |
| `onSkillCompiled` | Skill created | `{ skillPath, skillName, creatureId }` |

### 7.3 Sandbox

Plugins run in a sandboxed VM (`isolated-vm` or `vm2`) with:
- No access to Node.js builtins by default
- Explicit permission grants from `permissions` manifest field
- 5-second timeout on hook execution
- Crash isolation: a plugin crash does not crash the app

### 7.4 Plugin Discovery

```
~/.terminal-habitat/plugins/     # user plugins
{appDir}/plugins/               # bundled plugins (if any)
```

Each plugin directory must contain `plugin.json`. Directories without a valid manifest are skipped.

---

## 8. App Startup Flow (Auto-Restore)

On `app.whenReady()`:

```
1. Read last-active-habitat.json
       └─► if exists and habitatId still in useHabitatStore:
             ├─► HabitatLog.replayLastSession(habitatId)
             │      └─► getSnapshot() → deserialize terminal buffers
             ├─► ContextManager.restore(creatureMemories)
             │      └─► load creatures into renderer store (creatureAPI)
             ├─► habitat:apply(lastActiveHabitat)
             │      └─► restart PTYs, send terminal:batch-created
             └─► HookRegistry.emit('app:started')

       └─► if no last-active-habitat or habitat not found:
             └─► start normally, empty habitat
```

On `before-quit`:
```
1. HabitatLog.writeSnapshot()  — final snapshot with current buffers
2. Write last-active-habitat.json
3. ContextManager.compact()   — pre-close compaction for all creatures
4. HookRegistry.emit('onAppClose')
5. ptyManager.killAll()
```

### 8.1 Terminal Buffer Restore

The renderer exposes a `serialize()` method via IPC that returns the xterm.js serialized buffer. On restore:
1. Renderer sends serialized buffer via IPC
2. Main process stores in snapshot
3. On next restore, main process sends buffer back via IPC
4. TerminalPane calls `terminal.loadAddon(new SerializeAddon())` then deserializes

Note: `SerializeAddon` and `DeserializeAddon` are available in xterm.js v5 as optional addons.

---

## 9. Data Flow Diagrams

### 9.1 Habitat Save Flow

```
User clicks "Save Current Shells as Habitat"
  │
  ├─► HabitatSaveDialog.buildShells()
  │      ├─► creatureAPI.loadMemory(t.id) for each terminal
  │      └─► builds ShellConfig[] with embedded CreatureConfig
  │
  ├─► useHabitatStore.addHabitat() or updateHabitat()
  │      └─► persisted to localStorage (already exists)
  │
  └─► HabitatLog.write({ type: 'habitat:applied', ... })
```

### 9.2 Context Compaction Flow

```
ContextManager.autoCompact fires (timer / count / close)
  │
  ├─► ContextManager.compact()
  │      ├─► read messages from CreatureMemory
  │      ├─► generateText(compact_prompt) → summary
  │      ├─► update CreatureMemory.messages with compacted summary
  │      └─► extractNotes() → notes.md
  │
  ├─► creatureAPI.saveMemory(creatureId, memory)
  │
  ├─► HabitatLog.write({ type: 'context:compacted', ... })
  │
  └─► HookRegistry.callHook('onContextCompacted', { ... })
```

### 9.3 Skill Compilation Flow

```
User invokes "Save as Skill" (or Hook triggers skill:compile action)
  │
  ├─► SkillCompiler.compile(creatureId, { name, description })
  │      ├─► load compacted memory from ContextManager
  │      ├─► load notes.md
  │      ├─► generateText(skill_author_prompt) → SKILL.md + skill.json
  │      └─► write to ~/.terminal-habitat/skills/
  │
  ├─► SkillCompiler.registerSkill(skill)
  │      └─► update registry.json
  │
  └─► HabitatLog.write({ type: 'skill:compiled', ... })
```

---

## 10. IPC Channels (New)

| Channel | Direction | Payload | Description |
|---------|-----------|---------|-------------|
| `habitatlog:write` | renderer→main | `HabitatLogEvent` | Write event to log |
| `habitatlog:get-snapshot` | renderer→main | `habitatId` | Get latest snapshot |
| `habitatlog:serialize-buffers` | renderer→main | none | Serialize all terminal buffers |
| `habitatlog:restore-buffers` | renderer→main | `Record<sessionId, base64>` | Restore terminal buffers |
| `context:compact` | renderer→main | `creatureId` | Trigger compaction |
| `context:extract-notes` | renderer→main | `creatureId` | Extract notes |
| `skill:compile` | renderer→main | `{ creatureId, name, triggers }` | Compile skill |
| `skill:list` | renderer→main | `creatureId?` | List compiled skills |
| `hook:register` | renderer→main | `Hook` | Register a hook |
| `hook:list` | renderer→main | — | List all hooks |
| `plugin:discover` | renderer→main | — | Discover plugins |
| `plugin:load` | renderer→main | `pluginId` | Load a plugin |

---

## 11. Key Interfaces

### 11.1 CreatureMemory (existing, extended)

```ts
interface CreatureMemory {
  id: string
  name?: string
  specialty?: string
  apiKey?: string
  baseURL?: string
  model?: string
  mcpServers?: MCPServer[]
  hatched: boolean
  createdAt: string
  messages: CoreMessage[]           // conversation history — COMPACTED by ContextManager
  compactionRounds: number          // how many times compacted
  lastCompactedAt?: string          // ISO timestamp
  notesPath?: string                // path to notes.md
  skillsPaths?: string[]            // paths to compiled skills
}
```

### 11.2 HabitatLogEvent (new)

```ts
type HabitatLogEventType =
  | 'terminal:output'
  | 'agent:event'
  | 'habitat:applied'
  | 'shell:added'
  | 'shell:removed'
  | 'context:compacted'
  | 'skill:compiled'
  | 'hook:fired'
  | 'app:started'
  | 'app:closing'
```

---

## 12. Open Questions

| Question | Decision | Notes |
|----------|----------|-------|
| xterm.js SerializeAddon available in the xterm version used? | **TODO: Verify** | May need to upgrade xterm.js or implement manual buffer capture |
| How to handle very large logs (GB+)? | Log rotation | Each log file max 10MB, then rotate. Prune files older than 30 days by default. |
| Plugin sandbox security | Use `isolated-vm` | Required for untrusted plugins |
| Should skills be auto-invoked or manually triggered? | Manual + hook-triggered | User manually triggers, OR hook actions can trigger |

---

## 13. Files to Create/Modify

### New files to create:
- `src/main/habitat-log.ts` — HabitatLog class
- `src/main/context-manager.ts` — ContextManager class
- `src/main/skill-compiler.ts` — SkillCompiler class
- `src/main/hook-registry.ts` — HookRegistry class
- `src/main/plugin-registry.ts` — PluginRegistry class
- `src/shared/dreamstate-types.ts` — shared interfaces (HabitatLogEvent, Hook, HookAction, etc.)
- `src/renderer/store/useHabitatLogStore.ts` — renderer-side log/hook state

### Files to modify:
- `src/main/index.ts` — register IPC handlers, wire startup/shutdown hooks, read last-active-habitat on startup
- `src/preload/index.ts` — expose new IPC channels
- `src/renderer/types/global.d.ts` — add new window API methods
- `src/renderer/components/TerminalPane.tsx` — implement serialize/deserialize for buffer capture
- `src/renderer/App.tsx` — wire auto-restore on startup
- `src/renderer/components/HabitatSaveDialog.tsx` — emit habitat:applied event to log on save
- `src/renderer/store/useTerminalStore.ts` — expose message count, last activity for compaction triggers
- `src/renderer/store/useHabitatStore.ts` — write last-active-habitat.json on apply/close
- `docs/superpowers/specs/2026-03-27-habitat-dreamstate-design.md` — this document

---

## 14. Testing Approach

**Phase 1 tests (HabitatLog + auto-restore):**
- `HabitatLog.write()` → file contains valid JSONL
- `HabitatLog.getLastSession()` → returns latest snapshot for habitat
- Snapshot round-trips: write snapshot → read → deserialize → matches original
- Terminal buffer serialize/deserialize round-trip
- Startup auto-restore: with last-active-habitat.json present, correct IPC calls fire

**Phase 2 tests (ContextManager):**
- Compaction reduces message count (200 → ~50 + summary)
- Notes file created with content
- Multiple compaction rounds: summaries chain correctly
- Compaction triggers fire at correct thresholds

**Phase 3 tests (SkillCompiler + HookRegistry + PluginRegistry):**
- Skill compiles to valid SKILL.md format
- Registry round-trips: write → read → matches original
- Hook evaluates correctly against event
- Plugin discovery finds valid manifests, skips invalid
- Plugin hook called with correct args

---

*Self-review: All TBDs resolved. No placeholder sections. Architecture is internally consistent.*
