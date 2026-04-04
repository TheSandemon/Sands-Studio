export {}

// ── DreamState types (cross-process) ────────────────────────────────────────

export type HabitatLogEventType =
  | 'terminal:output' | 'agent:event' | 'habitat:applied' | 'shell:added'
  | 'shell:removed' | 'context:compacted' | 'skill:compiled' | 'hook:fired'
  | 'app:started' | 'app:closing'

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
  terminalBuffers: Record<string, string>
  creatureMemories: Record<string, CreatureMemory>
  creatureNotes: Record<string, string>
  eventCount: number
  previousSnapshotTimestamp?: number
}

export interface LastActiveHabitat {
  habitatId: string
  habitatName: string
  closedAt: number
  snapshotTimestamp: number
}

export interface CompactionResult {
  creatureId: string
  round: number
  summaryLength: number
  messageCountBefore: number
  messageCountAfter: number
  notesExtracted: boolean
  timestamp: number
}

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
  content: string
  annotations: { compactionRound: number; sourceCreatureId: string }
}

export type PluginPermission =
  | 'filesystem:read' | 'filesystem:write' | 'http:GET' | 'http:POST' | 'http:ALL'
export type PluginHookName =
  | 'onAgentEvent' | 'onContextCompacted' | 'onTerminalOutput'
  | 'onSnapshotWritten' | 'onAppClose' | 'onSkillCompiled'

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
}

// ── HabitatComms types (cross-process) ───────────────────────────────────────

export type AgentStatus = 'active' | 'listening' | 'blocked' | 'inactive'
export type MessageType = 'direct' | 'broadcast' | 'thread' | 'intent' | 'handoff' | 'status_update'

export interface HabitatMessage {
  id: string
  type: MessageType
  sender: string
  senderName: string
  recipients?: string[]
  threadId?: string
  content: string
  intent?: IntentPayload
  timestamp: number
  ttl: number
  expires_at?: number
}

export interface IntentPayload {
  type: 'file_edit' | 'task' | 'context_handoff' | 'flowchart_node'
  target: string
  claimedBy: string
  expiresAt: number
}

export interface AgentStatusInfo {
  id: string
  name: string
  status: AgentStatus
  lastSeen: number
  currentIntent?: IntentPayload
  threadCount: number
  unreadCount: number
}

export interface FileEditEvent {
  creatureId: string
  filePath: string
  timestamp: number
  command?: string
}

export interface CollisionResult {
  hasCollision: boolean
  editingCreatures: Array<{ id: string; name: string; startedAt: number }>
  collisionWindowMs: number
}

export interface HandoffBundle {
  sourceId: string
  targetId: string
  summary: string
  recentMessages: HabitatMessage[]
  notes: string
  timestamp: number
}

export interface SendMessageInput {
  type: MessageType
  sender: string
  senderName: string
  recipients?: string[]
  threadId?: string
  content: string
  intent?: IntentPayload
  ttl?: number
}

export interface MessageQueryOpts {
  since?: number
  type?: MessageType
  limit?: number
}

// Window API interfaces
export interface HabitatlogAPI {
  getLastActive: () => Promise<LastActiveHabitat | null>
  writeSnapshot: (snapshot: HabitatSnapshot) => Promise<void>
  writeEvent: (event: HabitatLogEvent) => Promise<void>
  getSnapshot: (habitatId: string) => Promise<HabitatSnapshot | null>
}

export interface ContextAPI {
  compact: (opts: { creatureId: string }) => Promise<CompactionResult>
  getNotes: (opts: { creatureId: string }) => Promise<string | null>
  getMessageCount: (opts: { creatureId: string }) => Promise<number>
  incrementMessageCount: (opts: { creatureId: string }) => Promise<void>
  startAutoCompact: (opts: { creatureId: string; intervalMs?: number }) => Promise<void>
  stopAutoCompact: (opts: { creatureId: string }) => Promise<void>
}

export interface HookAPI {
  register: (hook: Hook) => Promise<void>
  unregister: (opts: { hookId: string }) => Promise<void>
  enable: (opts: { hookId: string }) => Promise<void>
  disable: (opts: { hookId: string }) => Promise<void>
  list: () => Promise<Hook[]>
}

