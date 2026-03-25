// =============================================================================
// Module Engine — Action Sequencer
// Sits between tool execution and renderer event emission.
// Introduces temporal ordering so actions play out visually in sequence
// rather than all at once in a single frame.
// =============================================================================

import type { ModuleRendererEvent } from '../../shared/types'

export interface SequencedEvent {
  event: ModuleRendererEvent
  scheduledTime: number
  agentId: string
  sequenceId: string
}

export class ActionSequencer {
  private queue: SequencedEvent[] = []
  private paused = false
  private pauseOffset = 0
  private pauseStart = 0
  private tickInterval: ReturnType<typeof setInterval> | null = null
  private sendFn: (event: ModuleRendererEvent) => void
  private agentWaiters = new Map<string, Array<() => void>>()

  constructor(sendFn: (event: ModuleRendererEvent) => void) {
    this.sendFn = sendFn
  }

  /** Start the sequencer tick loop. Call once when the orchestrator starts. */
  start(): void {
    this.tickInterval = setInterval(() => this.tick(), 16) // ~60fps
  }

  /** Stop the sequencer and flush all pending events immediately. */
  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval)
      this.tickInterval = null
    }
    this.flush()
  }

  /** Pause the sequencer clock. Pending events are frozen. */
  pause(): void {
    if (this.paused) return
    this.paused = true
    this.pauseStart = Date.now()
  }

  /** Resume the sequencer clock. Offsets all scheduled times by pause duration. */
  resume(): void {
    if (!this.paused) return
    const pauseDuration = Date.now() - this.pauseStart
    this.pauseOffset += pauseDuration
    // Offset all pending events
    for (const item of this.queue) {
      item.scheduledTime += pauseDuration
    }
    this.paused = false
  }

  /**
   * Schedule renderer events with a delay.
   * @param events - The events to schedule
   * @param delayMs - Delay in ms from now
   * @param agentId - The agent that produced these events
   * @returns A sequenceId that can be used to track these events
   */
  schedule(events: ModuleRendererEvent[], delayMs: number, agentId: string): string {
    const sequenceId = `seq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const scheduledTime = Date.now() + delayMs

    for (const event of events) {
      this.queue.push({
        event,
        scheduledTime,
        agentId,
        sequenceId,
      })
    }

    // Sort by scheduled time
    this.queue.sort((a, b) => a.scheduledTime - b.scheduledTime)

    return sequenceId
  }

  /**
   * Wait until all pending events for a specific agent have been dispatched.
   * Returns a promise that resolves when done or when timeout is hit.
   */
  waitForAgent(agentId: string, timeoutMs = 5000): Promise<void> {
    // Check if there are any pending events for this agent
    const hasPending = this.queue.some((e) => e.agentId === agentId)
    if (!hasPending) return Promise.resolve()

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // Timeout: resolve anyway, remove waiter
        const waiters = this.agentWaiters.get(agentId)
        if (waiters) {
          const idx = waiters.indexOf(resolve)
          if (idx !== -1) waiters.splice(idx, 1)
        }
        resolve()
      }, timeoutMs)

      if (!this.agentWaiters.has(agentId)) {
        this.agentWaiters.set(agentId, [])
      }
      this.agentWaiters.get(agentId)!.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /** Check if there are any pending events for a specific agent. */
  hasPendingEvents(agentId: string): boolean {
    return this.queue.some((e) => e.agentId === agentId)
  }

  /** Get the number of pending events in the queue. */
  get pendingCount(): number {
    return this.queue.length
  }

  /** Process the tick — dispatch events whose time has come. */
  private tick(): void {
    if (this.paused || this.queue.length === 0) return

    const now = Date.now()
    const dispatched = new Set<string>() // track which agents had events dispatched

    while (this.queue.length > 0 && this.queue[0].scheduledTime <= now) {
      const item = this.queue.shift()!
      this.sendFn(item.event)
      dispatched.add(item.agentId)
    }

    // Notify waiters for agents that have no more pending events
    for (const agentId of dispatched) {
      if (!this.hasPendingEvents(agentId)) {
        const waiters = this.agentWaiters.get(agentId)
        if (waiters && waiters.length > 0) {
          for (const resolve of waiters) {
            resolve()
          }
          this.agentWaiters.delete(agentId)
        }
      }
    }
  }

  /** Flush all pending events immediately (on stop). */
  private flush(): void {
    for (const item of this.queue) {
      this.sendFn(item.event)
    }
    this.queue = []

    // Resolve all waiters
    for (const [, waiters] of this.agentWaiters) {
      for (const resolve of waiters) {
        resolve()
      }
    }
    this.agentWaiters.clear()
  }
}
