// =============================================================================
// Module Engine — Module Orchestrator
// Manages agent turn execution, scheduling, rate limiting, and the AI tool-use
// loop for running modules.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk'
import type { BrowserWindow } from 'electron'
import type {
  ModuleManifest,
  AgentRole,
  AgentStatus,
  ModuleRendererEvent,
  WorldState,
} from '../../shared/types'
import type { AIProviderClient } from './agent-pool'
import { AgentPool } from './agent-pool'
import { WorldStateManager } from '../../shared/WorldState'
import { getAnthropicTools, executeTool } from '../../shared/actionApi'
import { ActionSequencer } from './action-sequencer'
import type { GameTimer, StatusEffect, TriggerZone } from '../../shared/types'

// ── Rate Limiter ──────────────────────────────────────────────────────────────

export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>()

  canMakeRequest(agentId: string, rpmLimit: number): boolean {
    const now = Date.now()
    const window = this.windows.get(agentId)

    if (!window || now > window.resetAt) {
      this.windows.set(agentId, { count: 1, resetAt: now + 60_000 })
      return true
    }

    if (window.count >= rpmLimit) return false
    window.count++
    return true
  }

  canMakeGlobalRequest(globalRpmLimit: number, requestCounts: Map<string, number>): boolean {
    const total = Array.from(requestCounts.values()).reduce((a, b) => a + b, 0)
    return total < globalRpmLimit
  }

  reset(): void {
    this.windows.clear()
  }

  getState(): Map<string, { count: number; resetAt: number }> {
    return new Map(this.windows)
  }

  restoreState(state: Map<string, { count: number; resetAt: number }>): void {
    this.windows = new Map(state)
  }
}

// ── Queued Action (for parallel batch execution) ───────────────────────────────

export interface QueuedAction {
  roleId: string
  toolName: string
  params: Record<string, unknown>
}

// ── Mutex for safe concurrent WorldState access ──────────────────────────────

