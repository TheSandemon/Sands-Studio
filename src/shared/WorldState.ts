// =============================================================================
// Module Engine — World State Manager
// Single source of truth for the running module's world.
// =============================================================================

import type {
  Entity,
  EntityState,
  GameEvent,
  GameEventType,
  GridPosition,
  FreeformPosition,
  GridWorld,
  FreeformWorld,
  WorldState as WorldStateType,
  WorldType,
  ActionResult,
  ModuleRendererEvent,
  AssetRegistry,
} from './types'

// Serializable variant (entities as array, used for IPC)
export interface SerializedWorldState {
  tick: number
  entities: Entity[]
  worldType: WorldType
  grid?: GridWorld
  freeform?: FreeformWorld
  events: GameEvent[]
  round?: number
  properties: Record<string, unknown>
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function posEquals(
  a: GridPosition | FreeformPosition,
  b: GridPosition | FreeformPosition
): boolean {
  if ('col' in a && 'col' in b) {
    return a.col === b.col && a.row === b.row
  }
  if ('x' in a && 'x' in b) {
    return a.x === b.x && a.y === b.y
  }
  return false
}

function posToKey(p: GridPosition | FreeformPosition): string {
  if ('col' in p) return `${p.col},${p.row}`
  return `${(p as FreeformPosition).x},${(p as FreeformPosition).y}`
}

function isGridPos(p: GridPosition | FreeformPosition): p is GridPosition {
  return 'col' in p
}

function distance(
  a: GridPosition | FreeformPosition,
  b: GridPosition | FreeformPosition
): number {
  if (isGridPos(a) && isGridPos(b)) {
    return Math.abs(a.col - b.col) + Math.abs(a.row - b.row)
  }
  const ax = 'x' in a ? a.x : 0
  const ay = 'y' in a ? a.y : 0
  const bx = 'x' in b ? b.x : 0
  const by = 'y' in b ? b.y : 0
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2)
}

const MAX_EVENTS = 100

// ── WorldStateManager ────────────────────────────────────────────────────────

export class WorldStateManager {
  private state: WorldStateType
  private rendererEvents: ModuleRendererEvent[] = []
  private changeListeners: Set<(state: WorldStateType) => void> = new Set()
  private assetRegistry: AssetRegistry | null = null

  constructor(initial: WorldStateType) {
    this.state = { ...initial, entities: { ...initial.entities } }
  }

