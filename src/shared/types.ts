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

// ── Game Primitives ────────────────────────────────────────────────────────────

export interface GameTimer {
  id: string
  name: string
  targetTick?: number
  targetTimeMs?: number
  recurring?: boolean
  intervalTicks?: number
  intervalMs?: number
  data: Record<string, unknown>
  createdBy: string
  createdAt: number
  paused: boolean
}

export interface TriggerZone {
  id: string
  name: string
  shape: 'rect' | 'circle'
  rect?: { col: number; row: number; width: number; height: number }
  center?: GridPosition | FreeformPosition
  radius?: number
  fireOn: 'enter' | 'exit' | 'both'
  oneShot: boolean
  entityFilter?: string
  data: Record<string, unknown>
  createdBy: string
  active: boolean
  entitiesInside: string[]
}

export interface StatusEffect {
  id: string
  name: string
  entityId: string
  durationTicks?: number
  durationMs?: number
  permanent?: boolean
  properties: Record<string, unknown>
  source: string
  appliedAt: number
  stackable: boolean
  icon?: string
}

export interface Item {
  id: string
  name: string
  type: string
  tags: string[]
  properties: Record<string, unknown>
  spriteTag?: string
  stackable: boolean
  quantity: number
  equipped: boolean
  equippedSlot?: string
}

export interface EntityGroup {
  id: string
  name: string
  memberIds: string[]
  properties: Record<string, unknown>
  createdBy: string
}

export interface StateMachine {
  id: string
  entityId?: string
  currentState: string
  states: string[]
  transitions: Record<string, string[]>
  data: Record<string, unknown>
  createdBy: string
}

export interface Relationship {
  id: string
  fromEntityId: string
  toEntityId: string
  type: string
  bidirectional: boolean
  properties: Record<string, unknown>
  createdBy: string
}

// ── Entity ────────────────────────────────────────────────────────────────────

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
  statusEffects?: StatusEffect[]
  inventory?: Item[]
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
  // New subsystem events
  | 'timer_fired' | 'timer_created' | 'timer_cancelled'
  | 'trigger_fired' | 'trigger_created' | 'trigger_removed'
  | 'status_effect_applied' | 'status_effect_removed' | 'status_effect_expired'
  | 'item_received' | 'item_removed' | 'item_equipped' | 'item_unequipped' | 'item_used' | 'item_transferred'
  | 'group_created' | 'group_member_added' | 'group_member_removed'
  | 'state_transition'
  | 'relationship_created' | 'relationship_removed'

export interface GameEvent {
  id: string; tick: number; type: GameEventType
  fromAgent?: string; narration?: string; entityId?: string
  data: Record<string, unknown>; timestamp: number
}

export type AIProvider = 'anthropic' | 'openai' | 'minimax' | 'openrouter' | 'custom'

