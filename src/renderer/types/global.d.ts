export {}

declare global {
  interface Window {
    windowAPI: {
      minimize: () => void
      maximize: () => void
      close: () => void
    }
    terminalAPI: {
      create: (id: string, options?: object) => Promise<string>
      write: (id: string, data: string) => void
      resize: (id: string, cols: number, rows: number) => void
      kill: (id: string) => Promise<void>
      onData: (cb: (id: string, data: string) => void) => () => void
      onExit: (cb: (id: string, code: number) => void) => () => void
    }
    agentAPI: {
      start: (terminalId: string, message: string, defaults?: { model?: string; baseURL?: string }) => Promise<void>
      stop: (terminalId: string) => void
      onEvent: (cb: (terminalId: string, type: string, payload: unknown) => void) => () => void
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
    apiKey?: string
    baseURL?: string
    /** Model ID to use for this creature (e.g. the value from Settings → Default Model). */
    model?: string
    /** MCP server configs — stored now, activated in a future phase. */
    mcpServers?: MCPServer[]
    hatched: boolean
    createdAt: string
    messages: unknown[]
  }
}