export interface PluginAPI {
  discover: () => Promise<DiscoveredPlugin[]>
  load: (opts: { pluginId: string }) => Promise<LoadedPlugin | null>
  unload: (opts: { pluginId: string }) => Promise<void>
  callHook: (opts: { hookName: string; args?: unknown }) => Promise<void>
}

export interface SkillAPI {
  compile: (opts: { creatureId: string; name: string; triggers?: string[]; description?: string }) => Promise<CompiledSkill>
  list: (opts?: { creatureId?: string }) => Promise<SkillManifest[]>
  load: (opts: { path: string }) => Promise<CompiledSkill | null>
  delete: (opts: { path: string }) => Promise<void>
}

export interface HabitatCommsAPI {
  registerAgent: (creatureId: string, name: string) => Promise<void>
  unregisterAgent: (creatureId: string) => Promise<void>
  send: (input: SendMessageInput) => Promise<HabitatMessage>
  sendDirect: (recipientId: string, senderId: string, senderName: string, content: string) => Promise<HabitatMessage>
  broadcast: (senderId: string, senderName: string, content: string) => Promise<HabitatMessage>
  reply: (threadId: string, senderId: string, senderName: string, content: string) => Promise<HabitatMessage>
  getMessages: (creatureId: string, opts?: MessageQueryOpts) => Promise<HabitatMessage[]>
  getThread: (threadId: string) => Promise<HabitatMessage[]>
  getRecent: (creatureId: string, limit?: number) => Promise<HabitatMessage[]>
  getStatus: () => Promise<AgentStatusInfo[]>
  setStatus: (creatureId: string, status: AgentStatus) => Promise<void>
  claimIntent: (creatureId: string, intent: IntentPayload) => Promise<{ ok: boolean; collision?: CollisionResult }>
  releaseIntent: (creatureId: string, intentType: string, target: string) => Promise<void>
  checkIntents: (target: string) => Promise<IntentPayload[]>
  recordFileEdit: (event: FileEditEvent) => Promise<CollisionResult>
  checkCollision: (filePath: string, windowMs?: number) => Promise<CollisionResult>
  buildHandoff: (sourceId: string, targetId: string) => Promise<HandoffBundle>
  sendHandoff: (targetId: string, bundle: HandoffBundle) => Promise<HabitatMessage>
  onMessage: (cb: (msg: HabitatMessage) => void) => () => void
  onStatusChange: (cb: (info: AgentStatusInfo) => void) => () => void
  onCollision: (cb: (result: CollisionResult) => void) => () => void
}

// ── Global window augmentation ──────────────────────────────────────────────

