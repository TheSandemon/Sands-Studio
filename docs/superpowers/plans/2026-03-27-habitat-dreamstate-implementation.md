# Habitat DreamState — Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Build DreamState: auto-saving habitat log, session snapshots, auto-restore on startup, AI context compaction, skill compilation, hooks, and plugin registry.

**Architecture:** 5 composable main-process classes communicating through typed interfaces in `src/shared/dreamstate-types.ts`. Storage: JSONL for logs, JSON snapshots, filesystem for skills/hooks/plugins.

**Tech Stack:** Electron, TypeScript, node-pty, xterm.js v5, Zustand, filesystem JSON.

---

## Phase 1: HabitatLog + Auto-Restore

### Task 1: Create `src/shared/dreamstate-types.ts`
All shared interfaces: HabitatLogEvent, Hook, HookAction, CompactionResult, CompiledSkill, PluginManifest, etc.

### Task 2: Create `src/main/habitat-log.ts`
HabitatLog class: write events to JSONL, write/read snapshots, log rotation, last-active tracking.

### Task 3: Modify `src/main/index.ts`
Register IPC handlers for habitatlog API. On `before-quit`: write last-active pointer. On `whenReady`: read last-active and signal renderer to restore.

### Task 4: Modify `src/preload/index.ts` and `src/renderer/types/global.d.ts`
Expose `habitatlogAPI` on window via contextBridge. Add types.

### Task 5: Modify `src/renderer/App.tsx` and `TerminalPane.tsx`
Add `serializeBuffer()` method to TerminalPane via `useImperativeHandle`. In App.tsx: on mount, call `habitatlogAPI.getLastActive()` and `habitatAPI.apply()` to restore. On `beforeunload`, gather buffers and call `habitatlogAPI.writeSnapshot()`.

### Task 6: Modify `HabitatSaveDialog.tsx`
After successful save, emit `habitat:applied` event via `habitatlogAPI.writeEvent()`.

### Task 7: Modify `useTerminalStore.ts`
Add `messageCount` per terminal, `incrementMessageCount()`, `setMessageCount()` for compaction triggers.

---

## Phase 2: ContextManager

### Task 8: Create `src/main/context-manager.ts`
ContextManager class: compact() uses AI to summarize conversation history, extractNotes() writes notes.md, startAutoCompact() sets interval timer, save()/static load() persist CreatureMemory.

### Task 9: Wire ContextManager in main process
Register IPC handlers for compact, getNotes, getMessageCount, startAutoCompact, stopAutoCompact. Expose `contextAPI` in preload and global.d.ts. Wire from agent-runner: after message exchange, call `contextAPI.incrementMessageCount()` which checks threshold and fires compact if needed.

---

## Phase 3: SkillCompiler + HookRegistry

### Task 10: Create `src/main/skill-compiler.ts`
SkillCompiler class: compile() generates SKILL.md from compacted context + notes, writes to `~/.terminal-habitat/skills/{creatureId}/{skill-id}/`, updates registry.json. Static listSkills(), loadSkill(), deleteSkill().

### Task 11: Create `src/main/hook-registry.ts`
HookRegistry class: register/unregister/enable/disable hooks, evaluate() matches events against conditions, executeMatch() runs hook actions, loadFromDisk()/saveToDisk() persist to `~/.terminal-habitat/hooks/registry.json`. Wire into main process IPC and into habitatlog:write-event handler so events trigger hook evaluation.

---

## Phase 4: PluginRegistry

### Task 12: Create `src/main/plugin-registry.ts`
PluginRegistry class: discover() scans plugin directories for valid plugin.json manifests, load() requires entry file in sandbox, unload() cleans up, callHook() invokes registered hooks on all loaded plugins with 5s timeout. Wire into main process IPC.

---

## Phase 5: DreamState UI

### Task 13: Create DreamStatePanel component + wire into App/MenuBar
Tabbed panel: Log | Context | Skills | Hooks | Plugins. Log tab shows recent events. Context tab shows per-creature message counts + manual compact button. Skills tab lists compiled skills. Hooks tab lists/creates/deletes/enables hooks. Plugins tab lists discovered plugins. Wire into App.tsx state and MenuBar as a new "DreamState" menu entry.
