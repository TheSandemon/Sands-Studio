/**
 * AgentAutonomyManager.ts
 *
 * Manages the autonomous wake-up cycles for agents with autonomy enabled.
 * When an agent's `autonomy.enabled` is true, this manager spins up an
 * interval that periodically prompts the agent with its goal and context.
 *
 * Also provides the `wake_agent` inter-agent communication primitive —
 * one agent can wake another agent by ID with a custom message.
 */

import { useTerminalStore, type TerminalSession } from '../store/useTerminalStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AutonomyTimer {
  sessionId: string
  intervalId: ReturnType<typeof setInterval>
  lastWakeTime: number
  busy: boolean
}

// ---------------------------------------------------------------------------
// Manager singleton
// ---------------------------------------------------------------------------

class AgentAutonomyManager {
  private timers = new Map<string, AutonomyTimer>()
  private unsubscribe: (() => void) | null = null

  /**
   * Start observing the terminal store. When sessions appear/change with
   * autonomy configs, timers are created/destroyed as needed.
   */
  start(): void {
    if (this.unsubscribe) return // already started

    // Initial sync
    this.syncTimers(useTerminalStore.getState().terminals)

    // Subscribe to store changes
    this.unsubscribe = useTerminalStore.subscribe((state) => {
      this.syncTimers(state.terminals)
    })

    console.log('[AutonomyManager] Started')
  }

  /**
   * Tear down all timers and stop observing.
   */
  stop(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer.intervalId)
    }
    this.timers.clear()
    this.unsubscribe?.()
    this.unsubscribe = null
    console.log('[AutonomyManager] Stopped')
  }

  /**
   * External API: one agent can wake another agent.
   * Usage: `autonomyManager.wakeAgent(targetSessionId, "I need you to review the CSS")`
   */
  async wakeAgent(targetSessionId: string, message: string, fromAgentName?: string): Promise<boolean> {
    const state = useTerminalStore.getState()
    const target = state.terminals.find((t) => t.id === targetSessionId)
    if (!target) {
      console.warn(`[AutonomyManager] Cannot wake unknown agent ${targetSessionId}`)
      return false
    }

    const timer = this.timers.get(targetSessionId)
    if (timer?.busy) {
      console.log(`[AutonomyManager] Agent ${targetSessionId} is busy, queuing interrupt`)
      // Queue the wake — it will fire on next tick
      timer.busy = false
    }

    const prefix = fromAgentName ? `[Inter-Agent from ${fromAgentName}]` : '[System Wake]'
    const wakePrompt = `${prefix} ${message}`

    return this.sendWakePrompt(target, wakePrompt)
  }

  // ── internals ───────────────────────────────────────────────────────────

  private syncTimers(terminals: TerminalSession[]): void {
    const activeIds = new Set<string>()

    for (const session of terminals) {
      const autonomy = session.shellConfig?.creature?.autonomy
      if (!autonomy?.enabled || !autonomy.goal) continue

      activeIds.add(session.id)

      const existing = this.timers.get(session.id)
      if (existing) {
        // Check if interval changed — if so, restart
        // We approximate by checking if the timer's been set up at all
        continue
      }

      // Create new timer
      const intervalId = setInterval(() => {
        this.tick(session.id)
      }, autonomy.intervalMs || 300000) // default 5 min

      this.timers.set(session.id, {
        sessionId: session.id,
        intervalId,
        lastWakeTime: 0,
        busy: false,
      })

      console.log(
        `[AutonomyManager] Timer started for ${session.creatureName || session.id} — every ${Math.round((autonomy.intervalMs || 300000) / 60000)}min`
      )
    }

    // Clean up timers for sessions that no longer exist or have autonomy disabled
    for (const [id, timer] of this.timers) {
      if (!activeIds.has(id)) {
        clearInterval(timer.intervalId)
        this.timers.delete(id)
        console.log(`[AutonomyManager] Timer cleared for ${id}`)
      }
    }
  }

  private async tick(sessionId: string): Promise<void> {
    const timer = this.timers.get(sessionId)
    if (!timer) return

    // Skip if agent is currently busy
    if (timer.busy) {
      console.log(`[AutonomyManager] Skipping wake for ${sessionId} — still busy`)
      return
    }

    const state = useTerminalStore.getState()
    const session = state.terminals.find((t) => t.id === sessionId)
    if (!session) return

    const autonomy = session.shellConfig?.creature?.autonomy
    if (!autonomy?.enabled || !autonomy.goal) return

    timer.busy = true
    timer.lastWakeTime = Date.now()

    const creature = session.shellConfig?.creature
    const roleLine = creature?.role ? `Your role: ${creature.role}.` : ''
    const skillsLine = creature?.skills?.length ? `Your skills: ${creature.skills.join(', ')}.` : ''

    const wakePrompt = [
      `[Autonomy Wakeup — ${new Date().toLocaleTimeString()}]`,
      roleLine,
      skillsLine,
      `Goal: ${autonomy.goal}`,
      '',
      'Inspect the current workspace state and execute your next step toward the goal.',
      'If you have completed the goal or there is nothing to do, report your status.',
    ]
      .filter(Boolean)
      .join('\n')

    const success = await this.sendWakePrompt(session, wakePrompt)

    // After a grace period, mark as not busy so the next tick can fire
    // The agent prompt itself may take time, so we wait 30s before allowing the next tick
    setTimeout(() => {
      const t = this.timers.get(sessionId)
      if (t) t.busy = false
    }, 30000)

    if (!success) {
      timer.busy = false
    }
  }

  private async sendWakePrompt(session: TerminalSession, prompt: string): Promise<boolean> {
    try {
      const creature = session.shellConfig?.creature
      const defaults = creature
        ? { model: creature.model, baseURL: creature.baseURL }
        : undefined

      await window.agentAPI.start(session.id, prompt, defaults)
      return true
    } catch (err) {
      console.error(`[AutonomyManager] Failed to wake agent ${session.id}:`, err)
      return false
    }
  }
}

// Singleton export
export const autonomyManager = new AgentAutonomyManager()