class Mutex {
  private locked = false
  private waiters: Array<() => void> = []

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
  }

  release(): void {
    if (this.waiters.length > 0) {
      const next = this.waiters.shift()!
      // Use setImmediate to avoid stack overflow on many sequential releases
      setImmediate(next)
    } else {
      this.locked = false
    }
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export interface OrchestratorAction {
  type: 'give_turn' | 'end_round' | 'pause' | 'resume'
  toAgentId?: string
}

export interface OrchestratorConfig {
  manifest: ModuleManifest
  roles: AgentRole[]
  worldState: WorldState
  win: BrowserWindow
  defaults?: { model?: string; apiKey?: string; baseURL?: string }
}

/** Serialized orchestrator state for save & survive. Stored to disk on module:stop. */
export interface ModuleSnapshot {
  manifest: ModuleManifest
  agentConfigs: AgentRole[]
  worldState: import('../../shared/types').SerializedWorldState
  messageHistory: Record<string, Anthropic.MessageParam[]>
  round: number
  tick: number
  pendingTurnQueue: string[]
  spawnPositions: Record<string, { col: number; row: number }>
  rateLimiterState: Record<string, { count: number; resetAt: number }>
  timestamp: number
}

export interface AgentTurnResult {
  roleId: string
  status: AgentStatus
  rendererEvents: ModuleRendererEvent[]
  orchestratorActions: OrchestratorAction[]
  queuedMutations: QueuedAction[]
  error?: string
}

export class ModuleOrchestrator {
  private config: OrchestratorConfig
  private wsManager: WorldStateManager
  private agentPool: AgentPool
  private rateLimiter: RateLimiter
  private running = false
  private paused = false
  private activeAgents = new Map<string, { status: AgentStatus }>()
  private requestCounts = new Map<string, number>()
  private messageHistory = new Map<string, Anthropic.MessageParam[]>()
  private currentRound = 0
  private pendingTurnQueue: string[] = []
  private spawnPositions = new Map<string, { col: number; row: number }>()
  private consecutiveErrors = new Map<string, number>()
  private statsInterval: ReturnType<typeof setInterval> | null = null
  private actionQueue: QueuedAction[] = []
  private mutex = new Mutex()
  private sequencer: ActionSequencer
  private pendingTimerFires: GameTimer[] = []
  private pendingTriggerFires: Array<{ triggerId: string; triggerName: string; entityId: string; fireType: string; data: Record<string, unknown> }> = []
  private pendingExpiredEffects: StatusEffect[] = []

  constructor(config: OrchestratorConfig) {
    this.config = config
    this.wsManager = new WorldStateManager(config.worldState)
    this.agentPool = new AgentPool(config.defaults ?? {})
    this.rateLimiter = new RateLimiter()
    this.sequencer = new ActionSequencer((event) => this.sendRendererEvent(event))
  }

  async start(): Promise<void> {
    this.running = true
    this.paused = false

    // Initialize agent statuses — send these BEFORE 'running' so renderer
    // can log agent initialization steps while still on the loading screen
    for (const role of this.config.roles) {
      this.activeAgents.set(role.id, { status: 'idle' })
      this.messageHistory.set(role.id, [])
      this.sendAgentStatus(role.id, 'idle')
    }

    // Capture initial entity positions as spawn points (used by {{spawnPosition}} template)
    for (const [id, entity] of Object.entries(this.config.worldState.entities)) {
      if (entity.position) this.spawnPositions.set(id, { ...(entity.position as { col: number; row: number }) })
    }

    // Initial state sync to renderer
    this.sendWorldState()

    // Determine initial turn order based on scheduling
    if (this.config.manifest.scheduling === 'round-robin') {
      this.pendingTurnQueue = this.config.roles.map((r) => r.id)
    } else if (this.config.manifest.scheduling === 'orchestrated') {
      // Orchestrator acts first to set the scene
      const orchestrator = this.config.roles.find((r) => r.isOrchestrator)
      if (orchestrator) {
        this.pendingTurnQueue = [orchestrator.id]
      }
    } else {
      // free-for-all: everyone can act
      this.pendingTurnQueue = this.config.roles.map((r) => r.id)
    }

    // Signal 'running' after all setup IPC messages are dispatched
    this.sendModuleStatus('running')

    // Start action sequencer
    this.sequencer.start()

    // Start periodic stats broadcast
    this.statsInterval = setInterval(() => this.sendStats(), 10_000)

    // Pre-warm all agent clients in parallel — eliminates first-turn cold-start latency
    await this.agentPool.prewarmAll(this.config.roles)

    // Start the run loop
    this.runLoop()
  }

  stop(): void {
    this.running = false
    this.sequencer.stop()
    if (this.statsInterval) {
      clearInterval(this.statsInterval)
      this.statsInterval = null
    }
    this.agentPool.close()
    this.rateLimiter.reset()
    this.sendModuleStatus('stopped')
  }

  pause(): void {
    this.paused = true
    this.sequencer.pause()
    this.rateLimiter.reset()
    this.sendModuleStatus('paused')
  }

  resume(): void {
    this.paused = false
    this.sequencer.resume()
    this.rateLimiter.reset()
    this.sendModuleStatus('running')
    this.runLoop()
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      if (this.paused) {
        await this.sleep(100)
        continue
      }

      // ── Tick timers & status effects ──────────────────────────────────────
      const firedTimers = this.wsManager.tickTimers(this.wsManager.getTick(), Date.now())
      if (firedTimers.length > 0) {
        this.pendingTimerFires.push(...firedTimers)
      }
      const expiredEffects = this.wsManager.tickStatusEffects(this.wsManager.getTick())
      if (expiredEffects.length > 0) {
        this.pendingExpiredEffects.push(...expiredEffects)
      }

      // Drain renderer events produced by timer/effect ticking and send them
      const tickEvents = this.wsManager.drainRendererEvents()
      for (const evt of tickEvents) {
        this.sendRendererEvent(evt)
        // Capture trigger fires for DM context
        if (evt.type === 'trigger_fired') {
          this.pendingTriggerFires.push({
            triggerId: evt.triggerId,
            triggerName: evt.triggerName,
            entityId: evt.entityId,
            fireType: evt.fireType,
            data: evt.data,
          })
        }
      }

      const scheduling = this.config.manifest.scheduling

      if (scheduling === 'free-for-all') {
        // ── PARALLEL PHASE ──────────────────────────────────────────────────────
        // Fire all agent LLM calls simultaneously
        this.actionQueue = []

        const turnPromises = this.pendingTurnQueue.map(async (roleId) => {
          // Rate-limit check — if throttled, skip this cycle
          const pacing = this.config.manifest.pacing
          if (!this.rateLimiter.canMakeRequest(roleId, pacing.maxRequestsPerAgent)) {
            return
          }
          this.requestCounts.set(roleId, (this.requestCounts.get(roleId) ?? 0) + 1)
          this.sendAgentStatus(roleId, 'thinking')

          try {
            const result = await this.executeAgentTurnQueued(roleId)
            if (result.error) {
              const n = (this.consecutiveErrors.get(roleId) ?? 0) + 1
              this.consecutiveErrors.set(roleId, n)
              if (n === 1) await this.sleep(Math.min(3000, 60_000))
            } else {
              this.consecutiveErrors.delete(roleId)
            }
          } catch (err) {
            console.error(`[orchestrator] free-for-all turn error for ${roleId}:`, err)
            const n = (this.consecutiveErrors.get(roleId) ?? 0) + 1
            this.consecutiveErrors.set(roleId, n)
          }
        })

        await Promise.all(turnPromises)

        // ── BATCH APPLY PHASE ────────────────────────────────────────────────────
        // Transfer queued mutations from all agents into this.actionQueue
        for (const roleId of this.pendingTurnQueue) {
          const result = this.agentTurnResults.get(roleId)
          if (result) {
            this.actionQueue.push(...result.queuedMutations)
          }
        }
        // Apply all queued actions in order
        await this.applyActionQueue()

        // ── EVENTS PHASE ─────────────────────────────────────────────────────────
        // Collect and batch-send all renderer events from all agents
        const allEvents: ModuleRendererEvent[] = []
        for (const roleId of this.pendingTurnQueue) {
          const result = this.agentTurnResults.get(roleId)
          if (result) {
            allEvents.push(...result.rendererEvents)
            for (const action of result.orchestratorActions) {
              this.handleOrchestratorAction(action)
            }
          }
        }
        this.agentTurnResults.clear()

        for (const event of allEvents) {
          this.sendRendererEvent(event)
        }
        this.sendWorldState()

        // Mark all agents as done for this round
        for (const roleId of this.pendingTurnQueue) {
          this.sendAgentStatus(roleId, 'done')
        }

        // Re-queue for next cycle
        await this.sleep(this.config.manifest.pacing.burstCooldownMs)
        this.pendingTurnQueue = this.config.roles.map((r) => r.id)

      } else {
        // ── SERIAL EXECUTION (orchestrated / round-robin) ───────────────────────
        const roleId = this.pendingTurnQueue.shift()
        if (!roleId) {
          // Queue empty — end of round for round-robin
          if (scheduling === 'round-robin') {
            this.currentRound++
            this.pendingTurnQueue = this.config.roles.map((r) => r.id)
            this.sendRendererEvent({ type: 'round_started', round: this.currentRound })
          } else {
            // orchestrated: wait before re-queueing orchestrator
            await this.sleep(this.config.manifest.pacing.burstCooldownMs)
            const orchestrator = this.config.roles.find((r) => r.isOrchestrator)
            if (orchestrator) this.pendingTurnQueue = [orchestrator.id]
          }
        }

        if (roleId) {
          const result = await this.executeAgentTurn(roleId)
          const agent = this.activeAgents.get(roleId)
          if (agent && scheduling !== 'round-robin') {
            if (result.status === 'error') {
              const n = (this.consecutiveErrors.get(roleId) ?? 0) + 1
              this.consecutiveErrors.set(roleId, n)
              await this.sleep(Math.min(3000 * Math.pow(2, n - 1), 60_000))
            } else {
              this.consecutiveErrors.delete(roleId)
            }
            this.pendingTurnQueue.push(roleId)
          }
        }
      }
    }
  }

  // Per-agent results from the parallel free-for-all phase
  private agentTurnResults = new Map<string, AgentTurnResult>()

  private async executeAgentTurn(roleId: string): Promise<AgentTurnResult> {
    const role = this.config.roles.find((r) => r.id === roleId)
    if (!role) return { roleId, status: 'error', rendererEvents: [], orchestratorActions: [], error: 'Role not found' }

    const pacing = this.config.manifest.pacing

    // Rate limit check
    if (!this.rateLimiter.canMakeRequest(roleId, pacing.maxRequestsPerAgent)) {
      // Throttled — re-queue for later
      this.pendingTurnQueue.push(roleId)
      return { roleId, status: 'idle', rendererEvents: [], orchestratorActions: [] }
    }
    // Track request counts for stats broadcast
    this.requestCounts.set(roleId, (this.requestCounts.get(roleId) ?? 0) + 1)

    // Create AI client if needed
    let client: AIProviderClient
    try {
      client = await this.agentPool.createClient(role)
    } catch (err) {
      console.error(`[orchestrator] Failed to create client for agent ${roleId}:`, err)
      this.sendAgentStatus(roleId, 'error')
      return { roleId, status: 'error', rendererEvents: [], orchestratorActions: [], error: String(err) }
    }

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(role)

    // Get tool list
    const tools = getAnthropicTools(role.tools, role.isOrchestrator)

    // Build messages with context
    const messages = this.buildMessages(role)

    this.sendAgentStatus(roleId, 'thinking')

    try {
      const orchestratorActions: OrchestratorAction[] = []
      const visualEvents: ModuleRendererEvent[] = []
      const textParts: string[] = []

      // Multi-turn tool use loop — runs until end_turn or MAX_TOOL_ROUNDS
      const currentMessages = [...messages]
      const MAX_TOOL_ROUNDS = 10

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await client.createMessage({
          model: undefined,  // Use client's stored resolved model (from settings defaults)
          system: systemPrompt,
          messages: currentMessages,
          tools,
          maxTokens: 4096,
        })

        const toolResults: Anthropic.ToolResultBlockParam[] = []

        for (const block of response.content) {
          if (block.type === 'text' && block.text.trim()) {
            textParts.push(block.text)
          }

          if (block.type === 'tool_use') {
            const toolBlock = block as Anthropic.ToolUseBlock
            const params = toolBlock.input as Record<string, unknown>

            const entityId = role.entityId ?? roleId
            const entity = this.wsManager.getEntity(entityId)
            const currentEntityPosition = entity?.position

            const toolStart = Date.now()
            const result = executeTool(toolBlock.name, params, {
              roleId: role.id,
              isOrchestrator: role.isOrchestrator,
              worldState: this.wsManager,
              rendererEvents: visualEvents,
              orchestratorActions,
              currentEntityPosition,
            })
            this.sendAgentLog({
              roleId: role.id,
              tool: toolBlock.name,
              params,
              result: result.success ? result.data : { error: result.error },
              success: result.success,
              latencyMs: Date.now() - toolStart,
              tick: this.wsManager.getTick(),
            })

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: result.success
                ? JSON.stringify(result.data ?? { ok: true })
                : `Error: ${result.error}`,
            })

            // NON-BLOCKING: Immediately send WorldState mutations to renderer
            // so animations start playing while the next LLM round processes.
            // If the tool specified a delay, route through the sequencer instead.
            const toolDelay = (params.delay as number) ?? 0
            const pendingWsEvents = this.wsManager.drainRendererEvents()
            if (toolDelay > 0) {
              this.sequencer.schedule(pendingWsEvents, toolDelay, role.id)
            } else {
              for (const evt of pendingWsEvents) {
                this.sendRendererEvent(evt)
              }
            }

            // Capture trigger fires for DM context
            for (const evt of pendingWsEvents) {
              if (evt.type === 'trigger_fired') {
                this.pendingTriggerFires.push({
                  triggerId: evt.triggerId,
                  triggerName: evt.triggerName,
                  entityId: evt.entityId,
                  fireType: evt.fireType,
                  data: evt.data,
                })
              }
            }

            // Handle wait_for_animations — block until sequencer drains this agent's events
            if (toolBlock.name === 'wait_for_animations') {
              const timeout = (params.timeout as number) ?? 5000
              await this.sequencer.waitForAgent(role.id, timeout)
            }

            // Handle give_turn IMMEDIATELY so the next agent's turn starts
            // without waiting for the orchestrator's full turn to complete.
            // This is critical for overlapping LLM latency with animation playback.
            if (toolBlock.name === 'give_turn') {
              const toAgentId = params.toAgentId as string | undefined
              if (toAgentId) {
                this.pendingTurnQueue.unshift(toAgentId)
                // Camera should follow whoever just got control
                this.sendRendererEvent({ type: 'camera_follow', entityId: toAgentId })
              }
            }
          }
        }

        // Done when no more tool calls
        if (response.stopReason !== 'tool_use' || toolResults.length === 0) break

        // Append this exchange and continue
        currentMessages.push({ role: 'assistant', content: response.content })
        currentMessages.push({ role: 'user', content: toolResults })
      }

      // If DM/narrator said anything, show it
      if (textParts.length > 0) {
        const fullText = textParts.join('\n')
        if (role.isOrchestrator) {
          visualEvents.push({ type: 'narration', text: fullText, style: 'normal' })
        } else {
          // Show as speech bubble on the entity this agent controls
          const entityId = role.entityId ?? roleId
          visualEvents.push({ type: 'speech', entityId, text: fullText, duration: 4000 })
        }
      }

      // Handle remaining orchestrator actions (end_round, pause, resume — NOT give_turn, already handled)
      for (const action of orchestratorActions) {
        if (action.type === 'give_turn') {
          // Already handled above — skip
        } else if (action.type === 'end_round') {
          this.currentRound++
          this.pendingTurnQueue = this.config.roles.filter((r) => !r.isOrchestrator).map((r) => r.id)
          visualEvents.push({ type: 'round_started', round: this.currentRound })
        } else if (action.type === 'pause') {
          this.pause()
        } else if (action.type === 'resume') {
          this.resume()
        }
      }

      // Drain any remaining WSM events (from non-mutation tools)
      const wsEvents = this.wsManager.drainRendererEvents()

      // Send all events: WSM mutations first, then visual events
      const allEvents = [...wsEvents, ...visualEvents]
      for (const event of allEvents) {
        this.sendRendererEvent(event)
      }

      this.sendAgentStatus(roleId, 'done')

      // Sync updated world state to renderer after each turn
      this.sendWorldState()

      // Persist conversation for rolling history (only if agentMemory is enabled)
      this.appendToHistory(roleId, currentMessages.slice(1)) // skip the initial user bootstrap msg

      return { roleId, status: 'done', rendererEvents: allEvents, orchestratorActions }

    } catch (err) {
      console.error(`[orchestrator] executeAgentTurn error for ${roleId}:`, err)
      this.sendAgentStatus(roleId, 'error')
      return { roleId, status: 'error', rendererEvents: [], orchestratorActions: [], error: String(err) }
    }
  }

  /**
   * Parallelized turn execution for free-for-all mode.
   * Fires LLM call, captures actions into actionQueue (no WorldState mutations),
   * returns rendererEvents + orchestratorActions without applying mutations.
   */
  private async executeAgentTurnQueued(roleId: string): Promise<AgentTurnResult> {
    const role = this.config.roles.find((r) => r.id === roleId)
    if (!role) return { roleId, status: 'error', rendererEvents: [], orchestratorActions: [], queuedMutations: [], error: 'Role not found' }

    const client = this.agentPool.getClient(roleId)
    if (!client) {
      try {
        await this.agentPool.createClient(role)
      } catch (err) {
        return { roleId, status: 'error', rendererEvents: [], orchestratorActions: [], queuedMutations: [], error: String(err) }
      }
    }
    const activeClient = this.agentPool.getClient(roleId)!

    const systemPrompt = this.buildSystemPrompt(role)
    const tools = getAnthropicTools(role.tools, role.isOrchestrator)
    const messages = this.buildMessages(role)

    const queuedMutations: QueuedAction[] = []
    const orchestratorActions: OrchestratorAction[] = []
    const visualEvents: ModuleRendererEvent[] = []
    const textParts: string[] = []
    const currentMessages = [...messages]
    const MAX_TOOL_ROUNDS = 10

    // Queue action — captures mutations into queuedMutations (NOT applied yet)
    const queueAction = (action: { toolName: string; params: Record<string, unknown> }) => {
      queuedMutations.push({ roleId: role.id, ...action })
    }

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await activeClient.createMessage({
          model: undefined,  // Use client's stored resolved model (from settings defaults)
          system: systemPrompt,
          messages: currentMessages,
          tools,
          maxTokens: 4096,
        })

        const toolResults: Anthropic.ToolResultBlockParam[] = []

        for (const block of response.content) {
          if (block.type === 'text' && block.text.trim()) {
            textParts.push(block.text)
          }

          if (block.type === 'tool_use') {
            const toolBlock = block as Anthropic.ToolUseBlock
            const params = toolBlock.input as Record<string, unknown>

            const entityId = role.entityId ?? roleId
            const entity = this.wsManager.getEntity(entityId)
            const currentEntityPosition = entity?.position

            const toolStart = Date.now()
            const result = executeTool(toolBlock.name, params, {
              roleId: role.id,
              isOrchestrator: role.isOrchestrator,
              worldState: this.wsManager,
              rendererEvents: visualEvents,
              orchestratorActions,
              currentEntityPosition,
              queuing: true,
              queueAction,
            })

            this.sendAgentLog({
              roleId: role.id,
              tool: toolBlock.name,
              params,
              result: result.success ? result.data : { error: result.error },
              success: result.success,
              latencyMs: Date.now() - toolStart,
              tick: this.wsManager.getTick(),
            })

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: result.success
                ? JSON.stringify(result.data ?? { ok: true })
                : `Error: ${result.error}`,
            })
          }
        }

        if (response.stopReason !== 'tool_use' || toolResults.length === 0) break

        currentMessages.push({ role: 'assistant', content: response.content })
        currentMessages.push({ role: 'user', content: toolResults })
      }

      // Speech / narration text — pushed to visualEvents for renderer
      if (textParts.length > 0) {
        const fullText = textParts.join('\n')
        if (role.isOrchestrator) {
          visualEvents.push({ type: 'narration', text: fullText, style: 'normal' })
        } else {
          const entityId = role.entityId ?? roleId
          visualEvents.push({ type: 'speech', entityId, text: fullText, duration: 4000 })
        }
      }

      // Store result for collection in runLoop events phase
      this.agentTurnResults.set(roleId, { roleId, status: 'done', rendererEvents: visualEvents, orchestratorActions, queuedMutations })
      return { roleId, status: 'done', rendererEvents: visualEvents, orchestratorActions, queuedMutations }

    } catch (err) {
      console.error(`[orchestrator] executeAgentTurnQueued error for ${roleId}:`, err)
      return { roleId, status: 'error', rendererEvents: visualEvents, orchestratorActions: [], queuedMutations: [], error: String(err) }
    }
  }

  /** Apply all queued actions in order with mutex protection, then drain renderer events. */
  private async applyActionQueue(): Promise<void> {
    const actions = this.actionQueue
    this.actionQueue = []

    for (const action of actions) {
      await this.mutex.acquire()
      try {
        const role = this.config.roles.find((r) => r.id === action.roleId)
        const entityId = role?.entityId ?? action.roleId
        const entity = this.wsManager.getEntity(entityId)
        const currentEntityPosition = entity?.position

        // Execute the tool mutation against WorldState (no queuing)
        const result = executeTool(action.toolName, action.params, {
          roleId: action.roleId,
          isOrchestrator: role?.isOrchestrator ?? false,
          worldState: this.wsManager,
          rendererEvents: [],
          orchestratorActions: [],
          currentEntityPosition,
        })

        this.sendAgentLog({
          roleId: action.roleId,
          tool: action.toolName,
          params: action.params,
          result: result.success ? result.data : { error: result.error },
          success: result.success,
          latencyMs: 0,
          tick: this.wsManager.getTick(),
        })
      } finally {
        this.mutex.release()
      }
    }

    // Drain all WorldState renderer events produced during batch application
    const wsEvents = this.wsManager.drainRendererEvents()
    // Prepend WSM events to each agent's rendererEvents
    for (const [roleId, result] of this.agentTurnResults.entries()) {
      result.rendererEvents.unshift(...wsEvents)
    }
  }

  private handleOrchestratorAction(action: OrchestratorAction): void {
    if (action.type === 'give_turn' && action.toAgentId) {
      if (!this.pendingTurnQueue.includes(action.toAgentId)) {
        this.pendingTurnQueue.unshift(action.toAgentId)
      }
    } else if (action.type === 'end_round') {
      this.currentRound++
      this.pendingTurnQueue = this.config.roles.filter((r) => !r.isOrchestrator).map((r) => r.id)
    } else if (action.type === 'pause') {
      this.pause()
    } else if (action.type === 'resume') {
      this.resume()
    }
  }

  private buildSystemPrompt(role: AgentRole): string {
    // Fill in template placeholders
    let prompt = role.systemPromptTemplate

    const serialized = this.wsManager.getSerialized()
    const worldSummary = {
      tick: serialized.tick,
      round: this.currentRound,
      entityCount: serialized.entities.length,
      entities: serialized.entities.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        position: e.position,
        state: e.state,
        hp: e.properties['hp'],
      })),
      worldType: serialized.worldType,
    }

    const myEntityId = role.entityId ?? role.id
    const myEntity = this.wsManager.getEntity(myEntityId)
    const spawnPos = this.spawnPositions.get(myEntityId)

    // Build fired timer/trigger/effect context for orchestrator agents
    const firedTimersContext = this.pendingTimerFires.length > 0
      ? JSON.stringify(this.pendingTimerFires.map((t) => ({ id: t.id, name: t.name, data: t.data })))
      : '[]'
    const firedTriggersContext = this.pendingTriggerFires.length > 0
      ? JSON.stringify(this.pendingTriggerFires)
      : '[]'
    const expiredEffectsContext = this.pendingExpiredEffects.length > 0
      ? JSON.stringify(this.pendingExpiredEffects.map((e) => ({ name: e.name, entityId: e.entityId })))
      : '[]'

    prompt = prompt
      .replace('{{worldState}}', JSON.stringify(worldSummary, null, 2))
      .replace('{{recentEvents}}', JSON.stringify(serialized.events.slice(-20)))
      .replace('{{role}}', role.name)
      .replace('{{name}}', role.name)
      .replace('{{personality}}', role.personality)
      .replace('{{entityId}}', myEntityId)
      .replace('{{spawnPosition}}', JSON.stringify(spawnPos ?? null))
      .replace('{{myHp}}', String(myEntity?.properties['hp'] ?? 'unknown'))
      .replace('{{myState}}', myEntity?.state ?? 'unknown')
      .replace('{{wins}}', String(myEntity?.properties['wins'] ?? 0))
      .replace('{{firedTimers}}', firedTimersContext)
      .replace('{{firedTriggers}}', firedTriggersContext)
      .replace('{{expiredEffects}}', expiredEffectsContext)

    // Clear pending notifications after injecting them into prompt
    if (role.isOrchestrator) {
      this.pendingTimerFires = []
      this.pendingTriggerFires = []
      this.pendingExpiredEffects = []
    }

    // Add orchestrator instructions if applicable
    if (role.isOrchestrator) {
      const orchestratorInstructions = `

You are the game master for this module. Your job is to make the game
VISUALLY ENTERTAINING to WATCH by spectators.

EVERY round you must produce at least 2-3 visible changes on screen:
  - spawn_entity or move_entity to show action happening on screen
  - narrate() to describe what the player sees right now
  - After any damage_entity, narrate() the impact ("The blade connects!")
  - When a creature dies, narrate() with dramatic flair

Pacing:
  - Call end_round() every 3-5 turns to let things breathe
  - Between rounds, narrate what happened and set up the next challenge
  - Keep narration SHORT (1-3 sentences) so it doesn't block action

The spectator is watching sprites move, HP bars change, and effects play.
Your narrations and actions are what they SEE. Make it dynamic.

IMPORTANT: Always prefer move_entity + narrate() over only narrate().
Show, don't just tell. Use show_effect() for magic and impacts.
Use give_turn() to let player agents act, then react to their choices.

== GAME PRIMITIVES ==

Action Sequencing: Mutation tools (move_entity, damage_entity, narrate, etc.) accept
an optional "delay" param (ms) to create cinematic sequences instead of everything
happening at once. Call wait_for_animations() to pause until all your delayed actions
have played out before continuing.

Timers: Use create_timer() to schedule recurring or one-shot game events (poison ticks,
spawn waves, weather changes). When timers fire, they appear in your context below.
Act on them — apply damage, trigger effects, advance the story.

Triggers/Areas: Use create_trigger() to define spatial zones (traps, cutscene triggers,
zone buffs). When entities enter/exit these zones, triggered events appear in your context.
Respond by narrating and applying consequences.

Status Effects: Use apply_status_effect() for buffs/debuffs with tick or time durations.
When effects expire, they appear in your context — narrate the change.

Inventory: Use give_item(), equip_item(), transfer_item(), use_item() to manage entity
inventories. Items are structured objects with types, tags, and properties.

Groups/Teams: Use create_group(), add_to_group() to organize entities into factions,
parties, or teams for batch logic.

Pathfinding: Use find_path() to get optimal A* grid paths. Returns the path as an array
of positions — use it to plan multi-step movement sequences.

State Machines: Use create_state_machine() for objects with named states and valid
transitions (doors: locked→unlocked→open, quests: inactive→active→completed).

Relationships: Use create_relationship() to track entity-to-entity links (ally, enemy,
owner, summon_of). Auto-cleaned when entities are removed.

== DYNAMIC CONTEXT ==

Your prompt may include these sections populated by the engine:
  {{firedTimers}} — Timers that fired since your last turn. Process their effects.
  {{firedTriggers}} — Spatial triggers activated by entity movement. Apply consequences.
  {{expiredEffects}} — Status effects that just expired. Narrate the change.
`
      prompt += orchestratorInstructions
    } else {
      // Non-orchestrator (player/peer) agent instructions
      const playerInstructions = `

EVERY turn you must produce visible action:
  1. Call move_entity() FIRST to show yourself moving toward the action
  2. Call show_speech_bubble() with a short quip or battle cry (under 10 words)
  3. Call damage_entity() on an enemy if one is nearby
  4. Call narrate() to describe what happened

Keep speech bubbles SHORT (under 10 words). Spectators read them live.
Move, THEN narrate. Never just narrate without moving first.

You may also have access to these tools — use them to make informed decisions:
  - get_inventory / equip_item / use_item — manage your items
  - get_status_effects — check your active buffs/debuffs
  - find_path / get_path_distance — plan efficient movement
  - get_entity_groups — know your team/faction
  - wait_for_animations — sequence your actions cinematically with delay params
`
      prompt += playerInstructions
    }

    return prompt
  }

  private buildMessages(role: AgentRole): Anthropic.MessageParam[] {
    const windowSize = this.config.manifest.agentMemory ?? 0
    const baseMsg: Anthropic.MessageParam = {
      role: 'user',
      content: 'It is your turn. Your system prompt has the current world state and recent events. Act now using your tools.',
    }
    if (windowSize <= 0) return [baseMsg]
    // Rolling history: prepend base user message, then append prior turns
    const history = this.messageHistory.get(role.id) ?? []
    return [baseMsg, ...history]
  }

  private appendToHistory(roleId: string, newMessages: Anthropic.MessageParam[]): void {
    const windowSize = this.config.manifest.agentMemory ?? 0
    if (windowSize <= 0 || newMessages.length === 0) return
    const history = this.messageHistory.get(roleId) ?? []
    history.push(...newMessages)
    // Keep only the last N message pairs (user+assistant = 2 entries per round)
    const max = windowSize * 2
    if (history.length > max) history.splice(0, history.length - max)
    this.messageHistory.set(roleId, history)
  }

  // ── Snapshot / Save & Survive ────────────────────────────────────────────

  /** Serialize the full orchestrator state to a portable snapshot object (no API keys). */
  serialize(): ModuleSnapshot {
    // Strip API keys from agent configs before serializing
    const agentConfigs = this.config.roles.map(({ apiKey: _apiKey, ...rest }) => rest)

    return {
      manifest: this.config.manifest,
      agentConfigs: agentConfigs as AgentRole[],
      worldState: this.wsManager.getSerialized(),
      messageHistory: Object.fromEntries(this.messageHistory),
      round: this.currentRound,
      tick: this.wsManager.getTick(),
      pendingTurnQueue: [...this.pendingTurnQueue],
      spawnPositions: Object.fromEntries(this.spawnPositions),
      rateLimiterState: Object.fromEntries(this.rateLimiter.getState()),
      timestamp: Date.now(),
    }
  }

  /** Reconstruct a ModuleOrchestrator from a snapshot. Call start() on the returned instance to resume. */
  static async restore(snapshot: ModuleSnapshot, win: BrowserWindow, defaults?: { model?: string; apiKey?: string; baseURL?: string }): Promise<ModuleOrchestrator> {
    const orchestrator = new ModuleOrchestrator({
      manifest: snapshot.manifest,
      roles: snapshot.agentConfigs,
      worldState: snapshot.worldState as WorldState,
      win,
      defaults,
    })

    // Restore runtime state
    orchestrator.currentRound = snapshot.round
    orchestrator.pendingTurnQueue = [...snapshot.pendingTurnQueue]

    // Restore message history
    for (const [roleId, msgs] of Object.entries(snapshot.messageHistory)) {
      orchestrator.messageHistory.set(roleId, msgs as Anthropic.MessageParam[])
    }

    // Restore spawn positions
    for (const [id, pos] of Object.entries(snapshot.spawnPositions)) {
      orchestrator.spawnPositions.set(id, pos as { col: number; row: number })
    }

    // Restore rate limiter windows
    orchestrator.rateLimiter.restoreState(new Map(Object.entries(snapshot.rateLimiterState)))

    // Mark agents as active
    for (const role of snapshot.agentConfigs) {
      orchestrator.activeAgents.set(role.id, { status: 'idle' })
    }

    return orchestrator
  }

  // ── IPC Helpers ────────────────────────────────────────────────────────

  private sendRendererEvent(event: ModuleRendererEvent): void {
    if (!this.config.win.isDestroyed()) {
      this.config.win.webContents.send('module:event', event)
    }
  }

  private sendWorldState(): void {
    if (!this.config.win.isDestroyed()) {
      // getSerialized() returns entities as Entity[] — correct for the renderer
      this.config.win.webContents.send('module:state', this.wsManager.getSerialized())
    }
  }

  private sendAgentStatus(roleId: string, status: AgentStatus): void {
    if (!this.config.win.isDestroyed()) {
      this.config.win.webContents.send('module:agent-status', roleId, status)
    }
  }

  private sendModuleStatus(status: string): void {
    if (!this.config.win.isDestroyed()) {
      this.config.win.webContents.send('module:status', status)
    }
  }

  private sendAgentLog(entry: {
    roleId: string
    tool: string
    params: Record<string, unknown>
    result: unknown
    success: boolean
    latencyMs: number
    tick: number
  }): void {
    if (!this.config.win.isDestroyed()) {
      this.config.win.webContents.send('module:agent-log', entry)
    }
  }

  private sendStats(): void {
    if (!this.config.win.isDestroyed()) {
      this.config.win.webContents.send('module:stats', {
        round: this.currentRound,
        requestCounts: Object.fromEntries(this.requestCounts),
        consecutiveErrors: Object.fromEntries(this.consecutiveErrors),
        queueLength: this.pendingTurnQueue.length,
      })
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
