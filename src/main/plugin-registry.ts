// =============================================================================
// PluginRegistry — extensible plugin system with lifecycle and hook invocation
// =============================================================================

import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type {
  DiscoveredPlugin,
  LoadedPlugin,
  PluginHookName,
  PluginManifest,
} from '../shared/dreamstate-types'

export class PluginRegistry {
  private readonly searchPaths: string[]
  private readonly discovered = new Map<string, DiscoveredPlugin>()
  private readonly loaded = new Map<string, LoadedPlugin>()

  constructor(searchPaths?: string[]) {
    const home =
      process.env.HOME ?? process.env.USERPROFILE ?? ''
    const appDir = process.cwd()

    this.searchPaths =
      searchPaths ??
      [
        join(home, '.terminal-habitat', 'plugins'),
        join(appDir, 'plugins'),
      ]
  }

  // ── Discovery ───────────────────────────────────────────────────────────────

  discover(extraPaths?: string[]): DiscoveredPlugin[] {
    const results: DiscoveredPlugin[] = []
    const roots = extraPaths ?? this.searchPaths

    for (const rootPath of roots) {
      if (!existsSync(rootPath)) continue

      let entries: ReturnType<typeof readdirSync>
      try {
        entries = readdirSync(rootPath, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const manifestPath = join(rootPath, entry.name, 'plugin.json')
        if (!existsSync(manifestPath)) continue

        let manifest: PluginManifest
        try {
          manifest = JSON.parse(
            readFileSync(manifestPath, 'utf8'),
          ) as PluginManifest
        } catch {
          // skip invalid manifest
          continue
        }

        if (!manifest.id || !manifest.entry) continue

        const plugin: DiscoveredPlugin = {
          id: manifest.id,
          manifest,
          rootPath: join(rootPath, entry.name),
        }

        this.discovered.set(manifest.id, plugin)
        results.push(plugin)
      }
    }

    return results
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  load(pluginId: string): LoadedPlugin | null {
    const discovered = this.discovered.get(pluginId)
    if (!discovered) return null

    const { manifest, rootPath } = discovered
    const entryPath = join(rootPath, manifest.entry)

    let instance: object
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      instance = require(entryPath)
    } catch {
      return null
    }

    const loadedPlugin: LoadedPlugin = {
      id: pluginId,
      manifest,
      instance,
      registeredHooks: new Map(),
    }

    this.loaded.set(pluginId, loadedPlugin)
    return loadedPlugin
  }

  unload(pluginId: string): void {
    const plugin = this.loaded.get(pluginId)
    if (!plugin) return

    const onUnload = (plugin.instance as Record<string, unknown>).onUnload
    if (typeof onUnload === 'function') {
      try {
        onUnload()
      } catch {
        // ignore cleanup errors
      }
    }

    this.loaded.delete(pluginId)
  }

  // ── Hook invocation ────────────────────────────────────────────────────────

  callHook(hookName: PluginHookName, args: object): void {
    const deadline = Date.now() + 5000

    for (const plugin of this.loaded.values()) {
      if (!plugin.manifest.hooks.includes(hookName)) continue

      const handler = (plugin.instance as Record<string, unknown>)[hookName]
      if (typeof handler !== 'function') continue

      const timeout = Math.max(0, deadline - Date.now())

      const timer = setTimeout(() => {
        console.warn(`[PluginRegistry] hook "${hookName}" timed out after 5s for plugin "${plugin.id}"`)
      }, Math.min(timeout, 5000))

      try {
        const result = handler.call(plugin.instance, args)
        clearTimeout(timer)

        if (result instanceof Promise) {
          result.catch((err) =>
            console.error(`[PluginRegistry] hook "${hookName}" rejected:`, err),
          )
        }
      } catch (err) {
        clearTimeout(timer)
        console.error(`[PluginRegistry] hook "${hookName}" threw:`, err)
      }
    }
  }

  // ── State ──────────────────────────────────────────────────────────────────

  listLoaded(): LoadedPlugin[] {
    return Array.from(this.loaded.values())
  }

  listAvailable(): DiscoveredPlugin[] {
    return Array.from(this.discovered.values())
  }

  isLoaded(pluginId: string): boolean {
    return this.loaded.has(pluginId)
  }
}
