// =============================================================================
// HabitatComms — Shared Types
// Fast inter-agent communication for Terminal Habitat
// =============================================================================

export type AgentStatus = 'active' | 'listening' | 'blocked' | 'inactive'
// active ▶    — agent is processing a message
// listening ◉ — idle, waiting for messages
// blocked ■   — file edit conflict or intent lock
// inactive ○  — not connected or disconnected

export type MessageType =
  | 'direct'       // private message to specific creature(s)
  | 'broadcast'    // message to all registered agents
  | 'thread'       // reply to a thread
  | 'intent'       // intent claim/release/denial
  | 'handoff'      // context handoff between agents
  | 'status_update' // status change notification

// -----------------------------------------------------------------------------
// Core message
// -----------------------------------------------------------------------------
export interface HabitatMessage {
  id: string            // uuid
  type: MessageType
  sender: string        // creatureId
  senderName: string
  recipients?: string[] // empty/undefined = broadcast; filled = direct/thread
  threadId?: string    // parent message id for threading
  content: string
  intent?: IntentPayload
  timestamp: number     // Date.now()
  ttl: number          // auto-expire after ttl ms (default 24h)
  /** Computed: timestamp + ttl — used internally for SQLite storage */
  expires_at?: number
}

export type IntentType = 'file_edit' | 'task' | 'context_handoff'

export interface IntentPayload {
  type: IntentType
  target: string       // file path, task id, or context bundle id
  claimedBy: string    // creatureId
  expiresAt: number    // timestamp when intent expires
}

// -----------------------------------------------------------------------------
// Agent status
// -----------------------------------------------------------------------------
export interface AgentStatusInfo {
  id: string
  name: string
  status: AgentStatus
  lastSeen: number   // Date.now()
  currentIntent?: IntentPayload
  threadCount: number
  unreadCount: number
}

// -----------------------------------------------------------------------------
// File edit collision detection
// -----------------------------------------------------------------------------
export interface FileEditEvent {
  creatureId: string
  filePath: string
  timestamp: number
  command?: string  // which command triggered this edit
}

export interface CollisionResult {
  hasCollision: boolean
  editingCreatures: Array<{ id: string; name: string; startedAt: number }>
  collisionWindowMs: number
}

// -----------------------------------------------------------------------------
// Context handoff
// -----------------------------------------------------------------------------
export interface HandoffBundle {
  sourceId: string
  targetId: string
  summary: string
  recentMessages: HabitatMessage[]
  notes: string
  timestamp: number
}

// -----------------------------------------------------------------------------
// IPC input types (what the renderer/main process send)
// -----------------------------------------------------------------------------
export interface SendMessageInput {
  type: MessageType
  sender: string
  senderName: string
  recipients?: string[]
  threadId?: string
  content: string
  intent?: IntentPayload
  ttl?: number
}

export interface MessageQueryOpts {
  since?: number
  type?: MessageType
  limit?: number
}
