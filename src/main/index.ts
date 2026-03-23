import { app, BrowserWindow, ipcMain } from 'electron'
import { join, resolve } from 'path'
import fs from 'fs'
import { ptyManager } from './pty-manager'
import { dispatchAgentMessage, stopAgent } from './agent-runner'
import { listModules, loadModule, buildAssetRegistry, bootstrapModule, saveBootstrap, getBootstrapQuestions } from './module-engine/module-loader'
import { ModuleOrchestrator } from './module-engine/orchestrator'

function creaturesDir(): string {
  return resolve(process.cwd(), '.habitat', 'creatures')
}

function creatureFile(id: string): string {
  return join(creaturesDir(), `${id}.json`)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0d1a',
    frame: false,
    center: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Terminal Habitat'
  })

  // ── Window controls ──────────────────────────────────────────────────────
  ipcMain.on('window:minimize', () => win.minimize())
  ipcMain.on('window:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()))
  ipcMain.on('window:close',    () => win.close())

  // ── PTY forwarding ───────────────────────────────────────────────────────
  ptyManager.on('data', (id: string, data: string) => {
    if (!win.isDestroyed()) win.webContents.send('terminal:data', id, data)
  })
  ptyManager.on('exit', (id: string, code: number) => {
    if (!win.isDestroyed()) win.webContents.send('terminal:exit', id, code)
  })

  // ── Terminal IPC ─────────────────────────────────────────────────────────
  ipcMain.handle('terminal:create', (_e, id: string, options: object) => {
    ptyManager.create(id, options)
    return id
  })
  ipcMain.on('terminal:write', (_e, id: string, data: string) => ptyManager.write(id, data))
  ipcMain.on('terminal:resize', (_e, id: string, cols: number, rows: number) =>
    ptyManager.resize(id, cols, rows)
  )
  ipcMain.handle('terminal:kill', (_e, id: string) => ptyManager.kill(id))

  // ── Agent IPC ────────────────────────────────────────────────────────────
  ipcMain.handle('agent:start', (_e, terminalId: string, message: string, defaults?: { model?: string; baseURL?: string }) => {
    dispatchAgentMessage(terminalId, message, win, defaults)
  })
  ipcMain.on('agent:stop', (_e, terminalId: string) => stopAgent(terminalId))

  // ── Creature memory IPC ──────────────────────────────────────────────────
  ipcMain.handle('creature:load-memory', (_e, id: string) => {
    const file = creatureFile(id)
    if (fs.existsSync(file)) {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
    }
    return null
  })

  ipcMain.handle('creature:save-memory', (_e, id: string, memory: object) => {
    const dir = creaturesDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(creatureFile(id), JSON.stringify(memory, null, 2))
  })

  // ── Module Engine IPC ───────────────────────────────────────────────────
  let currentOrchestrator: ModuleOrchestrator | null = null
  let loadedModule: Awaited<ReturnType<typeof loadModule>> | null = null

  ipcMain.handle('module:list', () => listModules())

  ipcMain.handle('module:load', async (_e, id: string) => {
    loadedModule = await loadModule(id)
    // Serialize asset file paths for the renderer (tag → absolute file path)
    const assetPaths: Record<string, string> = {}
    const reg = loadedModule.assetRegistry
    for (const [tag, assets] of Object.entries(reg.tiles)) {
      if (assets[0]) assetPaths[`tile:${tag}`] = assets[0].path
    }
    for (const [tag, assets] of Object.entries(reg.entities)) {
      if (assets[0]) assetPaths[`entity:${tag}`] = assets[0].path
    }
    for (const [tag, assets] of Object.entries(reg.effects)) {
      if (assets[0]) assetPaths[`effect:${tag}`] = assets[0].path
    }
    return {
      manifest: loadedModule.manifest,
      worldState: loadedModule.worldState,
      agents: loadedModule.agents,
      assetPaths,
    }
  })

  ipcMain.handle('module:start', async (_e, defaults?: { model?: string; apiKey?: string; baseURL?: string }) => {
    if (!loadedModule) throw new Error('No module loaded')
    currentOrchestrator = new ModuleOrchestrator({
      manifest: loadedModule.manifest,
      roles: loadedModule.agents,
      worldState: loadedModule.worldState,
      win,
      defaults,
    })
    await currentOrchestrator.start()
  })

  ipcMain.on('module:stop', () => {
    currentOrchestrator?.stop()
    currentOrchestrator = null
  })

  ipcMain.on('module:pause', () => {
    currentOrchestrator?.pause()
  })

  ipcMain.on('module:resume', () => {
    currentOrchestrator?.resume()
  })

  ipcMain.on('module:unload', () => {
    currentOrchestrator?.stop()
    currentOrchestrator = null
    loadedModule = null
  })

  ipcMain.handle('module:scan-assets', async (_e, moduleId: string, assetsPath: string) => {
    const modsDir = resolve(process.cwd(), 'modules', moduleId, assetsPath)
    const registry = await buildAssetRegistry(modsDir)
    return {
      tiles: Object.keys(registry.tiles),
      entities: Object.keys(registry.entities),
      effects: Object.keys(registry.effects),
    }
  })

  ipcMain.handle('module:bootstrap-questions', async (_e, scenarioPrompt: string, opts?: { model?: string; apiKey?: string; baseURL?: string }) => {
    return await getBootstrapQuestions({
      scenarioPrompt,
      model: opts?.model,
      apiKey: opts?.apiKey,
      baseURL: opts?.baseURL,
    })
  })

  ipcMain.handle('module:bootstrap', async (_e, moduleId: string, prompt: string, opts?: { model?: string; apiKey?: string; baseURL?: string }) => {
    const result = await bootstrapModule({
      scenarioPrompt: prompt,
      assetsPath: resolve(process.cwd(), 'modules', moduleId, 'assets'),
      model: opts?.model,
      apiKey: opts?.apiKey,
      baseURL: opts?.baseURL,
    })
    return result
  })

  ipcMain.handle('module:save', (_e, id: string, data: { manifest: unknown; world: unknown; agents: unknown[] }) => {
    return saveBootstrap(id, data as { manifest: import('./module-engine/module-loader').ModuleManifest; world: import('./module-engine/module-loader').WorldState; agents: import('./module-engine/module-loader').AgentRole[] })
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptyManager.dispose()
  if (process.platform !== 'darwin') app.quit()
})
