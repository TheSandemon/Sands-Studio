// =============================================================================
// HabitatBus — Fast inter-agent message bus
// EventEmitter for in-process pub/sub + JSON file persistence
// =============================================================================

import { EventEmitter } from 'events'
import { join } from 'path'
import fs from 'fs'
import type {
  HabitatMessage,
  SendMessageInput,
  MessageQueryOpts,
  AgentStatusInfo,
  AgentStatus,
  FileEditEvent,
  CollisionResult,
  IntentPayload,
  HandoffBundle,
} from '../shared/habitatCommsTypes'
import { AgentStatusTracker } from './agent-status'
import { CollisionDetector } from './collision-detector'

// ---------------------------------------------------------------------------
// JSON file store — simple append-only log with periodic compaction
// ---------------------------------------------------------------------------
interface PersistedStore {
  messages: HabitatMessage[]
  intents: IntentPayload[]
  fileEdits: FileEditEvent[]
}

const STORE_FILE = (habitatId: string) =>
  join(process.cwd(), '.habitat', `hcom-${habitatId}.json`)

function loadStore(habitatId: string): PersistedStore {
  const path = STORE_FILE(habitatId)
  try {
    if (fs.existsSync(path)) {
      return JSON.parse(fs.readFileSync(path, 'utf8')) as PersistedStore
    }
  } catch (err) {
    console.warn('[HabitatBus] Failed to load store:', err)
  }
  return { messages: [], intents: [], fileEdits: [] }
}

function saveStore(habitatId: string, store: PersistedStore): void {
  const path = STORE_FILE(habitatId)
  try {
    fs.mkdirSync(join(process.cwd(), '.habitat'), { recursive: true })
    fs.writeFileSync(path, JSON.stringify(store, null, 2))
  } catch (err) {
    console.error('[HabitatBus] Failed to save store:', err)
  }
}

// ---------------------------------------------------------------------------
// HabitatBus
// ---------------------------------------------------------------------------
export class HabitatBus extends EventEmitter {
  private statusTracker: AgentStatusTracker
  private collisionDetector: CollisionDetector

  // In-memory agent registry: creatureId → { name, habitatId }
  private agentRegistry = new Map<string, { name: string; habitatId: string }>()

  // In-memory cache (supplements file store)
  private messageCache: HabitatMessage[] = []
  private readonly CACHE_MAX = 200

  private habitatId: string
  private store: PersistedStore
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private pruneTimer: ReturnType<typeof setInterval> | null = null

  // Dirty flag — store needs saving
  private dirty = false

  constructor(habitatId = 'global') {
    super()
    this.habitatId = habitatId
    this.statusTracker = new AgentStatusTracker()
    this.collisionDetector = new CollisionDetector()

    // Ensure .habitat directory exists
    fs.mkdirSync(join(process.cwd(), '.habitat'), { recursive: true })

    // Load persisted state
    this.store = loadStore(habitatId)

    // Rebuild collision detector from stored edits
    for (const edit of this.store.fileEdits) {
      const name = this.agentRegistry.get(edit.creatureId)?.name ?? edit.creatureId
      this.collisionDetector.record(edit.creatureId, edit.filePath, name)
    }

    // Prune expired messages every 10 minutes
    this.pruneTimer = setInterval(() => {
      this.purgeExpired().catch((err) => console.error('[HabitatBus] prune error:', err))
    }, 10 * 60 * 1000)

    console.log('[HabitatBus] Initialized for habitat:', habitatId)
  }

