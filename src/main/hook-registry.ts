import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  Hook,
  HookCondition,
  HookMatch,
  HabitatLogEvent,
} from '../shared/dreamstate-types'

// ── Registry file location ─────────────────────────────────────────────────────

const HOOKS_DIR = path.join(os.homedir(), '.terminal-habitat', 'hooks')
const REGISTRY_FILE = path.join(HOOKS_DIR, 'registry.json')

// ── HookRegistry ───────────────────────────────────────────────────────────────

export class HookRegistry {
  private hooks = new Map<string, Hook>()
  private cronTimers = new Map<string, ReturnType<typeof setInterval>>()
  private loaded = false

  constructor() {
    this.loadFromDisk()
  }

  // ── Registration ────────────────────────────────────────────────────────────

  register(hook: Hook): void {
    this.hooks.set(hook.id, hook)
    if (hook.enabled && hook.trigger === 'schedule') {
      this.startCronTimer(hook)
    }
    this.saveToDisk()
  }

  unregister(hookId: string): void {
    this.stopCronTimer(hookId)
    this.hooks.delete(hookId)
    this.saveToDisk()
  }

  enable(hookId: string): void {
    const hook = this.hooks.get(hookId)
    if (!hook) return
    hook.enabled = true
    if (hook.trigger === 'schedule') {
      this.startCronTimer(hook)
    }
    this.saveToDisk()
  }

  disable(hookId: string): void {
    const hook = this.hooks.get(hookId)
    if (!hook) return
    hook.enabled = false
    this.stopCronTimer(hookId)
    this.saveToDisk()
  }

  // ── Evaluation ─────────────────────────────────────────────────────────────

  evaluate(event: HabitatLogEvent): HookMatch[] {
    const matches: HookMatch[] = []
    for (const hook of this.hooks.values()) {
      if (!hook.enabled) continue
      if (this.conditionMatches(hook.condition, event)) {
        matches.push({
          hook,
          matchedValue: this.getMatchedValue(hook.condition, event),
        })
      }
    }
    return matches
  }

  private conditionMatches(condition: HookCondition, event: HabitatLogEvent): boolean {
    switch (condition.type) {
      case 'event-type':
        return condition.eventType === event.type
      case 'regex': {
        const source = this.getEventField(condition.sourceField, event)
        if (typeof source !== 'string') return false
        try {
          return new RegExp(condition.pattern).test(source)
        } catch {
          return false
        }
      }
      case 'context-compacted':
        return event.type === 'context:compacted'
      case 'cron':
        return false // timer-based, handled by startCronTimer
    }
  }

  private getMatchedValue(condition: HookCondition, event: HabitatLogEvent): string | undefined {
    if (condition.type === 'regex') {
      const source = this.getEventField(condition.sourceField, event)
      if (typeof source !== 'string') return undefined
      try {
        return new RegExp(condition.pattern).exec(source)?.[0]
      } catch {
        return undefined
      }
    }
    return undefined
  }

  private getEventField(field: string, event: HabitatLogEvent): unknown {
    switch (field) {
      case 'chunk':
        return (event.payload as { chunk?: string })?.chunk
      case 'event':
        return event.type
      case 'payload':
        return event.payload
      default:
        return undefined
    }
  }

  // ── Execution ───────────────────────────────────────────────────────────────

  async executeMatch(match: HookMatch): Promise<void> {
    const { hook } = match
    switch (hook.action.type) {
      case 'log':
        console.log(`[Hook:${hook.name}] ${hook.action.message}`)
        break
      case 'compact':
        // IPC to context:compact — console.log for now (IPC wiring happens in Task 3)
        console.log(`[Hook:${hook.name}] Compaction triggered for ${hook.action.creatureId}`)
        break
      case 'skill':
        console.log(`[Hook:${hook.name}] Skill: ${hook.action.skillPath}`)
        break
      case 'shell':
        console.log(`[Hook:${hook.name}] Shell: ${hook.action.command}`)
        break
      case 'http':
        try {
          await fetch(hook.action.url, {
            method: hook.action.method,
            body: hook.action.body,
          })
        } catch (err) {
          console.error(`[Hook:${hook.name}] HTTP failed:`, err)
        }
        break
      case 'plugin':
        // Delegated to PluginRegistry — console.log for now
        console.log(`[Hook:${hook.name}] Plugin: ${hook.action.pluginId}.${hook.action.method}`)
        break
    }
  }