export interface AgentRole {
  id: string; name: string; personality: string
  isOrchestrator: boolean
  // Optional — if absent, the orchestrator uses global settings from Settings → Agent tab.
  // This ensures changing settings applies to all agents immediately.
  model?: string
  provider?: AIProvider
  baseURL?: string
  apiKey?: string
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
  timers?: Record<string, GameTimer>
  triggers?: Record<string, TriggerZone>
  groups?: Record<string, EntityGroup>
  stateMachines?: Record<string, StateMachine>
  relationships?: Relationship[]
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
  | { type: 'camera_shake'; intensity: number; duration: number }
  | { type: 'camera_follow'; entityId: string }
  | { type: 'screen_flash'; color: string; duration: number }
  // Timers
  | { type: 'timer_fired'; timerId: string; timerName: string; data: Record<string, unknown> }
  | { type: 'timer_created'; timerId: string; timerName: string }
  | { type: 'timer_cancelled'; timerId: string; timerName: string }
  // Triggers
  | { type: 'trigger_created'; triggerId: string; triggerName: string; shape: 'rect' | 'circle'; rect?: TriggerZone['rect']; center?: GridPosition | FreeformPosition; radius?: number }
  | { type: 'trigger_fired'; triggerId: string; triggerName: string; entityId: string; fireType: 'enter' | 'exit'; data: Record<string, unknown> }
  | { type: 'trigger_removed'; triggerId: string }
  // Status Effects
  | { type: 'status_effect_applied'; entityId: string; effectName: string; icon?: string; duration?: number }
  | { type: 'status_effect_removed'; entityId: string; effectName: string }
  | { type: 'status_effect_expired'; entityId: string; effectName: string }
  // Items
  | { type: 'item_received'; entityId: string; itemName: string; itemId: string }
  | { type: 'item_removed'; entityId: string; itemName: string; itemId: string }
  | { type: 'item_equipped'; entityId: string; itemName: string; slot: string }
  | { type: 'item_unequipped'; entityId: string; itemName: string }
  | { type: 'item_used'; entityId: string; itemName: string; targetEntityId?: string }
  | { type: 'item_transferred'; fromEntityId: string; toEntityId: string; itemName: string }
  // Groups
  | { type: 'group_created'; groupId: string; groupName: string }
  | { type: 'group_member_added'; groupId: string; entityId: string }
  | { type: 'group_member_removed'; groupId: string; entityId: string }
  // State Machines
  | { type: 'state_transition'; machineId: string; entityId?: string; oldState: string; newState: string }
  // Relationships
  | { type: 'relationship_created'; fromEntityId: string; toEntityId: string; relType: string }
  | { type: 'relationship_removed'; fromEntityId: string; toEntityId: string; relType: string }
  // Pathfinding debug
  | { type: 'path_highlight'; path: GridPosition[]; color?: string; duration?: number }

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
    // Timers
    createTimer: (timer: GameTimer) => ActionResult
    cancelTimer: (id: string) => ActionResult
    getTimers: () => GameTimer[]
    // Triggers
    createTrigger: (trigger: TriggerZone) => ActionResult
    removeTrigger: (id: string) => ActionResult
    getTriggers: () => TriggerZone[]
    // Status Effects
    applyStatusEffect: (effect: StatusEffect) => ActionResult
    removeStatusEffect: (entityId: string, effectName: string) => ActionResult
    getStatusEffects: (entityId: string) => StatusEffect[]
    // Inventory
    addItem: (entityId: string, item: Item) => ActionResult
    removeItem: (entityId: string, itemId: string) => ActionResult
    getInventory: (entityId: string) => Item[]
    equipItem: (entityId: string, itemId: string, slot: string) => ActionResult
    unequipItem: (entityId: string, itemId: string) => ActionResult
    transferItem: (fromEntityId: string, toEntityId: string, itemId: string) => ActionResult
    useItem: (entityId: string, itemId: string, targetEntityId?: string) => ActionResult
    // Groups
    createGroup: (group: EntityGroup) => ActionResult
    removeGroup: (id: string) => ActionResult
    addToGroup: (groupId: string, entityId: string) => ActionResult
    removeFromGroup: (groupId: string, entityId: string) => ActionResult
    getGroup: (id: string) => EntityGroup | undefined
    getGroups: () => EntityGroup[]
    getEntityGroups: (entityId: string) => EntityGroup[]
    // State Machines
    createStateMachine: (sm: StateMachine) => ActionResult
    removeStateMachine: (id: string) => ActionResult
    transitionState: (machineId: string, newState: string, fromAgent?: string) => ActionResult
    getStateMachine: (id: string) => StateMachine | undefined
    getStateMachines: () => StateMachine[]
    // Relationships
    createRelationship: (rel: Relationship) => ActionResult
    removeRelationship: (fromEntityId: string, toEntityId: string, type: string) => ActionResult
    getRelationships: (entityId: string, type?: string) => Relationship[]
    getRelatedEntities: (entityId: string, type: string) => Entity[]
    // Pathfinding
    getGridWorld: () => GridWorld | undefined
  }
  rendererEvents: ModuleRendererEvent[]
  orchestratorActions: OrchestratorAction[]
  currentEntityPosition?: GridPosition | FreeformPosition
  /** When true, mutation tools queue their action instead of applying it. Used for parallel free-for-all batch execution. */
  queuing?: boolean
  /** Called by mutation tools when queuing=true to record the action for later batch application. */
  queueAction?: (action: { toolName: string; params: Record<string, unknown> }) => void
}
