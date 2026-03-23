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

export interface AgentTurnResult {
  roleId: string
  status: AgentStatus
  rendererEvents: ModuleRendererEvent[]
  orchestratorActions: OrchestratorAction[]
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

  constructor(config: OrchestratorConfig) {
    this.config = config
    this.wsManager = new WorldStateManager(config.worldState)
    this.agentPool = new AgentPool(config.defaults ?? {})
    this.rateLimiter = new RateLimiter()
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

    // Start periodic stats broadcast
    this.statsInterval = setInterval(() => this.sendStats(), 10_000)

    // Start the run loop
    this.runLoop()
  }

  stop(): void {
    this.running = false
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
    this.rateLimiter.reset()
    this.sendModuleStatus('paused')
  }

  resume(): void {
    this.paused = false
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

      // Get next agent to act
      const roleId = this.pendingTurnQueue.shift()
      if (!roleId) {
        // Queue empty — end of round for round-robin
        if (this.config.manifest.scheduling === 'round-robin') {
          this.currentRound++
          this.pendingTurnQueue = this.config.roles.map((r) => r.id)
          this.sendRendererEvent({ type: 'round_started', round: this.currentRound })
        } else {
          // Free-for-all / orchestrated: wait a bit before re-queueing
          await this.sleep(this.config.manifest.pacing.burstCooldownMs)
          this.pendingTurnQueue = this.config.roles.map((r) => r.id)
        }
      }

      if (roleId) {
        const result = await this.executeAgentTurn(roleId)
        // Re-queue if not done
        const agent = this.activeAgents.get(roleId)
        if (agent && this.config.manifest.scheduling !== 'round-robin') {
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

      // Burst cooldown between individual turns
      await this.sleep(100)
    }
  }

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
          model: role.model,
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

      // Handle orchestrator actions (give_turn, end_round, etc.)
      for (const action of orchestratorActions) {
        if (action.type === 'give_turn' && action.toAgentId) {
          this.pendingTurnQueue.unshift(action.toAgentId)
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

      // Drain mutation events from WorldStateManager (moves, damage, narration, etc.)
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

    // Add orchestrator instructions if applicable
    if (role.isOrchestrator) {
      const orchestratorInstructions = `

You are the game master / narrator for this module. Your responsibilities:
- Narrate the world and describe what happens
- Move entities, trigger effects, and manage the world
- Decide outcomes of player actions based on your personality and the module's tone
- Use give_turn to let specific agents act when appropriate
- Use end_round to advance time and signal a new round

Keep narrations vivid and evocative. Spectators are watching — make it entertaining.
`
      prompt += orchestratorInstructions
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