  // ---------------------------------------------------------------------------
  // Lazy save — debounced to avoid excessive disk writes
  // ---------------------------------------------------------------------------
  private scheduleSave(): void {
    this.dirty = true
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      if (this.dirty) {
        saveStore(this.habitatId, this.store)
        this.dirty = false
      }
      this.saveTimer = null
    }, 5000) // 5 second debounce
  }

  // ---------------------------------------------------------------------------
  // Agent registration
  // ---------------------------------------------------------------------------
  async registerAgent(creatureId: string, name: string, habitatId?: string): Promise<void> {
    const hid = habitatId ?? this.habitatId
    this.agentRegistry.set(creatureId, { name, habitatId: hid })
    this.statusTracker.register(creatureId, name)
    this.statusTracker.setStatus(creatureId, 'listening')
  }

  async unregisterAgent(creatureId: string): Promise<void> {
    this.agentRegistry.delete(creatureId)
    this.statusTracker.unregister(creatureId)
  }

  // ---------------------------------------------------------------------------
  // Core messaging
  // ---------------------------------------------------------------------------

  /**
   * Send a message — synchronously emits to local EventEmitter subscribers
   * and async-persists to JSON store.
   */
  async send(input: SendMessageInput): Promise<HabitatMessage> {
    const now = Date.now()
    const msg: HabitatMessage = {
      id: crypto.randomUUID(),
      type: input.type,
      sender: input.sender,
      senderName: input.senderName,
      recipients: input.recipients,
      threadId: input.threadId,
      content: input.content,
      intent: input.intent,
      timestamp: now,
      ttl: input.ttl ?? 24 * 60 * 60 * 1000, // 24 hours default
      expires_at: now + (input.ttl ?? 24 * 60 * 60 * 1000),
    }

    // Sync emit to local subscribers (microsecond delivery)
    this.emit('message', msg)

    // Update in-memory cache
    this.messageCache.push(msg)
    if (this.messageCache.length > this.CACHE_MAX) {
      this.messageCache.shift()
    }

    // Emit status-change if this is a status update
    if (msg.type === 'status_update') {
      this.emit('status-change', { id: msg.sender, name: msg.senderName, status: msg.content })
    }

    // Persist to store (async, debounced)
    this.store.messages.push(msg)
    this.scheduleSave()

    return msg
  }

  /** Send a private message to a specific creature */
  async sendDirect(
    recipientId: string,
    senderId: string,
    senderName: string,
    content: string
  ): Promise<HabitatMessage> {
    return this.send({
      type: 'direct',
      sender: senderId,
      senderName,
      recipients: [recipientId],
      content,
    })
  }

  /** Broadcast to all registered agents */
  async broadcast(senderId: string, senderName: string, content: string): Promise<HabitatMessage> {
    return this.send({
      type: 'broadcast',
      sender: senderId,
      senderName,
      recipients: [],
      content,
    })
  }

  /** Reply to an existing thread */
  async reply(
    threadId: string,
    senderId: string,
    senderName: string,
    content: string
  ): Promise<HabitatMessage> {
    return this.send({
      type: 'thread',
      sender: senderId,
      senderName,
      threadId,
      recipients: [],
      content,
    })
  }

  // ---------------------------------------------------------------------------
  // Intents
  // ---------------------------------------------------------------------------

  /** Claim an intent (e.g., file edit). Returns true if claimed, false if collision. */
  async claimIntent(creatureId: string, intent: IntentPayload): Promise<{ ok: boolean; collision?: CollisionResult }> {
    const collision = this.collisionDetector.check(intent.target)
    if (collision.hasCollision) {
      this.statusTracker.setBlocked(creatureId, `collision on ${intent.target}`, intent)
      this.emit('collision-detected', { ...collision, intent })
      return { ok: false, collision }
    }

    // Add to store
    this.store.intents.push(intent)
    this.scheduleSave()

    this.statusTracker.setIntent(creatureId, intent)
    await this.send({
      type: 'intent',
      sender: creatureId,
      senderName: this.agentRegistry.get(creatureId)?.name ?? creatureId,
      recipients: [],
      content: `claimed intent: ${intent.type} on ${intent.target}`,
      intent,
    })

    return { ok: true }
  }

  /** Release a previously claimed intent */
  async releaseIntent(creatureId: string, intentType: string, target: string): Promise<void> {
    this.store.intents = this.store.intents.filter(
      (i) => !(i.target === target && i.claimedBy === creatureId && i.type === intentType)
    )
    this.scheduleSave()

    this.statusTracker.clearIntent(creatureId)
    await this.send({
      type: 'intent',
      sender: creatureId,
      senderName: this.agentRegistry.get(creatureId)?.name ?? creatureId,
      recipients: [],
      content: `released intent: ${intentType} on ${target}`,
    })
  }

  /** Check active intents for a target */
  async checkIntents(target: string): Promise<IntentPayload[]> {
    const now = Date.now()
    return this.store.intents.filter(
      (i) => i.target === target && i.expiresAt > now
    )
  }

  // ---------------------------------------------------------------------------
  // File edit collision detection
  // ---------------------------------------------------------------------------

  /** Record a file edit event and check for collisions */
  async recordFileEdit(event: FileEditEvent): Promise<CollisionResult> {
    const creatureName = this.agentRegistry.get(event.creatureId)?.name ?? event.creatureId
    const result = this.collisionDetector.record(event.creatureId, event.filePath, creatureName, event.command)

    // Persist
    this.store.fileEdits.push(event)
    this.scheduleSave()

    if (result.hasCollision) {
      this.emit('collision-detected', result)
    }

    return result
  }

  /** Check if a file has recent edits from other creatures */
  checkCollision(filePath: string, windowMs = 30_000): CollisionResult {
    return this.collisionDetector.check(filePath, windowMs)
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Get messages for a specific creature (direct or broadcast, not expired) */
  async getMessages(creatureId: string, opts: MessageQueryOpts = {}): Promise<HabitatMessage[]> {
    const now = Date.now()
    const limit = opts.limit ?? 50

    const all = this.store.messages
      .filter((m) => {
        const expired = (m.expires_at ?? m.timestamp + m.ttl) <= now
        if (expired) return false
        if (opts.since && m.timestamp < opts.since) return false
        if (opts.type && m.type !== opts.type) return false
        // Direct messages: recipients must include creatureId or be empty (broadcast)
        if (m.recipients && m.recipients.length > 0 && !m.recipients.includes(creatureId)) return false
        return true
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)

    return all
  }

  /** Get all messages in a thread */
  async getThread(threadId: string): Promise<HabitatMessage[]> {
    return this.store.messages
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => a.timestamp - b.timestamp)
  }

  /** Get recent messages across the habitat */
  async getRecentMessages(creatureId: string, limit = 20): Promise<HabitatMessage[]> {
    const msgs = await this.getMessages(creatureId, { limit })
    return msgs.filter((m) => m.sender !== creatureId).slice(-limit)
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  getAgentStatus(creatureId: string): AgentStatusInfo | null {
    return this.statusTracker.getStatus(creatureId)
  }

  getAllAgentStatuses(): AgentStatusInfo[] {
    return this.statusTracker.getAllStatuses()
  }

  setAgentStatus(creatureId: string, status: AgentStatus): void {
    this.statusTracker.setStatus(creatureId, status)
  }

  // ---------------------------------------------------------------------------
  // Context handoff
  // ---------------------------------------------------------------------------

  async buildHandoffBundle(
    sourceCreatureId: string,
    targetCreatureId: string,
    getNotes: (creatureId: string) => string | null,
    getRecentMessagesFn: (creatureId: string, since: number) => Promise<HabitatMessage[]>,
    getSummary: (creatureId: string) => string
  ): Promise<HandoffBundle> {
    const since = Date.now() - 60 * 60 * 1000 // last hour

    return {
      sourceId: sourceCreatureId,
      targetId: targetCreatureId,
      summary: getSummary(sourceCreatureId),
      recentMessages: await getRecentMessagesFn(sourceCreatureId, since),
      notes: getNotes(sourceCreatureId) ?? '',
      timestamp: Date.now(),
    }
  }

  async sendHandoff(
    targetCreatureId: string,
    bundle: HandoffBundle
  ): Promise<HabitatMessage> {
    return this.send({
      type: 'handoff',
      sender: bundle.sourceId,
      senderName: this.agentRegistry.get(bundle.sourceId)?.name ?? bundle.sourceId,
      recipients: [targetCreatureId],
      content: JSON.stringify(bundle),
      intent: {
        type: 'context_handoff',
        target: bundle.sourceId,
        claimedBy: targetCreatureId,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 min
      },
      ttl: 60_000, // 1 min TTL for handoffs
    })
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  private async purgeExpired(): Promise<void> {
    const beforeCount = this.store.messages.length
    const now = Date.now()

    this.store.messages = this.store.messages.filter(
      (m) => (m.expires_at ?? m.timestamp + m.ttl) > now
    )
    this.store.intents = this.store.intents.filter((i) => i.expiresAt > now)

    // Prune old file edits (keep last 2 hours)
    const cutoff = Date.now() - 2 * 60 * 60 * 1000
    this.store.fileEdits = this.store.fileEdits.filter((e) => e.timestamp > cutoff)

    const pruned = beforeCount - this.store.messages.length
    if (pruned > 0) {
      console.log(`[HabitatBus] pruned ${pruned} expired messages`)
      this.scheduleSave()
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer)
      this.pruneTimer = null
    }
    // Final flush
    if (this.dirty) {
      saveStore(this.habitatId, this.store)
    }
    this.removeAllListeners()
  }
}
