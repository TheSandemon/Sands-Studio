// =============================================================================
// DreamState Types — shared between main process and renderer
// Cross-process safe: no Node.js APIs, no React imports, no runtime dependencies
// =============================================================================

// ── HabitatLogEvent + Snapshot ───────────────────────────────────────────────

export type HabitatLogEventType =
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

export interface HabitatLogEvent {
  type: HabitatLogEventType
  sessionId?: string
  timestamp: number
  payload?: unknown
}

export interface HabitatSnapshot {
  type: 'snapshot'
  version: 1
  habitatId: string
  habitatName: string
  timestamp: number
  terminalBuffers: Record<string, string> // sessionId -> base64 xterm buffer
  creatureMemories: Record<string, CreatureMemory>
  creatureNotes: Record<string, string> // creatureId -> notes.md content
  eventCount: number
  previousSnapshotTimestamp?: number
}

export interface LastActiveHabitat {
  habitatId: string
  habitatName: string
  closedAt: number
  snapshotTimestamp: number
}

// ── Hook System ────────────────────────────────────────────────────────────────

export type HookTriggerType = 'event' | 'pattern' | 'schedule' | 'context'

export type HookCondition =
  | { type: 'event-type'; eventType: HabitatLogEventType }
  | { type: 'regex'; pattern: string; sourceField: 'chunk' | 'event' | 'payload' }
  | { type: 'cron'; expression: string }
  | { type: 'context-compacted' }

export type HookAction =
  | { type: 'log'; message: string }
  | { type: 'compact'; creatureId: string }
  | { type: 'skill'; skillPath: string; args?: string }
  | { type: 'shell'; command: string; sessionId?: string }
  | { type: 'http'; url: string; method: 'GET' | 'POST'; body?: string }
  | { type: 'plugin'; pluginId: string; method: string; args?: unknown }

export interface Hook {
  id: string
  name: string
  description?: string
  trigger: HookTriggerType
  condition: HookCondition
  action: HookAction
  enabled: boolean
  createdAt: number
}

export interface HookMatch {
  hook: Hook
  matchedValue?: string
}

// ── Context Manager ────────────────────────────────────────────────────────────

export interface CompactionResult {
  creatureId: string
  round: number
  summaryLength: number
  messageCountBefore: number
  messageCountAfter: number
  notesExtracted: boolean
  timestamp: number
}

// ── Skill Compiler ─────────────────────────────────────────────────────────────

export interface SkillManifest {
  id: string
  name: string
  description?: string
  triggers: string[]
  creatureId: string
  createdAt: number
  path: string
}

export interface CompiledSkill {
  manifest: SkillManifest
  content: string // SKILL.md content
  annotations: { compactionRound: number; sourceCreatureId: string }
}

// ── Plugin Registry ─────────────────────────────────────────────────────────────

export type PluginPermission =
  | 'filesystem:read'
  | 'filesystem:write'
  | 'http:GET'
  | 'http:POST'
  | 'http:ALL'

export type PluginHookName =
  | 'onAgentEvent'
  | 'onContextCompacted'
  | 'onTerminalOutput'
  | 'onSnapshotWritten'
  | 'onAppClose'
  | 'onSkillCompiled'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  entry: string
  permissions: PluginPermission[]
  hooks: PluginHookName[]
  author?: string
}

export interface DiscoveredPlugin {
  id: string
  manifest: PluginManifest
  rootPath: string
}

export interface LoadedPlugin {
  id: string
  manifest: PluginManifest
  instance: object
  registeredHooks: Map<PluginHookName, Function>
}

// ── CreatureMemory ─────────────────────────────────────────────────────────────

export interface CoreMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: unknown
  annotations?: unknown
}

export interface CreatureMemory {
  id: string
  name?: string
  specialty?: string
  apiKey?: string
  baseURL?: string
  model?: string
  mcpServers?: Array<{ name: string; url: string; enabled: boolean }>
  hatched: boolean
  createdAt: string
  messages: CoreMessage[]
  compactionRounds: number
  lastCompactedAt?: string
  notesPath?: string
  skillsPaths?: string[]
}
