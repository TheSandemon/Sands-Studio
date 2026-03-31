import { create } from 'zustand'
import type {
  HabitatMessage,
  AgentStatusInfo,
  CollisionResult,
  MessageType,
} from '../../shared/habitatCommsTypes'

// Thread: threadId → messages
interface Thread {
  id: string
  topic: string
  messages: HabitatMessage[]
  lastActivity: number
}

interface HabitatCommsStore {
  // Agent statuses: creatureId → AgentStatusInfo
  agentStatuses: Record<string, AgentStatusInfo>
  // Recent messages for the comms panel
  recentMessages: HabitatMessage[]
  // Active threads
  threads: Record<string, Thread>
  // Collision alerts (cleared after display)
  collisions: CollisionResult[]
  // Unread counts per creature
  unreadCounts: Record<string, number>
  // Last known statuses for the status bar
  statusBarStatuses: Array<{ id: string; name: string; icon: string; status: string }>

  // Actions
  updateStatus: (info: AgentStatusInfo) => void
  addMessage: (msg: HabitatMessage) => void
  addMessages: (msgs: HabitatMessage[]) => void
  addCollision: (result: CollisionResult) => void
  clearCollisions: () => void
  incrementUnread: (creatureId: string) => void
  clearUnread: (creatureId: string) => void
  updateStatusBarStatuses: () => void

  // Setup — call once at app init to wire up IPC listeners
  init: () => () => void
}

// Status icon helper
function statusIcon(status: string): string {
  switch (status) {
    case 'active': return '▶'
    case 'listening': return '◉'
    case 'blocked': return '■'
    case 'inactive': return '○'
    default: return '○'
  }
}

// Thread topic helper — extracts topic from broadcast content like "[Thread: topic] message"
function extractThreadTopic(content: string): string | null {
  const match = content.match(/^\[Thread:\s*(.+?)\]\s*/)
  return match ? match[1] : null
}

// Thread ID helper — generates stable ID from first message
function threadIdFromMessage(msg: HabitatMessage): string {
  return msg.threadId ?? msg.id
}

export const useHabitatCommsStore = create<HabitatCommsStore>((set, get) => ({
  agentStatuses: {},
  recentMessages: [],
  threads: {},
  collisions: [],
  unreadCounts: {},
  statusBarStatuses: [],

  updateStatus(info) {
    set((s) => ({
      agentStatuses: { ...s.agentStatuses, [info.id]: info },
      unreadCounts: {
        ...s.unreadCounts,
        [info.id]: (s.unreadCounts[info.id] ?? 0),
      },
    }))
    get().updateStatusBarStatuses()
  },

  addMessage(msg) {
    const s = get()

    // Update recent messages (keep last 50)
    const recentMessages = [msg, ...s.recentMessages].slice(0, 50)

    // Handle thread updates
    const threads = { ...s.threads }
    if (msg.type === 'thread' || msg.type === 'broadcast') {
      const threadId = threadIdFromMessage(msg)
      const topic = msg.type === 'broadcast' ? extractThreadTopic(msg.content) : `Thread ${threadId.slice(0, 8)}`
      const existing = threads[threadId]
      if (existing) {
        threads[threadId] = {
          ...existing,
          messages: [...existing.messages, msg],
          lastActivity: msg.timestamp,
        }
      } else {
        threads[threadId] = {
          id: threadId,
          topic: topic ?? `Thread ${threadId.slice(0, 8)}`,
          messages: [msg],
          lastActivity: msg.timestamp,
        }
      }
    }

    // Increment unread for recipients (excluding self)
    const recipients = msg.recipients ?? []
    const shouldIncrementSelf = recipients.includes('*') || (recipients.length === 0 && msg.type === 'broadcast')
    if (shouldIncrementSelf) {
      const otherTerminals = Object.keys(s.agentStatuses).filter((id) => id !== msg.sender)
      const unreadCounts = { ...s.unreadCounts }
      for (const id of otherTerminals) {
        unreadCounts[id] = (unreadCounts[id] ?? 0) + 1
      }
      set({ recentMessages, threads, unreadCounts })
    } else {
      set({ recentMessages, threads })
    }
  },

  addMessages(msgs) {
    for (const msg of msgs) {
      get().addMessage(msg)
    }
  },

  addCollision(result) {
    set((s) => ({
      collisions: [...s.collisions, result].slice(-10), // keep last 10
    }))
  },

  clearCollisions() {
    set({ collisions: [] })
  },

  incrementUnread(creatureId) {
    set((s) => ({
      unreadCounts: {
        ...s.unreadCounts,
        [creatureId]: (s.unreadCounts[creatureId] ?? 0) + 1,
      },
    }))
  },

  clearUnread(creatureId) {
    set((s) => ({
      unreadCounts: { ...s.unreadCounts, [creatureId]: 0 },
    }))
  },

  updateStatusBarStatuses() {
    const { agentStatuses } = get()
    const statuses = Object.values(agentStatuses).map((info) => ({
      id: info.id,
      name: info.name,
      icon: statusIcon(info.status),
      status: info.status,
    }))
    set({ statusBarStatuses: statuses })
  },

  // Returns an unsubscribe function — call from useEffect with cleanup
  init() {
    if (typeof window === 'undefined' || !window.habitatCommsAPI) {
      return () => {}
    }

    const unsubMessage = window.habitatCommsAPI.onMessage((msg: HabitatMessage) => {
      get().addMessage(msg)
    })

    const unsubStatus = window.habitatCommsAPI.onStatusChange((info: AgentStatusInfo) => {
      get().updateStatus(info)
    })

    const unsubCollision = window.habitatCommsAPI.onCollision((result: CollisionResult) => {
      get().addCollision(result)
    })

    // Initial status fetch
    window.habitatCommsAPI.getStatus().then((statuses) => {
      if (Array.isArray(statuses)) {
        for (const info of statuses) {
          get().updateStatus(info)
        }
      }
    }).catch(() => {})

    return () => {
      unsubMessage()
      unsubStatus()
      unsubCollision()
    }
  },
}))