  setAssetRegistry(registry: AssetRegistry) {
    this.assetRegistry = registry
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  getEntity(id: string): Entity | undefined {
    return this.state.entities[id]
  }

  getEntities(): Record<string, Entity> {
    return this.state.entities
  }

  getEntitiesByType(type: string): Entity[] {
    return Object.values(this.state.entities).filter((e) => e.type === type && e.visible)
  }

  getEntitiesAt(position: GridPosition | FreeformPosition): Entity[] {
    return Object.values(this.state.entities).filter(
      (e) => posEquals(e.position, position) && e.visible
    )
  }

  getTile(col: number, row: number): import('./types').Tile | undefined {
    if (!this.state.grid) return undefined
    if (row < 0 || row >= this.state.grid.height || col < 0 || col >= this.state.grid.width) {
      return undefined
    }
    return this.state.grid.tiles[row]?.[col]
  }

  getNearbyEntities(
    position: GridPosition | FreeformPosition,
    radius: number
  ): Entity[] {
    return Object.values(this.state.entities).filter(
      (e) => distance(e.position, position) <= radius && e.visible
    )
  }

  getRecentEvents(count = 20): GameEvent[] {
    return this.state.events.slice(-count)
  }

  getTick(): number {
    return this.state.tick
  }

  getRound(): number | undefined {
    return this.state.round
  }

  getWorldType(): WorldType {
    return this.state.worldType
  }

  getGridWorld(): GridWorld | undefined {
    return this.state.grid
  }

  getFreeformWorld(): FreeformWorld | undefined {
    return this.state.freeform
  }

  getSerialized(): SerializedWorldState {
    return {
      tick: this.state.tick,
      entities: Object.values(this.state.entities),
      worldType: this.state.worldType,
      grid: this.state.grid,
      freeform: this.state.freeform,
      events: this.state.events.slice(-MAX_EVENTS),
      round: this.state.round,
      properties: this.state.properties ?? {},
    }
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  private addEvent(event: GameEvent): void {
    this.state.events.push(event)
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events.shift()
    }
  }

  private makeEvent(
    type: GameEventType,
    data: Record<string, unknown>,
    fromAgent?: string
  ): GameEvent {
    return {
      id: crypto.randomUUID(),
      tick: this.state.tick,
      type,
      fromAgent,
      data,
      timestamp: Date.now(),
    }
  }

  moveEntity(
    id: string,
    newPos: GridPosition | FreeformPosition,
    animate = true,
    fromAgent?: string
  ): ActionResult {
    const entity = this.state.entities[id]
    if (!entity) return { success: false, error: `Entity '${id}' not found` }

    // Grid collision check
    if (isGridPos(newPos) && this.state.grid) {
      const tile = this.getTile(newPos.col, newPos.row)
      if (tile && !tile.walkable) {
        return { success: false, error: `Tile at (${newPos.col}, ${newPos.row}) is not walkable` }
      }
    }

    const oldPos = { ...entity.position }
    entity.position = { ...newPos }
    entity.state = 'idle'

    const gameEvent = this.makeEvent('entity_moved', { entityId: id, from: oldPos, to: newPos }, fromAgent)
    this.addEvent(gameEvent)

    // Emit renderer event
    this.rendererEvents.push({
      type: 'entity_moved',
      entityId: id,
      from: oldPos,
      to: newPos,
      animate,
    })

    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  damageEntity(id: string, amount: number, source: string): ActionResult {
    const entity = this.state.entities[id]
    if (!entity) return { success: false, error: `Entity '${id}' not found` }

    const hp = (entity.properties['hp'] as number) ?? 0
    const newHp = Math.max(0, hp - amount)
    entity.properties['hp'] = newHp

    const gameEvent = this.makeEvent('entity_damaged', { entityId: id, amount, source, newHp }, source)
    this.addEvent(gameEvent)

    this.rendererEvents.push({ type: 'entity_damaged', entityId: id, amount })

    if (newHp <= 0) {
      entity.state = 'dead'
      entity.visible = true // keep visible so renderer can play death animation
      const deathEvent = this.makeEvent('entity_died', { entityId: id, source }, source)
      this.addEvent(deathEvent)
      this.rendererEvents.push({ type: 'entity_died', entityId: id })
    }

    this.notifyChange()
    return {
      success: true,
      event: gameEvent,
      data: { hp: newHp, alive: newHp > 0 },
    }
  }

  healEntity(id: string, amount: number): ActionResult {
    const entity = this.state.entities[id]
    if (!entity) return { success: false, error: `Entity '${id}' not found` }

    const hp = (entity.properties['hp'] as number) ?? 0
    const maxHp = (entity.properties['maxHp'] as number) ?? hp
    const newHp = Math.min(maxHp, hp + amount)
    entity.properties['hp'] = newHp

    const gameEvent = this.makeEvent('entity_healed', { entityId: id, amount, newHp })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'entity_healed', entityId: id, amount, newHp })

    this.notifyChange()
    return { success: true, event: gameEvent, data: { hp: newHp } }
  }

