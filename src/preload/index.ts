import { contextBridge, ipcRenderer } from 'electron'

const windowAPI = {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close')
}

const terminalAPI = {
  create: (id: string, options?: object) =>
    ipcRenderer.invoke('terminal:create', id, options ?? {}),
  createWithConfig: (id: string, config: object, cols?: number, rows?: number) =>
    ipcRenderer.invoke('terminal:create-with-config', id, config, cols, rows),
  write: (id: string, data: string) =>
    ipcRenderer.send('terminal:write', id, data),
  resize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', id, cols, rows),
  kill: (id: string) =>
    ipcRenderer.invoke('terminal:kill', id),
  onData: (cb: (id: string, data: string) => void) => {
    const h = (_: Electron.IpcRendererEvent, id: string, data: string) => cb(id, data)
    ipcRenderer.on('terminal:data', h)
    return () => ipcRenderer.off('terminal:data', h)
  },
  onExit: (cb: (id: string, code: number) => void) => {
    const h = (_: Electron.IpcRendererEvent, id: string, code: number) => cb(id, code)
    ipcRenderer.on('terminal:exit', h)
    return () => ipcRenderer.off('terminal:exit', h)
  },
  onBatchCreated: (cb: (payload: { sessions: unknown[]; habitatId?: string }) => void) => {
    const h = (_: Electron.IpcRendererEvent, payload: { sessions: unknown[]; habitatId?: string }) => cb(payload)
    ipcRenderer.on('terminal:batch-created', h)
    return () => ipcRenderer.off('terminal:batch-created', h)
  },
}

const habitatAPI = {
  apply: (habitat: object) => ipcRenderer.invoke('habitat:apply', habitat),
  export: (habitat: object) => ipcRenderer.invoke('habitat:export', habitat),
  import: () => ipcRenderer.invoke('habitat:import'),
}

const agentAPI = {
  start: (terminalId: string, message: string, defaults?: { model?: string; baseURL?: string }) =>
    ipcRenderer.invoke('agent:start', terminalId, message, defaults),
  stop: (terminalId: string) =>
    ipcRenderer.send('agent:stop', terminalId),
  onEvent: (cb: (terminalId: string, type: string, payload: unknown) => void) => {
    const h = (
      _: Electron.IpcRendererEvent,
      terminalId: string,
      type: string,
      payload: unknown
    ) => cb(terminalId, type, payload)
    ipcRenderer.on('agent:event', h)
    return () => ipcRenderer.off('agent:event', h)
  }
}

const creatureAPI = {
  loadMemory: (id: string) =>
    ipcRenderer.invoke('creature:load-memory', id),
  saveMemory: (id: string, memory: object) =>
    ipcRenderer.invoke('creature:save-memory', id, memory)
}

const moduleAPI = {
  listModules: () => ipcRenderer.invoke('module:list'),
  loadModule: (id: string) => ipcRenderer.invoke('module:load', id),
  startModule: (defaults?: { model?: string; apiKey?: string; baseURL?: string }) =>
    ipcRenderer.invoke('module:start', defaults),
  stopModule: () => ipcRenderer.send('module:stop'),
  pauseModule: () => ipcRenderer.send('module:pause'),
  resumeModule: () => ipcRenderer.send('module:resume'),
  hasSnapshot: (moduleId: string) => ipcRenderer.invoke('module:has-snapshot', moduleId),
  resumeFromSnapshot: (moduleId: string, defaults?: { model?: string; apiKey?: string; baseURL?: string }) =>
    ipcRenderer.invoke('module:resume-from-snapshot', moduleId, defaults),
  scanAssets: (moduleId: string, assetsPath: string) =>
    ipcRenderer.invoke('module:scan-assets', moduleId, assetsPath),
  getBootstrapQuestions: (scenarioPrompt: string, opts?: { model?: string; apiKey?: string; baseURL?: string }) =>
    ipcRenderer.invoke('module:bootstrap-questions', scenarioPrompt, opts),
  getQuestionSuggestions: (question: string, scenario: string, opts?: { model?: string; apiKey?: string; baseURL?: string }) =>
    ipcRenderer.invoke('module:bootstrap-question-suggestions', question, scenario, opts),
  generateModuleConfig: (moduleId: string, prompt: string, opts?: { model?: string; apiKey?: string; baseURL?: string }) =>
    ipcRenderer.invoke('module:bootstrap', moduleId, prompt, opts),
  saveModule: (id: string, data: object) => ipcRenderer.invoke('module:save', id, data),
  getModuleConfig: (moduleId: string) =>
    ipcRenderer.invoke('module:getConfig', moduleId),
  saveConfigChanges: (moduleId: string, changes: object) =>
    ipcRenderer.invoke('module:saveConfigChanges', moduleId, changes),
  deleteModule: (moduleId: string) => ipcRenderer.invoke('module:delete', moduleId),
  onEvent: (cb: (event: unknown) => void) => {
    const h = (_: Electron.IpcRendererEvent, event: unknown) => cb(event)
    ipcRenderer.on('module:event', h)
    return () => ipcRenderer.off('module:event', h)
  },
  onState: (cb: (state: unknown) => void) => {
    const h = (_: Electron.IpcRendererEvent, state: unknown) => cb(state)
    ipcRenderer.on('module:state', h)
    return () => ipcRenderer.off('module:state', h)
  },
  onAgentStatus: (cb: (roleId: string, status: string) => void) => {
    const h = (_: Electron.IpcRendererEvent, roleId: string, status: string) => cb(roleId, status)
    ipcRenderer.on('module:agent-status', h)
    return () => ipcRenderer.off('module:agent-status', h)
  },
  onStatus: (cb: (status: string) => void) => {
    const h = (_: Electron.IpcRendererEvent, status: string) => cb(status)
    ipcRenderer.on('module:status', h)
    return () => ipcRenderer.off('module:status', h)
  },
  onAgentLog: (cb: (entry: unknown) => void) => {
    const h = (_: Electron.IpcRendererEvent, entry: unknown) => cb(entry)
    ipcRenderer.on('module:agent-log', h)
    return () => ipcRenderer.off('module:agent-log', h)
  },
  onStats: (cb: (stats: unknown) => void) => {
    const h = (_: Electron.IpcRendererEvent, stats: unknown) => cb(stats)
    ipcRenderer.on('module:stats', h)
    return () => ipcRenderer.off('module:stats', h)
  },
  onManifest: (cb: (manifest: unknown, assetPaths: Record<string, string>) => void) => {
    const h = (_: Electron.IpcRendererEvent, manifest: unknown, assetPaths: Record<string, string>) => cb(manifest, assetPaths)
    ipcRenderer.on('module:manifest', h)
    return () => ipcRenderer.off('module:manifest', h)
  },
  unloadModule: () => ipcRenderer.send('module:unload'),
}

