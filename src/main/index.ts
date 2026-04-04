import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, resolve } from 'path'
import fs from 'fs'
import { ptyManager } from './pty-manager'
import { dispatchAgentMessage, stopAgent, setHabitatBus } from './agent-runner'
import { listModules, loadModule, buildAssetRegistry, bootstrapModule, saveBootstrap, getBootstrapQuestions, getQuestionSuggestions, deleteModule } from './module-engine/module-loader'
import type { ModuleSnapshot } from './module-engine/orchestrator'
import { ModuleOrchestrator } from './module-engine/orchestrator'
import { HabitatLog } from './habitat-log'
import { ContextManager } from './context-manager'
import { HookRegistry } from './hook-registry'
import { PluginRegistry } from './plugin-registry'
import { HabitatBus } from './habitat-bus'

// Prevent gpu cache access denied / creation failure errors on Windows
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

// DreamState module-level singletons
const habitatLogs = new Map<string, HabitatLog>()
const contextManagers = new Map<string, ContextManager>()
const hookRegistry = new HookRegistry()

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ''
const pluginRegistry = new PluginRegistry([
  join(HOME, '.terminal-habitat', 'plugins'),
  join(process.cwd(), 'plugins'),
])

// HabitatBus singleton — lives for the lifetime of the app
let habitatBusInstance: HabitatBus | null = null

function getHabitatBus(): HabitatBus {
  if (!habitatBusInstance) {
    habitatBusInstance = new HabitatBus('global')
  }
  return habitatBusInstance
}

// Track which habitat is currently active (set by habitat:apply IPC)
let currentHabitatId: string | null = null
let currentHabitatName: string = ''

function getHabitatLog(habitatId: string): HabitatLog {
  let log = habitatLogs.get(habitatId)
  if (!log) { log = new HabitatLog(habitatId); habitatLogs.set(habitatId, log) }
  return log
}

export function getContextManager(creatureId: string): ContextManager {
  let cm = contextManagers.get(creatureId)
  if (!cm) {
    const memory = ContextManager.load(creatureId) ?? {
      id: creatureId, hatched: false, createdAt: new Date().toISOString(),
      messages: [], compactionRounds: 0
    }
    cm = new ContextManager(creatureId, memory)
    contextManagers.set(creatureId, cm)
  }
  return cm
}

function creaturesDir(): string {
  return resolve(process.cwd(), '.habitat', 'creatures')
}

function snapshotDir(): string {
  return resolve(process.cwd(), 'modules')
}

