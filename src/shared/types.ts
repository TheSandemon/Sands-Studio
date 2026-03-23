// =============================================================================
// Shared Types — used by both main process and renderer
// =============================================================================

export type WorldType = 'grid' | 'freeform' | 'hybrid'
export type SchedulingMode = 'orchestrated' | 'round-robin' | 'free-for-all'

export interface PacingConfig {
  burstWindowMs: number
  burstCooldownMs: number
  maxRequestsPerAgent: number
  globalRpmLimit?: number
}

export interface RendererConfig {
  canvasWidth: number
  canvasHeight: number
  backgroundColor: number
  showGrid?: boolean
  gridSize?: number
  tileWidth?: number
  tileHeight?: number
}

export interface ModuleManifest {
  id: string
  name: string
  description: string
  version?: string
  author?: string
  worldType: WorldType
  scheduling: SchedulingMode
  pacing: PacingConfig
  renderer: RendererConfig
  hasOrchestrator: boolean
  assets: string
  agents?: string
  world?: string
  agentMemory?: number
}

export type EntityState =
  | 'idle'
  | 'moving'
  | 'attacking'
  | 'casting'
  | 'talking'
  | 'dying'
  | 'dead'
  | 'hidden'
  | 'stunned'
  | 'flying'

export interface GridPosition { col: number; row: number }
export interface FreeformPosition { x: number; y: number }

export interface Entity {
  id: string
  type: string
  name: string
  position: GridPosition | FreeformPosition
  spriteTag: string
  properties: Record<string, unknown>
  agentRoleId?: string
  state: EntityState
  visible: boolean
  facing?: 'left' | 'right' | 'up' | 'down'
  layer?: number
}

export interface Tile {
  col: number; row: number
  type: string
  spriteTag: string
  walkable: boolean
  properties: Record<string, unknown>
}

export interface GridWorld {
  width: number; height: number
  tiles: Tile[][]
  tileWidth: number; tileHeight: number
}

export interface FreeformWorld {
  bounds: { x: number; y: number; width: number; height: number }
}

export type GameEventType =
  | 'entity_moved' | 'entity_damaged' | 'entity_healed' | 'entity_died' | 'entity_created'
  | 'entity_removed' | 'entity_state_changed' | 'item_pickup' | 'item_dropped'
  | 'round_started' | 'round_ended' | 'turn_started' | 'turn_ended'
  | 'narration' | 'speech' | 'effect'
  | 'tile_changed' | 'world_property_set'

export interface GameEvent {
  id: string; tick: number; type: GameEventType
  fromAgent?: string; narration?: string; entityId?: string
  data: Record<string, unknown>; timestamp: number
}

export type AIProvider = 'anthropic' | 'openai' | 'minimax' | 'openrouter' | 'custom'

export interface AgentRole {
  id: string; name: string; personality: string
  isOrchestrator: boolean
  model: string; provider: AIProvider
  baseURL?: string; apiKey?: string
  systemPromptTemplate: string
  tools: string[]
  entityId?: string
}

export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'done' | 'error' | 'waiting'

export interface WorldState {
  tick: number
  entities: Record<string, Entity>
  worldType: WorldType
  grid?: GridWorld
  freeform?: FreeformWorld
  events: GameEvent[]
  round?: number
  properties?: Record<string, unknown>
}

export type ModuleRendererEvent =
  | { type: 'entity_moved'; entityId: string; from: GridPosition | FreeformPosition; to: GridPosition | FreeformPosition; animate: boolean }
  | { type: 'entity_damaged'; entityId: string; amount: number }
  | { type: 'entity_healed'; entityId: string; amount: number; newHp: number }
  | { type: 'entity_died'; entityId: string }
  | { type: 'entity_created'; entity: Entity }
  | { type: 'entity_removed'; entityId: string }
  | { type: 'entity_state_changed'; entityId: string; state: EntityState }
  | { type: 'entity_facing_changed'; entityId: string; facing: 'left' | 'right' | 'up' | 'down' }
  | { type: 'speech'; entityId: string; text: string; duration?: number }
  | { type: 'narration'; text: string; style?: 'dramatic' | 'normal' | 'shout' | 'whisper' }
  | { type: 'effect'; position: GridPosition | FreeformPosition; effectTag: string; duration?: number }
  | { type: 'round_started'; round: number }
  | { type: 'turn_started'; agentRoleId: string }
  | { type: 'turn_ended'; agentRoleId: string }
  | { type: 'state_sync'; worldState: WorldState }
  | { type: 'tile_changed'; col: number; row: number; updates: Partial<Tile> }
  | { type: 'world_property_set'; key: string; value: unknown }

export type ModuleStatus = 'idle' | 'loading' | 'running' | 'paused' | 'stopped'

export interface TaggedAsset {
  path: string
  tags: string[]
  category: 'tile' | 'entity' | 'effect'
}

export interface AssetRegistry {
  tiles: Record<string, TaggedAsset[]>
  entities: Record<string, TaggedAsset[]>
  effects: Record<string, TaggedAsset[]>
  getTexture(tag: string, category: 'tile' | 'entity' | 'effect'): string | null
  getRandomByTag(tag: string, category: 'tile' | 'entity' | 'effect'): string | null
}

// ── Agent Context (shared between main and renderer) ──────────────────────────

export interface ActionResult {
  success: boolean
  event?: GameEvent
  error?: string
  data?: unknown
}

export interface OrchestratorAction {
  type: 'give_turn' | 'end_round' | 'pause' | 'resume'
  toAgentId?: string
}

export interface AgentContext {
  roleId: string
  isOrchestrator: boolean
  worldState: {
    // Queries
    getSerialized: () => WorldState
    getEntity: (id: string) => Entity | undefined
    getEntities: () => Record<string, Entity>
    getEntitiesByType: (type: string) => Entity[]
    getNearbyEntities: (pos: GridPosition | FreeformPosition, radius: number) => Entity[]
    getTile: (col: number, row: number) => Tile | undefined
    getTick: () => number
    getRound: () => number | undefined
    getWorldProperties: () => Record<string, unknown>
    // Entity mutations
    moveEntity: (id: string, pos: GridPosition | FreeformPosition, animate?: boolean, fromAgent?: string) => ActionResult
    damageEntity: (id: string, amount: number, source: string) => ActionResult
    healEntity: (id: string, amount: number) => ActionResult
    killEntity: (id: string, fromAgent?: string) => ActionResult
    createEntity: (entity: Entity, fromAgent?: string) => ActionResult
    removeEntity: (id: string, fromAgent?: string) => ActionResult
    updateEntity: (id: string, updates: Partial<Entity>, fromAgent?: string) => ActionResult
    updateEntityProperty: (entityId: string, key: string, value: unknown, fromAgent?: string) => ActionResult
    setEntityState: (id: string, state: EntityState) => ActionResult
    setEntityFacing: (id: string, facing: Entity['facing'], fromAgent?: string) => ActionResult
    // World mutations
    setTile: (col: number, row: number, updates: Partial<Tile>, fromAgent?: string) => ActionResult
    setWorldProperty: (key: string, value: unknown, fromAgent?: string) => ActionResult
    narrate: (text: string, fromAgent?: string, style?: string) => ActionResult
    incrementTick: () => void
    setRound: (round: number) => void
    // Renderer events
    pushRendererEvent: (event: ModuleRendererEvent) => void
    drainRendererEvents: () => ModuleRendererEvent[]
  }
  rendererEvents: ModuleRendererEvent[]
  orchestratorActions: OrchestratorAction[]
  currentEntityPosition?: GridPosition | FreeformPosition
}
