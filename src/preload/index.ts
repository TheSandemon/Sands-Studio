import { contextBridge, ipcRenderer } from 'electron'

const windowAPI = {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close')
}

const terminalAPI = {
  create: (id: string, options?: object) =>
    ipcRenderer.invoke('terminal:create', id, options ?? {}),
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
  }
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