function getSnapshotPath(moduleId: string): string {
  return join(snapshotDir(), moduleId, '.snapshot.json')
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
  ipcMain.handle('terminal:create-with-config', (_e, id: string, config: unknown, cols?: number, rows?: number) => {
    ptyManager.createWithConfig(id, config as import('../shared/habitatTypes').ShellConfig, cols, rows)
    return id
  })

  // ── Agent IPC ────────────────────────────────────────────────────────────
  ipcMain.handle('agent:start', (_e, terminalId: string, message: string, defaults?: { model?: string; baseURL?: string }) => {
    dispatchAgentMessage(terminalId, message, win, defaults)
  })
  ipcMain.on('agent:stop', (_e, terminalId: string) => stopAgent(terminalId))

  ipcMain.handle('agent:list', () => {
    const dir = resolve(process.cwd(), '.habitat', 'agents')
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(fs.readFileSync(join(dir, file), 'utf8')))
  })

  ipcMain.handle('agent:load', (_e, id: string, habitatId: string, shellIndex: number) => {
    const dir = resolve(process.cwd(), '.habitat', 'agents')
    const filePath = join(dir, `${id}.json`)
    if (!fs.existsSync(filePath)) throw new Error('Agent not found')
    const agent = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return agent
  })

  ipcMain.handle('agent:delete', (_e, id: string) => {
    const dir = resolve(process.cwd(), '.habitat', 'agents')
    const filePath = join(dir, `${id}.json`)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    return { ok: true }
  })

  ipcMain.handle('agent:save', (_e, agent: { id: string; [key: string]: unknown }) => {
    const dir = resolve(process.cwd(), '.habitat', 'agents')
    fs.mkdirSync(dir, { recursive: true })
    const filePath = join(dir, `${agent.id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(agent, null, 2))
    return { ok: true }
  })

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
    if (currentOrchestrator) {
      // Save snapshot before destroying so session can be resumed
      try {
        const snapshot = currentOrchestrator.serialize()
        const snapshotPath = getSnapshotPath(loadedModule?.manifest.id ?? 'unknown')
        fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))
      } catch (err) {
        console.error('[main] Failed to save module snapshot:', err)
      }
      currentOrchestrator.stop()
      currentOrchestrator = null
    }
  })

  ipcMain.handle('module:has-snapshot', (_e, moduleId: string) => {
    return fs.existsSync(getSnapshotPath(moduleId))
  })

  ipcMain.handle('module:resume-from-snapshot', async (_e, moduleId: string, defaults?: { model?: string; apiKey?: string; baseURL?: string }) => {
    const snapshotPath = getSnapshotPath(moduleId)
    if (!fs.existsSync(snapshotPath)) {
      throw new Error(`No snapshot found for module '${moduleId}'`)
    }
    const snapshot: ModuleSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))

    // Ensure module is loaded (may already be loaded, or may need fresh load)
    if (!loadedModule || loadedModule.manifest.id !== moduleId) {
      loadedModule = await loadModule(moduleId)
    }

    // Merge snapshot agent configs with fresh loaded configs (to pick up apiKeys)
    const snapshotAgentMap = new Map(snapshot.agentConfigs.map((a) => [a.id, a]))
    const mergedRoles = loadedModule.agents.map((role) => {
      const snap = snapshotAgentMap.get(role.id)
      if (snap) {
        // Prefer fresh loaded apiKey; fall back to snapshot's (may be empty)
        return { ...snap, apiKey: role.apiKey ?? snap.apiKey }
      }
      return role
    })

    currentOrchestrator = await ModuleOrchestrator.restore(
      { ...snapshot, agentConfigs: mergedRoles },
      win,
      defaults
    )

    // Build asset paths before starting so we can send them with the status
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

    // Send 'loading' + 'running' BEFORE start() so ModuleView is mounted and listening
    // before the orchestrator starts emitting status events
    if (!win.isDestroyed()) {
      win.webContents.send('module:status', 'loading')
      win.webContents.send('module:manifest', loadedModule.manifest, assetPaths)
      win.webContents.send('module:status', 'running')
      win.webContents.send('module:state', snapshot.worldState)
    }

    await currentOrchestrator.start()
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

  ipcMain.handle('module:bootstrap-question-suggestions', async (_e, question: string, scenario: string, opts?: { model?: string; apiKey?: string; baseURL?: string }) => {
    return await getQuestionSuggestions({
      question,
      scenario,
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

  /** Load full module config (manifest + agents) for settings dialog. */
  ipcMain.handle('module:getConfig', (_e, moduleId: string) => {
    const modulePath = resolve(process.cwd(), 'modules', moduleId)
    const manifestPath = resolve(modulePath, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`manifest.json not found for module '${moduleId}'`)
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const agentsDir = resolve(modulePath, manifest.agents ?? 'agents')
    const agents: unknown[] = []
    if (fs.existsSync(agentsDir)) {
      for (const file of fs.readdirSync(agentsDir)) {
        if (file.endsWith('.json')) {
          agents.push(JSON.parse(fs.readFileSync(resolve(agentsDir, file), 'utf8')))
        }
      }
    }
    return { manifest, agents }
  })

  /** Save manifest and/or agent changes to disk. */
  ipcMain.handle('module:saveConfigChanges', (_e, moduleId: string, changes: unknown) => {
    const modulePath = resolve(process.cwd(), 'modules', moduleId)
    const manifestPath = resolve(modulePath, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`manifest.json not found for module '${moduleId}'`)
    }
    const { manifest: manifestPatch, agents: agentPatches } = changes as {
      manifest?: Record<string, unknown>
      agents?: Array<{ id: string; [key: string]: unknown }>
    }

    // Save manifest changes
    if (manifestPatch) {
      const current = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      const editableFields = [
        'name', 'description', 'version', 'author',
        'worldType', 'scheduling', 'pacing', 'renderer',
        'hasOrchestrator', 'agentMemory',
      ]
      for (const key of editableFields) {
        if (key in manifestPatch) {
          current[key] = manifestPatch[key]
        }
      }
      fs.writeFileSync(manifestPath, JSON.stringify(current, null, 2))
    }

    // Save agent changes
    if (agentPatches && agentPatches.length > 0) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      const agentsDir = resolve(modulePath, manifest.agents ?? 'agents')
      for (const agent of agentPatches) {
        const agentPath = resolve(agentsDir, `${agent.id}.json`)
        fs.writeFileSync(agentPath, JSON.stringify(agent, null, 2))
      }
    }

    return { ok: true }
  })

  /** Delete a module from disk. */
  ipcMain.handle('module:delete', (_e, moduleId: string) => {
    deleteModule(moduleId)
    return { ok: true }
  })

  // ── Habitat IPC ─────────────────────────────────────────────────────────
  // Note: Habitat CRUD (list, get, save, delete) are handled directly in the
  // renderer via useHabitatStore (Zustand persist → localStorage).
  // Main process only handles apply (requires PTY lifecycle) and import/export (file dialogs).

  ipcMain.handle('habitat:apply', (_e, habitat: import('../shared/habitatTypes').Habitat) => {
    // Track current habitat for before-quit last-active write
    currentHabitatId = habitat.id
    currentHabitatName = habitat.name
    // Kill all existing PTYs
    ptyManager.killAll()
    // Create new PTYs for each shell — use creature.id from saved state if available
    // so memory files can be found; fall back to deterministic ID
    const sessions: Array<{ id: string; name: string; shellConfig: import('../shared/habitatTypes').ShellConfig; creature?: import('../shared/habitatTypes').CreatureConfig }> = []
    for (let i = 0; i < habitat.shells.length; i++) {
      const shell = habitat.shells[i]
      const creatureId = shell.creature?.id ?? `hab-${habitat.id?.slice(-12) ?? 'app'}-${i}`
      ptyManager.createWithConfig(creatureId, shell)
      sessions.push({
        id: creatureId,
        name: shell.name || `Shell ${i + 1}`,
        shellConfig: { ...shell, preCreated: true },
        creature: shell.creature,
      })
    }
    // Notify renderer of the batch creation with session info (including creature state and habitat ID for self-save tracking)
    if (!win.isDestroyed()) {
      win.webContents.send('terminal:batch-created', { sessions, habitatId: habitat.id })
    }
    return { ok: true }
  })

  ipcMain.handle('habitat:clear', () => {
    currentHabitatId = null
    currentHabitatName = ''
    ptyManager.killAll()
    if (!win.isDestroyed()) {
      win.webContents.send('terminal:batch-created', { sessions: [] })
    }
    return { ok: true }
  })

  ipcMain.handle('habitat:track', (_e, habitatIds: string[]) => {
    // Store tracked habitats for DreamState/sync purposes
    return { ok: true }
  })

  ipcMain.handle('habitat:get-current-id', () => {
    return currentHabitatId
  })

  ipcMain.handle('habitat:get-current-name', () => {
    return currentHabitatName
  })

  ipcMain.handle('habitat:export', async (_e, habitat: import('../shared/habitatTypes').Habitat) => {
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Habitat',
      defaultPath: `${habitat.name.replace(/\s+/g, '-').toLowerCase()}.habitat.json`,
      filters: [{ name: 'Habitat', extensions: ['habitat.json', 'json'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    fs.writeFileSync(result.filePath, JSON.stringify(habitat, null, 2))
    return { ok: true, path: result.filePath }
  })

  // ── Flowchart IPC ──────────────────────────────────────────────────────
  let flowchartWatcher: fs.FSWatcher | null = null

  ipcMain.handle('flowchart:read', (_e, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: 'File not found' }
      const text = fs.readFileSync(filePath, 'utf8')
      const stat = fs.statSync(filePath)
      return { ok: true, text, mtime: stat.mtimeMs }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('flowchart:write', (_e, filePath: string, text: string) => {
    try {
      fs.mkdirSync(resolve(filePath, '..'), { recursive: true })
      fs.writeFileSync(filePath, text, 'utf8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('flowchart:watch', (_e, filePath: string) => {
    // Stop any previous watcher
    if (flowchartWatcher) {
      flowchartWatcher.close()
      flowchartWatcher = null
    }

    if (!fs.existsSync(filePath)) {
      return { ok: false, error: 'File not found' }
    }

    let debounce: NodeJS.Timeout | null = null
    flowchartWatcher = fs.watch(filePath, (eventType) => {
      if (eventType !== 'change') return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        try {
          const text = fs.readFileSync(filePath, 'utf8')
          const stat = fs.statSync(filePath)
          if (!win.isDestroyed()) {
            win.webContents.send('flowchart:changed', { text, mtime: stat.mtimeMs })
          }
        } catch { /* file might be mid-write */ }
      }, 200)
    })

    return { ok: true }
  })

  ipcMain.handle('flowchart:unwatch', () => {
    if (flowchartWatcher) {
      flowchartWatcher.close()
      flowchartWatcher = null
    }
    return { ok: true }
  })

  ipcMain.handle('flowchart:find', (_e, cwd: string) => {
    // Search for .mermaid files in the working directory
    try {
      const candidates = fs.readdirSync(cwd).filter((f) =>
        f.endsWith('.mermaid') || f.endsWith('.mmd')
      )
      return { ok: true, files: candidates.map((f) => join(cwd, f)) }
    } catch (err) {
      return { ok: false, files: [], error: String(err) }
    }
  })

  // ── Atlas: Directory Scanner ────────────────────────────────────────────
  const ATLAS_IGNORE = new Set([
    'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
    '.next', '.nuxt', '.cache', '.parcel-cache', 'coverage', '__pycache__',
    '.DS_Store', 'Thumbs.db', '.idea', '.vscode', '.vs', 'vendor',
    'target', 'bin', 'obj', '.turbo', '.vercel', '.output'
  ])

  interface AtlasNode {
    name: string
    path: string
    isDir: boolean
    children: AtlasNode[]
  }

  function scanDirectoryTree(dir: string, depth: number, maxDepth: number): AtlasNode[] {
    if (depth >= maxDepth) return []
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const results: AtlasNode[] = []

      // Sort: directories first, then files
      const sorted = entries
        .filter((e) => !ATLAS_IGNORE.has(e.name) && !e.name.startsWith('.'))
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1
          if (!a.isDirectory() && b.isDirectory()) return 1
          return a.name.localeCompare(b.name)
        })

      for (const entry of sorted) {
        const fullPath = join(dir, entry.name)
        const isDir = entry.isDirectory()
        const children = isDir ? scanDirectoryTree(fullPath, depth + 1, maxDepth) : []
        results.push({ name: entry.name, path: fullPath, isDir, children })
      }
      return results
    } catch {
      return []
    }
  }

  function sanitizeId(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_')
  }

  function atlasToMermaid(tree: AtlasNode[], parentId: string | null, lines: string[], depth: number): void {
    for (const node of tree) {
      const nodeId = parentId ? `${parentId}__${sanitizeId(node.name)}` : sanitizeId(node.name)

      if (node.isDir) {
        // Folders rendered as rounded boxes with folder emoji
        lines.push(`    ${nodeId}["📁 ${node.name}"]`)
        if (parentId) {
          lines.push(`    ${parentId} --> ${nodeId}`)
        }
        // Style folder nodes: brighter border and clear white text
        lines.push(`    style ${nodeId} fill:#2a2a50,stroke:#66a3ff,stroke-width:2px,color:#ffffff`)
        atlasToMermaid(node.children, nodeId, lines, depth + 1)
      } else {
        // Files rendered as flat rectangles with file icon
        const ext = node.name.includes('.') ? node.name.split('.').pop() : ''
        const icon = getFileIcon(ext || '')
        lines.push(`    ${nodeId}["${icon} ${node.name}"]`)
        if (parentId) {
          lines.push(`    ${parentId} --> ${nodeId}`)
        }
        // Style file nodes: lighter fill than background, pristine white text
        lines.push(`    style ${nodeId} fill:#1a1a44,stroke:#66a3ff,stroke-width:1px,color:#f0f4ff`)
      }
    }
  }

  function getFileIcon(ext: string): string {
    const iconMap: Record<string, string> = {
      ts: '🔷', tsx: '⚛️', js: '🟡', jsx: '⚛️',
      css: '🎨', html: '🌐', json: '📋', md: '📝',
      py: '🐍', rs: '🦀', go: '🔵', rb: '💎',
      mermaid: '🧜', mmd: '🧜', yml: '⚙️', yaml: '⚙️',
      toml: '⚙️', env: '🔒', sh: '💻', bat: '💻',
      png: '🖼️', jpg: '🖼️', svg: '🖼️', gif: '🖼️',
    }
    return iconMap[ext] || '📄'
  }

  // Cache for the Atlas tree
  let atlasCache: { tree: AtlasNode[]; mermaid: string; scannedAt: number } | null = null

  ipcMain.handle('flowchart:scan', (_e, cwd: string, opts?: { maxDepth?: number; forceRefresh?: boolean }) => {
    try {
      const maxDepth = opts?.maxDepth ?? 3
      const forceRefresh = opts?.forceRefresh ?? false

      // Use cache if fresh (< 5 seconds) unless forced
      if (!forceRefresh && atlasCache && (Date.now() - atlasCache.scannedAt < 5000)) {
        return { ok: true, mermaid: atlasCache.mermaid, tree: atlasCache.tree, cached: true }
      }

      const tree = scanDirectoryTree(cwd, 0, maxDepth)
      const lines: string[] = ['graph BT']

      // Terminals subgraph: Gives agents a starting location in the map
      const activeTerminals = ptyManager.getSessionIds()
      if (activeTerminals.length > 0) {
        lines.push('  subgraph TerminalHub["📡 Active Shells"]')
        for (const tid of activeTerminals) {
          const name = tid.split('-').pop() || 'shell'
          lines.push(`    terminal_${sanitizeId(tid)}["💻 ${name}"]`)
        }
        lines.push('  end')
      }

      // Root node
      const rootName = cwd.split(/[\\/]/).pop() || 'project'
      const rootId = sanitizeId(rootName)
      lines.push(`    ${rootId}["🏠 ${rootName}"]`)
      lines.push(`    style ${rootId} fill:#2a2a50,stroke:#ffdd55,stroke-width:2px,color:#ffdd55`)

      // Link Terminals Hub to project root
      for (const tid of activeTerminals) {
        lines.push(`    terminal_${sanitizeId(tid)} --> ${rootId}`)
      }

      const mermaidText = lines.join('\n')

      atlasCache = { tree, mermaid: mermaidText, scannedAt: Date.now() }

      return { ok: true, mermaid: mermaidText, tree, rootId, cached: false }
    } catch (err) {
      return { ok: false, mermaid: '', tree: [], rootId: '', error: String(err) }
    }
  })

  ipcMain.handle('flowchart:get-cwd', () => {
    return process.cwd()
  })

  ipcMain.handle('habitat:select-project', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Project Folder',
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    return { ok: true, projectPath: result.filePaths[0] }
  })

  ipcMain.handle('habitat:import', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Import Habitat',
      filters: [{ name: 'Habitat', extensions: ['habitat.json', 'json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const habitat = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'))
    return { ok: true, habitat }
  })

  // ── HabitatLog IPC ────────────────────────────────────────────────────────
  ipcMain.handle('habitatlog:write-event', (_e, event: import('../shared/dreamstate-types').HabitatLogEvent) => {
    const habitatId = currentHabitatId ?? 'default'
    const log = getHabitatLog(habitatId)
    log.write(event)
    // Evaluate and execute matching hooks
    const matches = hookRegistry.evaluate(event)
    for (const match of matches) {
      hookRegistry.executeMatch(match).catch((err: unknown) => console.error('[HookRegistry] executeMatch failed:', err))
    }
    return { ok: true }
  })

  ipcMain.handle('habitatlog:write-snapshot', (_e, snapshot: Omit<import('../shared/dreamstate-types').HabitatSnapshot, 'type' | 'version'>) => {
    const habitatId = snapshot.habitatId ?? currentHabitatId ?? 'default'
    const snapshotPath = getHabitatLog(habitatId).writeSnapshot(snapshot)
    hookRegistry.callHook('onSnapshotWritten', { habitatId, snapshotPath })
    return { ok: true }
  })

  ipcMain.handle('habitatlog:get-last-active', () => {
    return HabitatLog.readLastActive()
  })

  ipcMain.handle('habitatlog:get-snapshot', (_e, habitatId: string) => {
    return getHabitatLog(habitatId).getLastSession(habitatId)
  })

  // ── ContextManager IPC ────────────────────────────────────────────────────
  ipcMain.handle('context:compact', async (_e, creatureId: string, options?: { model?: string; apiKey?: string; baseURL?: string }) => {
    const cm = getContextManager(creatureId)
    const result = await cm.compact(options)
    // Notify plugins and hooks
    hookRegistry.callHook('onContextCompacted', { creatureId, summary: cm.getSummary() ?? '', round: result.round })
    return result
  })

  ipcMain.handle('context:get-notes', (_e, creatureId: string) => {
    return getContextManager(creatureId).getNotes()
  })

  ipcMain.handle('context:get-message-count', (_e, creatureId: string) => {
    return getContextManager(creatureId).getMessageCount()
  })

  ipcMain.handle('context:start-auto-compact', (_e, creatureId: string, intervalMs?: number) => {
    getContextManager(creatureId).startAutoCompact(intervalMs)
    return { ok: true }
  })

  ipcMain.handle('context:stop-auto-compact', (_e, creatureId: string) => {
    getContextManager(creatureId).stopAutoCompact()
    return { ok: true }
  })

  ipcMain.handle('context:increment-count', (_e, creatureId: string) => {
    const cm = contextManagers.get(creatureId)
    if (cm) {
      cm.recordActivity()
      if (cm.getMessageCount() > 200) {
        // Fire and forget compaction
        cm.compact().catch(() => {})
      }
    }
    return { ok: true }
  })

  // ── HookRegistry IPC ─────────────────────────────────────────────────────
  ipcMain.handle('hook:register', (_e, hook: import('../shared/dreamstate-types').Hook) => {
    hookRegistry.register(hook)
    return { ok: true }
  })
  ipcMain.handle('hook:unregister', (_e, hookId: string) => {
    hookRegistry.unregister(hookId)
    return { ok: true }
  })
  ipcMain.handle('hook:enable', (_e, hookId: string) => {
    hookRegistry.enable(hookId)
    return { ok: true }
  })
  ipcMain.handle('hook:disable', (_e, hookId: string) => {
    hookRegistry.disable(hookId)
    return { ok: true }
  })
  ipcMain.handle('hook:list', () => {
    return hookRegistry.list()
  })

  // ── PluginRegistry IPC ────────────────────────────────────────────────────
  ipcMain.handle('plugin:discover', (_e, searchPaths?: string[]) => {
    return pluginRegistry.discover(searchPaths)
  })
  ipcMain.handle('plugin:load', (_e, pluginId: string) => {
    const result = pluginRegistry.load(pluginId)
    return result ? { ok: true } : { ok: false, error: 'not found or load failed' }
  })
  ipcMain.handle('plugin:unload', (_e, pluginId: string) => {
    pluginRegistry.unload(pluginId)
    return { ok: true }
  })
  ipcMain.handle('plugin:list-loaded', () => {
    return pluginRegistry.listLoaded().map(p => ({ id: p.id, manifest: p.manifest }))
  })

  // ── SkillCompiler IPC ────────────────────────────────────────────────────
  ipcMain.handle('skill:compile', async (_e, args: { creatureId: string; name: string; triggers?: string[]; description?: string; notes?: string; summary?: string }) => {
    const { SkillCompiler } = await import('./skill-compiler')
    const compiler = new SkillCompiler(args.creatureId, { notes: args.notes, summary: args.summary })
    const skill = await compiler.compile(args.name, args.triggers ?? [], args.description)
    hookRegistry.callHook('onSkillCompiled', { skillPath: skill.manifest.path, skillName: skill.manifest.name, creatureId: args.creatureId })
    return skill
  })
  ipcMain.handle('skill:list', async (_e, creatureId?: string) => {
    const { SkillCompiler } = await import('./skill-compiler')
    return SkillCompiler.listSkills(creatureId)
  })

  // ── HabitatComms IPC ─────────────────────────────────────────────────────
  const bus = getHabitatBus()

  // Forward bus events to the renderer window
  bus.on('message', (msg: import('../shared/habitatCommsTypes').HabitatMessage) => {
    if (!win.isDestroyed()) {
      win.webContents.send('comms:message', msg)
    }
  })
  bus.on('status-change', (info: import('../shared/habitatCommsTypes').AgentStatusInfo) => {
    if (!win.isDestroyed()) {
      win.webContents.send('comms:status-change', info)
    }
  })
  bus.on('collision-detected', (result: import('../shared/habitatCommsTypes').CollisionResult) => {
    if (!win.isDestroyed()) {
      win.webContents.send('comms:collision', result)
    }
  })

  ipcMain.handle('comms:register-agent', async (_e, creatureId: string, name: string) => {
    await bus.registerAgent(creatureId, name)
    return { ok: true }
  })
  ipcMain.handle('comms:unregister-agent', async (_e, creatureId: string) => {
    await bus.unregisterAgent(creatureId)
    return { ok: true }
  })
  ipcMain.handle('comms:send', async (_e, input: import('../shared/habitatCommsTypes').SendMessageInput) => {
    return await bus.send(input)
  })
  ipcMain.handle('comms:send-direct', async (_e, recipientId: string, senderId: string, senderName: string, content: string) => {
    return await bus.sendDirect(recipientId, senderId, senderName, content)
  })
  ipcMain.handle('comms:broadcast', async (_e, senderId: string, senderName: string, content: string) => {
    return await bus.broadcast(senderId, senderName, content)
  })
  ipcMain.handle('comms:reply', async (_e, threadId: string, senderId: string, senderName: string, content: string) => {
    return await bus.reply(threadId, senderId, senderName, content)
  })
  ipcMain.handle('comms:get-messages', async (_e, creatureId: string, opts?: import('../shared/habitatCommsTypes').MessageQueryOpts) => {
    return await bus.getMessages(creatureId, opts)
  })
  ipcMain.handle('comms:get-thread', async (_e, threadId: string) => {
    return await bus.getThread(threadId)
  })
  ipcMain.handle('comms:get-recent', async (_e, creatureId: string, limit?: number) => {
    return await bus.getRecentMessages(creatureId, limit)
  })
  ipcMain.handle('comms:get-status', () => {
    return bus.getAllAgentStatuses()
  })
  ipcMain.handle('comms:set-status', (_e, creatureId: string, status: import('../shared/habitatCommsTypes').AgentStatus) => {
    bus.setAgentStatus(creatureId, status)
    return { ok: true }
  })
  ipcMain.handle('comms:claim-intent', async (_e, creatureId: string, intent: import('../shared/habitatCommsTypes').IntentPayload) => {
    return await bus.claimIntent(creatureId, intent)
  })
  ipcMain.handle('comms:release-intent', async (_e, creatureId: string, intentType: string, target: string) => {
    await bus.releaseIntent(creatureId, intentType, target)
    return { ok: true }
  })
  ipcMain.handle('comms:check-intents', async (_e, target: string) => {
    return await bus.checkIntents(target)
  })
  ipcMain.handle('comms:record-file-edit', async (_e, event: import('../shared/habitatCommsTypes').FileEditEvent) => {
    return await bus.recordFileEdit(event)
  })
  ipcMain.handle('comms:check-collision', (_e, filePath: string, windowMs?: number) => {
    return bus.checkCollision(filePath, windowMs)
  })
  ipcMain.handle('comms:build-handoff', async (_e, sourceId: string, targetId: string) => {
    const cm = getContextManager(sourceId)
    return await bus.buildHandoffBundle(
      sourceId,
      targetId,
      (id) => getContextManager(id).getNotes(),
      async (id, since) => {
        const msgs = await bus.getMessages(id, { since })
        return msgs
      },
      (id) => getContextManager(id).getSummary() ?? ''
    )
  })
  ipcMain.handle('comms:send-handoff', async (_e, targetId: string, bundle: import('../shared/habitatCommsTypes').HandoffBundle) => {
    return await bus.sendHandoff(targetId, bundle)
  })

  // Tell agent-runner about the bus so it can use it for broadcasts
  setHabitatBus(getHabitatBus)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  createWindow()

  // DreamState: check for last active habitat and emit app:started
  const lastActive = HabitatLog.readLastActive()
  if (lastActive) {
    const log = getHabitatLog(lastActive.habitatId)
    log.write({ type: 'app:started', timestamp: Date.now() })
    hookRegistry.callHook('onAppClose', {})  // startup notification
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptyManager.dispose()
  if (process.platform !== 'darwin') app.quit()
})

// DreamState: write last-active pointer and cleanup on quit
app.on('before-quit', () => {
  if (currentHabitatId) {
    const log = getHabitatLog(currentHabitatId)
    log.write({ type: 'app:closing', timestamp: Date.now() })
    log.writeLastActive(currentHabitatId, currentHabitatName)
  }
  // Stop all auto-compact timers
  for (const cm of contextManagers.values()) {
    cm.stopAutoCompact()
  }
  // Dispose hook registry (clears cron timers)
  hookRegistry.dispose()
})