contextBridge.exposeInMainWorld('windowAPI', windowAPI)
contextBridge.exposeInMainWorld('terminalAPI', terminalAPI)
contextBridge.exposeInMainWorld('agentAPI', agentAPI)
contextBridge.exposeInMainWorld('creatureAPI', creatureAPI)
contextBridge.exposeInMainWorld('moduleAPI', moduleAPI)
contextBridge.exposeInMainWorld('habitatAPI', habitatAPI)

// habitatlogAPI
const habitatlogAPI = {
  getLastActive: () => ipcRenderer.invoke('habitatlog:get-last-active'),
  writeSnapshot: (snapshot: unknown) => ipcRenderer.invoke('habitatlog:write-snapshot', snapshot),
  writeEvent: (event: unknown) => ipcRenderer.invoke('habitatlog:write-event', event),
  getSnapshot: (habitatId: string) => ipcRenderer.invoke('habitatlog:get-snapshot', habitatId),
}

// contextAPI
const contextAPI = {
  compact: (opts: { creatureId: string }) => ipcRenderer.invoke('context:compact', opts),
  getNotes: (opts: { creatureId: string }) => ipcRenderer.invoke('context:get-notes', opts),
  getMessageCount: (opts: { creatureId: string }) => ipcRenderer.invoke('context:get-message-count', opts),
  incrementMessageCount: (opts: { creatureId: string }) => ipcRenderer.invoke('context:increment-message-count', opts),
  startAutoCompact: (opts: { creatureId: string; intervalMs?: number }) => ipcRenderer.invoke('context:start-auto-compact', opts),
  stopAutoCompact: (opts: { creatureId: string }) => ipcRenderer.invoke('context:stop-auto-compact', opts),
}

// hookAPI
const hookAPI = {
  register: (hook: unknown) => ipcRenderer.invoke('hook:register', hook),
  unregister: (opts: { hookId: string }) => ipcRenderer.invoke('hook:unregister', opts),
  enable: (opts: { hookId: string }) => ipcRenderer.invoke('hook:enable', opts),
  disable: (opts: { hookId: string }) => ipcRenderer.invoke('hook:disable', opts),
  list: () => ipcRenderer.invoke('hook:list'),
}

// pluginAPI
const pluginAPI = {
  discover: () => ipcRenderer.invoke('plugin:discover'),
  load: (opts: { pluginId: string }) => ipcRenderer.invoke('plugin:load', opts),
  unload: (opts: { pluginId: string }) => ipcRenderer.invoke('plugin:unload', opts),
  callHook: (opts: { hookName: string; args?: unknown }) => ipcRenderer.invoke('plugin:call-hook', opts),
}

// skillAPI
const skillAPI = {
  compile: (opts: { creatureId: string; name: string; triggers?: string[]; description?: string }) =>
    ipcRenderer.invoke('skill:compile', opts),
  list: (opts?: { creatureId?: string }) => ipcRenderer.invoke('skill:list', opts),
  load: (opts: { path: string }) => ipcRenderer.invoke('skill:load', opts),
  delete: (opts: { path: string }) => ipcRenderer.invoke('skill:delete', opts),
}

contextBridge.exposeInMainWorld('habitatlogAPI', habitatlogAPI)
contextBridge.exposeInMainWorld('contextAPI', contextAPI)
contextBridge.exposeInMainWorld('hookAPI', hookAPI)
contextBridge.exposeInMainWorld('pluginAPI', pluginAPI)
contextBridge.exposeInMainWorld('skillAPI', skillAPI)