  // ── Listing ─────────────────────────────────────────────────────────────────

  list(): Hook[] {
    return Array.from(this.hooks.values())
  }

  // ── Internal system hooks (programmatic triggers) ────────────────────────────

  /**
   * Trigger a named system hook by name. Finds all hooks whose action matches
   * the given hook name and executes them with the provided payload.
   * Used by internal code (habitat:apply, context:compact, skill:compile, etc.)
   * to fire system-level hooks on specific events.
   */
  callHook(hookName: string, payload?: Record<string, unknown>): void {
    for (const hook of this.hooks.values()) {
      if (!hook.enabled) continue
      // Match by action type mapping to the hook name
      if (this.hookMatchesName(hook, hookName)) {
        this.executeMatch({ hook, matchedValue: undefined }).catch(
          (err: unknown) => console.error(`[HookRegistry] callHook '${hookName}' failed:`, err)
        )
      }
    }
  }

  private hookMatchesName(hook: Hook, name: string): boolean {
    const cond = hook.condition
    switch (name) {
      case 'onSnapshotWritten':
        return cond.type === 'event-type' && cond.eventType === 'snapshot:written'
      case 'onContextCompacted':
        return cond.type === 'context-compacted'
      case 'onSkillCompiled':
        return cond.type === 'event-type' && cond.eventType === 'skill:compiled'
      case 'onAppClose':
        return cond.type === 'event-type' && cond.eventType === 'app:closing'
      default:
        return false
    }
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  loadFromDisk(): void {
    if (this.loaded) return
    try {
      if (!fs.existsSync(HOOKS_DIR)) {
        fs.mkdirSync(HOOKS_DIR, { recursive: true })
      }
      if (fs.existsSync(REGISTRY_FILE)) {
        const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8')
        const parsed = JSON.parse(raw) as { hooks: Hook[] }
        for (const hook of parsed.hooks ?? []) {
          this.hooks.set(hook.id, hook)
          if (hook.enabled && hook.trigger === 'schedule') {
            this.startCronTimer(hook)
          }
        }
      }
    } catch (err) {
      console.error('[HookRegistry] loadFromDisk failed:', err)
    } finally {
      this.loaded = true
    }
  }

  saveToDisk(): void {
    try {
      if (!fs.existsSync(HOOKS_DIR)) {
        fs.mkdirSync(HOOKS_DIR, { recursive: true })
      }
      const payload = JSON.stringify({ hooks: Array.from(this.hooks.values()) }, null, 2)
      fs.writeFileSync(REGISTRY_FILE, payload, 'utf-8')
    } catch (err) {
      console.error('[HookRegistry] saveToDisk failed:', err)
    }
  }

  // ── Cron ────────────────────────────────────────────────────────────────────

  private startCronTimer(hook: Hook): void {
    if (hook.condition.type !== 'cron') return
    if (this.cronTimers.has(hook.id)) return

    const intervalMs = this.parseSimpleCron(hook.condition.expression)
    const timer = setInterval(async () => {
      // Fire a synthetic event for cron hooks
      const syntheticEvent: HabitatLogEvent = {
        type: 'hook:fired',
        timestamp: Date.now(),
        payload: { hookId: hook.id, trigger: 'schedule' },
      }
      const matches = this.evaluate(syntheticEvent)
      for (const match of matches) {
        await this.executeMatch(match)
      }
    }, intervalMs)

    this.cronTimers.set(hook.id, timer)
  }

  private stopCronTimer(hookId: string): void {
    const timer = this.cronTimers.get(hookId)
    if (timer) {
      clearInterval(timer)
      this.cronTimers.delete(hookId)
    }
  }

  private parseSimpleCron(expression: string): number {
    // expression format: "min hour" (e.g., "*/5 *" = every 5 minutes, "0 * *" = every hour)
    // Only handles: * (any), */n (every n), specific values
    // Returns interval in milliseconds
    const parts = expression.trim().split(/\s+/)
    const [min] = parts
    if (min.startsWith('*/')) {
      const n = parseInt(min.slice(2))
      if (!isNaN(n)) return n * 60 * 1000
    }
    // Default: check every minute for cron hooks
    return 60 * 1000
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  dispose(): void {
    for (const [_hookId, timer] of this.cronTimers) {
      clearInterval(timer)
    }
    this.cronTimers.clear()
  }
}