declare global {
  interface Window {
    habitatlogAPI: HabitatlogAPI
    habitatCommsAPI: HabitatCommsAPI
    contextAPI: ContextAPI
    hookAPI: HookAPI
    pluginAPI: PluginAPI
    skillAPI: SkillAPI
    windowAPI: {
      minimize: () => void
      maximize: () => void
      close: () => void
    }
    terminalAPI: {
      create: (id: string, options?: object) => Promise<string>
      createWithConfig: (id: string, config: object, cols?: number, rows?: number) => Promise<string>
      write: (id: string, data: string) => void
      resize: (id: string, cols: number, rows: number) => void
      kill: (id: string) => Promise<void>
      onData: (cb: (id: string, data: string) => void) => () => void
      onExit: (cb: (id: string, code: number) => void) => () => void
      onBatchCreated: (cb: (sessions: unknown[]) => void) => () => void
    }
    habitatAPI: {
      apply: (habitat: object) => Promise<{ ok?: boolean; canceled?: boolean }>
      export: (habitat: object) => Promise<{ ok?: boolean; canceled?: boolean; path?: string }>
      import: () => Promise<{ ok?: boolean; canceled?: boolean; habitat?: object }>
      clear: () => Promise<{ ok: boolean }>
      trackHabitats: (habitatIds: string[]) => Promise<{ ok: boolean }>
      getCurrentHabitatId: () => Promise<string | null>
      getCurrentHabitatName: () => Promise<string>
      selectProject: () => Promise<{ ok?: boolean; canceled?: boolean; projectPath?: string }>
    }
    flowchartAPI: {
      read: (filePath: string) => Promise<{ ok: boolean; text?: string; mtime?: number; error?: string }>
      write: (filePath: string, text: string) => Promise<{ ok: boolean; error?: string }>
      watch: (filePath: string) => Promise<{ ok: boolean; error?: string }>
      unwatch: () => Promise<{ ok: boolean }>
      find: (cwd: string) => Promise<{ ok: boolean; files: string[]; error?: string }>
      scan: (cwd: string, opts?: { maxDepth?: number; forceRefresh?: boolean }) => Promise<{ ok: boolean; mermaid: string; tree: unknown[]; rootId: string; cached?: boolean; error?: string }>
      getCwd: () => Promise<string>
      onChanged: (cb: (payload: { text: string; mtime: number }) => void) => () => void
    }
    agentAPI: {
      start: (terminalId: string, message: string, defaults?: { model?: string; baseURL?: string }) => Promise<void>
      stop: (terminalId: string) => void
      onEvent: (cb: (terminalId: string, type: string, payload: unknown) => void) => () => void
      save: (agent: object) => Promise<{ ok: boolean; error?: string }>
      list: () => Promise<unknown[]>
      load: (id: string, habitatId: string, shellIndex: number) => Promise<unknown>
      delete: (id: string) => Promise<{ ok: boolean }>
    }
    creatureAPI: {
      loadMemory: (id: string) => Promise<CreatureMemory | null>
      saveMemory: (id: string, memory: CreatureMemory) => Promise<void>
    }
    moduleAPI: {
      listModules: () => Promise<string[]>
      loadModule: (id: string) => Promise<{ manifest: unknown; worldState: unknown; agents: unknown[]; assetPaths: Record<string, string> }>
      startModule: (defaults?: { model?: string; apiKey?: string; baseURL?: string }) => Promise<void>
      stopModule: () => void
      pauseModule: () => void
      resumeModule: () => void
      hasSnapshot: (moduleId: string) => Promise<boolean>
      resumeFromSnapshot: (moduleId: string, defaults?: { model?: string; apiKey?: string; baseURL?: string }) => Promise<void>
      unloadModule: () => void
      scanAssets: (moduleId: string, assetsPath: string) => Promise<{ tiles: string[]; entities: string[]; effects: string[] }>
      getBootstrapQuestions: (scenarioPrompt: string, opts?: { model?: string; apiKey?: string; baseURL?: string }) => Promise<{ questions: Array<{ id: string; question: string; placeholder?: string }> }>
      getQuestionSuggestions: (question: string, scenario: string, opts?: { model?: string; apiKey?: string; baseURL?: string }) => Promise<{ suggestions: string[] }>
      generateModuleConfig: (moduleId: string, prompt: string, opts?: { model?: string; apiKey?: string; baseURL?: string }) => Promise<{ manifest: unknown; world: unknown; agents: unknown[] }>
      saveModule: (id: string, data: { manifest: unknown; world: unknown; agents: unknown[] }) => Promise<string>
      getModuleConfig: (moduleId: string) => Promise<{ manifest: unknown; agents: unknown[] }>
      saveConfigChanges: (moduleId: string, changes: { manifest?: object; agents?: Array<{ id: string; [key: string]: unknown }> }) => Promise<{ ok: boolean }>
      onEvent: (cb: (event: unknown) => void) => () => void
      onState: (cb: (state: unknown) => void) => () => void
      onAgentStatus: (cb: (roleId: string, status: string) => void) => () => void
      onStatus: (cb: (status: string) => void) => () => void
      onAgentLog: (cb: (entry: unknown) => void) => () => void
      onStats: (cb: (stats: unknown) => void) => () => void
      onManifest: (cb: (manifest: unknown, assetPaths: Record<string, string>) => void) => () => void
    }
  }

  interface MCPServer {
    name: string
    url: string
    enabled: boolean
  }

  interface CreatureMemory {
    id: string
    name?: string
    specialty?: string
    provider?: 'anthropic' | 'openai'
    apiKey?: string
    baseURL?: string
    /** Model ID to use for this creature (e.g. the value from Settings → Default Model). */
    model?: string
    role?: string
    skills?: string[]
    autonomy?: { enabled: boolean; intervalMs: number; goal: string }
    /** MCP server configs — stored now, activated in a future phase. */
    mcpServers?: MCPServer[]
    hatched: boolean
    eggStep?: number
    createdAt: string
    spriteId?: string
    messages: unknown[]
  }
}