  killEntity(id: string, fromAgent?: string): ActionResult {
    const entity = this.state.entities[id]
    if (!entity) return { success: false, error: `Entity '${id}' not found` }

    entity.state = 'dead'
    entity.properties['hp'] = 0

    const gameEvent = this.makeEvent('entity_died', { entityId: id }, fromAgent)
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'entity_died', entityId: id })

    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  createEntity(entity: Entity, fromAgent?: string): ActionResult {
    if (this.state.entities[entity.id]) {
      return { success: false, error: `Entity '${entity.id}' already exists` }
    }

    this.state.entities[entity.id] = { ...entity }

    const gameEvent = this.makeEvent('entity_created', { entity }, fromAgent)
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'entity_created', entity })

    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  removeEntity(id: string, fromAgent?: string): ActionResult {
    const entity = this.state.entities[id]
    if (!entity) return { success: false, error: `Entity '${id}' not found` }

    delete this.state.entities[id]

    const gameEvent = this.makeEvent('entity_removed', { entityId: id }, fromAgent)
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'entity_removed', entityId: id })

    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  updateEntity(
    id: string,
    updates: Partial<Entity>,
    fromAgent?: string
  ): ActionResult {
    const entity = this.state.entities[id]
    if (!entity) return { success: false, error: `Entity '${id}' not found` }

    // Deep-merge properties to avoid wiping unrelated keys (e.g. only updating hp)
    if (updates.properties) {
      entity.properties = { ...entity.properties, ...updates.properties }
    }
    const { properties: _props, ...rest } = updates
    Object.assign(entity, rest)

    if (updates.state) {
      const gameEvent = this.makeEvent(
        'entity_state_changed',
        { entityId: id, state: updates.state },
        fromAgent
      )
      this.addEvent(gameEvent)
      this.rendererEvents.push({ type: 'entity_state_changed', entityId: id, state: updates.state })
    }

    this.notifyChange()
    return { success: true }
  }

  setEntityState(id: string, state: EntityState): ActionResult {
    const entity = this.state.entities[id]
    if (!entity) return { success: false, error: `Entity '${id}' not found` }

    entity.state = state
    this.rendererEvents.push({ type: 'entity_state_changed', entityId: id, state })
    this.notifyChange()
    return { success: true }
  }

  narrate(text: string, fromAgent?: string, style?: string): ActionResult {
    const gameEvent = this.makeEvent('narration', { text, style }, fromAgent)
    gameEvent.narration = text
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'narration', text, style: style as any })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  incrementTick(): void {
    this.state.tick++
    this.notifyChange()
  }

  setRound(round: number): void {
    this.state.round = round
    const gameEvent = this.makeEvent('round_started', { round })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'round_started', round })
    this.notifyChange()
  }

  // ── New Mutations ────────────────────────────────────────────────────────

  setTile(col: number, row: number, updates: Partial<import('./types').Tile>, fromAgent?: string): ActionResult {
    if (!this.state.grid) return { success: false, error: 'World has no grid' }
    const tile = this.getTile(col, row)
    if (!tile) return { success: false, error: `No tile at (${col}, ${row})` }
    Object.assign(tile, updates)
    const gameEvent = this.makeEvent('tile_changed', { col, row, updates }, fromAgent)
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'tile_changed', col, row, updates })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  setWorldProperty(key: string, value: unknown, fromAgent?: string): ActionResult {
    if (!this.state.properties) this.state.properties = {}
    this.state.properties[key] = value
    const gameEvent = this.makeEvent('world_property_set', { key, value }, fromAgent)
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'world_property_set', key, value })
    this.notifyChange()
    return { success: true }
  }

  getWorldProperties(): Record<string, unknown> {
    return this.state.properties ?? {}
  }

  updateEntityProperty(entityId: string, key: string, value: unknown, _fromAgent?: string): ActionResult {
    const entity = this.state.entities[entityId]
    if (!entity) return { success: false, error: `Entity '${entityId}' not found` }
    entity.properties[key] = value
    this.notifyChange()
    return { success: true }
  }

  setEntityFacing(entityId: string, facing: import('./types').Entity['facing'], _fromAgent?: string): ActionResult {
    const entity = this.state.entities[entityId]
    if (!entity) return { success: false, error: `Entity '${entityId}' not found` }
    entity.facing = facing
    this.rendererEvents.push({ type: 'entity_facing_changed', entityId, facing: facing! })
    this.notifyChange()
    return { success: true }
  }

  // ── Change Listeners ─────────────────────────────────────────────────────

  onChange(listener: (state: WorldStateType) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  private notifyChange(): void {
    const snapshot = this.getSerialized()
    for (const listener of this.changeListeners) {
      listener(snapshot as unknown as WorldStateType)
    }
  }

  // ── Renderer Events ──────────────────────────────────────────────────────

  drainRendererEvents(): ModuleRendererEvent[] {
    const events = [...this.rendererEvents]
    this.rendererEvents = []
    return events
  }

  pushRendererEvent(event: ModuleRendererEvent): void {
    this.rendererEvents.push(event)
  }
}
