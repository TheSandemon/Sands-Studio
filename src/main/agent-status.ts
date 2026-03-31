// =============================================================================
// AgentStatusTracker — Manages per-creature status with auto-transitions
// =============================================================================

import type { AgentStatus, AgentStatusInfo, IntentPayload } from '../shared/habitatCommsTypes'

const IDLE_TIMEOUT_MS = 60_000       // active → listening after 60s idle
const BLOCKED_TIMEOUT_MS = 120_000    // blocked → listening after 2 min

interface StatusState {
  id: string
  name: string
  status: AgentStatus
  lastSeen: number
  currentIntent?: IntentPayload
  threadCount: number
  unreadCount: number
  idleTimer?: ReturnType<typeof setTimeout>
  blockedTimer?: ReturnType<typeof setTimeout>
}

export class AgentStatusTracker {
  private states = new Map<string, StatusState>()

  register(creatureId: string, name: string): void {
    if (this.states.has(creatureId)) return
    this.states.set(creatureId, {
      id: creatureId,
      name,
      status: 'inactive',
      lastSeen: Date.now(),
      threadCount: 0,
      unreadCount: 0,
    })
  }

  unregister(creatureId: string): void {
    const state = this.states.get(creatureId)
    if (state) {
      this.clearTimers(state)
      this.states.delete(creatureId)
    }
  }

  setStatus(creatureId: string, status: AgentStatus): void {
    const state = this.states.get(creatureId)
    if (!state) return

    this.clearTimers(state)
    state.status = status
    state.lastSeen = Date.now()

    if (status === 'active') {
      // Auto-transition to listening after idle timeout
      state.idleTimer = setTimeout(() => {
        if (state.status === 'active') {
          state.status = 'listening'
          state.lastSeen = Date.now()
        }
      }, IDLE_TIMEOUT_MS)
    }
  }

  setBlocked(creatureId: string, reason: string, intent: IntentPayload): void {
    const state = this.states.get(creatureId)
    if (!state) return

    this.clearTimers(state)
    state.status = 'blocked'
    state.currentIntent = intent
    state.lastSeen = Date.now()

    // Auto-unblock after timeout
    state.blockedTimer = setTimeout(() => {
      if (state.status === 'blocked') {
        state.status = 'listening'
        state.currentIntent = undefined
        state.lastSeen = Date.now()
      }
    }, BLOCKED_TIMEOUT_MS)
  }

  setIntent(creatureId: string, intent: IntentPayload): void {
    const state = this.states.get(creatureId)
    if (!state) return
    state.currentIntent = intent
  }

  clearIntent(creatureId: string): void {
    const state = this.states.get(creatureId)
    if (!state) return
    state.currentIntent = undefined

    // If was blocked by intent, maybe unblock
    if (state.status === 'blocked') {
      state.status = 'listening'
      state.lastSeen = Date.now()
    }
  }

  getStatus(creatureId: string): AgentStatusInfo | null {
    const state = this.states.get(creatureId)
    if (!state) return null
    return {
      id: state.id,
      name: state.name,
      status: state.status,
      lastSeen: state.lastSeen,
      currentIntent: state.currentIntent,
      threadCount: state.threadCount,
      unreadCount: state.unreadCount,
    }
  }

  getAllStatuses(): AgentStatusInfo[] {
    return Array.from(this.states.values()).map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      lastSeen: s.lastSeen,
      currentIntent: s.currentIntent,
      threadCount: s.threadCount,
      unreadCount: s.unreadCount,
    }))
  }

  incrementUnread(creatureId: string): void {
    const state = this.states.get(creatureId)
    if (state) state.unreadCount++
  }

  clearUnread(creatureId: string): void {
    const state = this.states.get(creatureId)
    if (state) state.unreadCount = 0
  }

  incrementThreadCount(creatureId: string): void {
    const state = this.states.get(creatureId)
    if (state) state.threadCount++
  }

  private clearTimers(state: StatusState): void {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer)
      state.idleTimer = undefined
    }
    if (state.blockedTimer) {
      clearTimeout(state.blockedTimer)
      state.blockedTimer = undefined
    }
  }
}
