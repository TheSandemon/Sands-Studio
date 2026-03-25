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
  GameTimer,
  TriggerZone,
  StatusEffect,
  Item,
  EntityGroup,
  StateMachine,
  Relationship,
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
  timers?: Record<string, GameTimer>
  triggers?: Record<string, TriggerZone>
  groups?: Record<string, EntityGroup>
  stateMachines?: Record<string, StateMachine>
  relationships?: Relationship[]
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
    this.state = {
      ...initial,
      entities: { ...initial.entities },
      timers: initial.timers ? { ...initial.timers } : {},
      triggers: initial.triggers ? { ...initial.triggers } : {},
      groups: initial.groups ? { ...initial.groups } : {},
      stateMachines: initial.stateMachines ? { ...initial.stateMachines } : {},
      relationships: initial.relationships ? [...initial.relationships] : [],
    }
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
      timers: this.state.timers,
      triggers: this.state.triggers,
      groups: this.state.groups,
      stateMachines: this.state.stateMachines,
      relationships: this.state.relationships,
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

    // Check triggers
    this.checkTriggers(id, oldPos, newPos)

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

    // Clean up relationships involving this entity
    if (this.state.relationships) {
      this.state.relationships = this.state.relationships.filter(
        (r) => r.fromEntityId !== id && r.toEntityId !== id
      )
    }

    // Remove from trigger tracking
    if (this.state.triggers) {
      for (const trigger of Object.values(this.state.triggers)) {
        const idx = trigger.entitiesInside.indexOf(id)
        if (idx !== -1) trigger.entitiesInside.splice(idx, 1)
      }
    }

    // Remove from groups
    if (this.state.groups) {
      for (const group of Object.values(this.state.groups)) {
        const idx = group.memberIds.indexOf(id)
        if (idx !== -1) group.memberIds.splice(idx, 1)
      }
    }

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

  // ── Timers ──────────────────────────────────────────────────────────────

  createTimer(timer: GameTimer): ActionResult {
    if (!this.state.timers) this.state.timers = {}
    if (this.state.timers[timer.id]) {
      return { success: false, error: `Timer '${timer.id}' already exists` }
    }
    this.state.timers[timer.id] = { ...timer }
    const gameEvent = this.makeEvent('timer_created', { timerId: timer.id, timerName: timer.name })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'timer_created', timerId: timer.id, timerName: timer.name })
    this.notifyChange()
    return { success: true, event: gameEvent, data: { timerId: timer.id } }
  }

  cancelTimer(id: string): ActionResult {
    if (!this.state.timers?.[id]) {
      return { success: false, error: `Timer '${id}' not found` }
    }
    const timer = this.state.timers[id]
    delete this.state.timers[id]
    const gameEvent = this.makeEvent('timer_cancelled', { timerId: id, timerName: timer.name })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'timer_cancelled', timerId: id, timerName: timer.name })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  getTimer(id: string): GameTimer | undefined {
    return this.state.timers?.[id]
  }

  getAllTimers(): GameTimer[] {
    return Object.values(this.state.timers ?? {})
  }

  /** Check timers and return those that have fired. Removes one-shot timers, reschedules recurring ones. */
  tickTimers(currentTick: number, nowMs: number): GameTimer[] {
    const fired: GameTimer[] = []
    if (!this.state.timers) return fired

    for (const timer of Object.values(this.state.timers)) {
      if (timer.paused) continue

      let shouldFire = false
      if (timer.targetTick !== undefined && currentTick >= timer.targetTick) {
        shouldFire = true
      }
      if (timer.targetTimeMs !== undefined && nowMs >= timer.targetTimeMs) {
        shouldFire = true
      }

      if (shouldFire) {
        fired.push({ ...timer })
        const gameEvent = this.makeEvent('timer_fired', { timerId: timer.id, timerName: timer.name, data: timer.data })
        this.addEvent(gameEvent)
        this.rendererEvents.push({ type: 'timer_fired', timerId: timer.id, timerName: timer.name, data: timer.data })

        if (timer.recurring) {
          if (timer.intervalTicks !== undefined && timer.targetTick !== undefined) {
            timer.targetTick += timer.intervalTicks
          }
          if (timer.intervalMs !== undefined && timer.targetTimeMs !== undefined) {
            timer.targetTimeMs = nowMs + timer.intervalMs
          }
        } else {
          delete this.state.timers[timer.id]
        }
      }
    }

    if (fired.length > 0) this.notifyChange()
    return fired
  }

  // ── Triggers ───────────────────────────────────────────────────────────

  createTrigger(trigger: TriggerZone): ActionResult {
    if (!this.state.triggers) this.state.triggers = {}
    if (this.state.triggers[trigger.id]) {
      return { success: false, error: `Trigger '${trigger.id}' already exists` }
    }
    this.state.triggers[trigger.id] = { ...trigger, entitiesInside: [] }
    const gameEvent = this.makeEvent('trigger_created', { triggerId: trigger.id, triggerName: trigger.name })
    this.addEvent(gameEvent)
    this.rendererEvents.push({
      type: 'trigger_created',
      triggerId: trigger.id,
      triggerName: trigger.name,
      shape: trigger.shape,
      rect: trigger.rect,
      center: trigger.center,
      radius: trigger.radius,
    })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  removeTrigger(id: string): ActionResult {
    if (!this.state.triggers?.[id]) {
      return { success: false, error: `Trigger '${id}' not found` }
    }
    delete this.state.triggers[id]
    const gameEvent = this.makeEvent('trigger_removed', { triggerId: id })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'trigger_removed', triggerId: id })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  getAllTriggers(): TriggerZone[] {
    return Object.values(this.state.triggers ?? {})
  }

  /** Check all triggers against an entity's old and new position. Called from moveEntity. */
  private checkTriggers(entityId: string, oldPos: GridPosition | FreeformPosition, newPos: GridPosition | FreeformPosition): void {
    if (!this.state.triggers) return

    const entity = this.state.entities[entityId]
    const sortedTriggers = Object.values(this.state.triggers)
      .filter((t) => t.active)
      .sort((a, b) => a.id.localeCompare(b.id))

    for (const trigger of sortedTriggers) {
      // Filter by entity type if specified
      if (trigger.entityFilter && entity && entity.type !== trigger.entityFilter) continue

      const wasInside = trigger.entitiesInside.includes(entityId)
      const isNowInside = this.isPositionInTrigger(newPos, trigger)

      if (!wasInside && isNowInside && (trigger.fireOn === 'enter' || trigger.fireOn === 'both')) {
        trigger.entitiesInside.push(entityId)
        this.fireTrigger(trigger, entityId, 'enter')
      } else if (wasInside && !isNowInside && (trigger.fireOn === 'exit' || trigger.fireOn === 'both')) {
        trigger.entitiesInside = trigger.entitiesInside.filter((id) => id !== entityId)
        this.fireTrigger(trigger, entityId, 'exit')
      } else if (!wasInside && isNowInside) {
        trigger.entitiesInside.push(entityId)
      } else if (wasInside && !isNowInside) {
        trigger.entitiesInside = trigger.entitiesInside.filter((id) => id !== entityId)
      }
    }
  }

  private fireTrigger(trigger: TriggerZone, entityId: string, fireType: 'enter' | 'exit'): void {
    const gameEvent = this.makeEvent('trigger_fired', {
      triggerId: trigger.id,
      triggerName: trigger.name,
      entityId,
      fireType,
      data: trigger.data,
    })
    this.addEvent(gameEvent)
    this.rendererEvents.push({
      type: 'trigger_fired',
      triggerId: trigger.id,
      triggerName: trigger.name,
      entityId,
      fireType,
      data: trigger.data,
    })

    if (trigger.oneShot) {
      trigger.active = false
      if (this.state.triggers) delete this.state.triggers[trigger.id]
    }
  }

  private isPositionInTrigger(pos: GridPosition | FreeformPosition, trigger: TriggerZone): boolean {
    if (trigger.shape === 'rect' && trigger.rect && isGridPos(pos)) {
      const { col, row, width, height } = trigger.rect
      return pos.col >= col && pos.col < col + width && pos.row >= row && pos.row < row + height
    }
    if (trigger.shape === 'circle' && trigger.center && trigger.radius !== undefined) {
      return distance(pos, trigger.center) <= trigger.radius
    }
    return false
  }

  // ── Status Effects ─────────────────────────────────────────────────────

  applyStatusEffect(effect: StatusEffect): ActionResult {
    const entity = this.state.entities[effect.entityId]
    if (!entity) return { success: false, error: `Entity '${effect.entityId}' not found` }

    if (!entity.statusEffects) entity.statusEffects = []

    // Non-stackable: refresh duration if same name exists
    if (!effect.stackable) {
      const existing = entity.statusEffects.find((e) => e.name === effect.name)
      if (existing) {
        existing.durationTicks = effect.durationTicks
        existing.durationMs = effect.durationMs
        existing.properties = { ...effect.properties }
        existing.appliedAt = effect.appliedAt
        this.notifyChange()
        return { success: true, data: { refreshed: true } }
      }
    }

    entity.statusEffects.push({ ...effect })
    const gameEvent = this.makeEvent('status_effect_applied', {
      entityId: effect.entityId,
      effectName: effect.name,
      icon: effect.icon,
    })
    this.addEvent(gameEvent)
    this.rendererEvents.push({
      type: 'status_effect_applied',
      entityId: effect.entityId,
      effectName: effect.name,
      icon: effect.icon,
      duration: effect.durationTicks ?? effect.durationMs,
    })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  removeStatusEffect(entityId: string, effectName: string): ActionResult {
    const entity = this.state.entities[entityId]
    if (!entity) return { success: false, error: `Entity '${entityId}' not found` }
    if (!entity.statusEffects) return { success: false, error: `Entity has no status effects` }

    const idx = entity.statusEffects.findIndex((e) => e.name === effectName)
    if (idx === -1) return { success: false, error: `Status effect '${effectName}' not found on entity` }

    entity.statusEffects.splice(idx, 1)
    const gameEvent = this.makeEvent('status_effect_removed', { entityId, effectName })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'status_effect_removed', entityId, effectName })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  getStatusEffects(entityId: string): StatusEffect[] {
    return this.state.entities[entityId]?.statusEffects ?? []
  }

  /** Decrement tick-based status effects. Returns expired effects. */
  tickStatusEffects(currentTick: number): StatusEffect[] {
    const expired: StatusEffect[] = []

    for (const entity of Object.values(this.state.entities)) {
      if (!entity.statusEffects) continue

      const remaining: StatusEffect[] = []
      for (const effect of entity.statusEffects) {
        if (effect.permanent) {
          remaining.push(effect)
          continue
        }

        let isExpired = false
        if (effect.durationTicks !== undefined) {
          effect.durationTicks--
          if (effect.durationTicks <= 0) isExpired = true
        }

        if (isExpired) {
          expired.push({ ...effect })
          const gameEvent = this.makeEvent('status_effect_expired', {
            entityId: entity.id,
            effectName: effect.name,
          })
          this.addEvent(gameEvent)
          this.rendererEvents.push({ type: 'status_effect_expired', entityId: entity.id, effectName: effect.name })
        } else {
          remaining.push(effect)
        }
      }
      entity.statusEffects = remaining
    }

    if (expired.length > 0) this.notifyChange()
    return expired
  }

  // ── Inventory ──────────────────────────────────────────────────────────

  addItem(entityId: string, item: Item): ActionResult {
    const entity = this.state.entities[entityId]
    if (!entity) return { success: false, error: `Entity '${entityId}' not found` }

    if (!entity.inventory) entity.inventory = []

    // Stack if stackable and same name exists
    if (item.stackable) {
      const existing = entity.inventory.find((i) => i.name === item.name)
      if (existing) {
        existing.quantity += item.quantity
        this.notifyChange()
        return { success: true, data: { itemId: existing.id, stacked: true, newQuantity: existing.quantity } }
      }
    }

    entity.inventory.push({ ...item })
    const gameEvent = this.makeEvent('item_received', { entityId, itemName: item.name, itemId: item.id })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'item_received', entityId, itemName: item.name, itemId: item.id })
    this.notifyChange()
    return { success: true, event: gameEvent, data: { itemId: item.id } }
  }

  removeItem(entityId: string, itemId: string): ActionResult {
    const entity = this.state.entities[entityId]
    if (!entity) return { success: false, error: `Entity '${entityId}' not found` }
    if (!entity.inventory) return { success: false, error: `Entity has no inventory` }

    const idx = entity.inventory.findIndex((i) => i.id === itemId)
    if (idx === -1) return { success: false, error: `Item '${itemId}' not found in inventory` }

    const item = entity.inventory[idx]
    entity.inventory.splice(idx, 1)
    const gameEvent = this.makeEvent('item_removed', { entityId, itemName: item.name, itemId })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'item_removed', entityId, itemName: item.name, itemId })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  getInventory(entityId: string): Item[] {
    return this.state.entities[entityId]?.inventory ?? []
  }

  equipItem(entityId: string, itemId: string, slot: string): ActionResult {
    const entity = this.state.entities[entityId]
    if (!entity) return { success: false, error: `Entity '${entityId}' not found` }
    if (!entity.inventory) return { success: false, error: `Entity has no inventory` }

    const item = entity.inventory.find((i) => i.id === itemId)
    if (!item) return { success: false, error: `Item '${itemId}' not found in inventory` }

    // Unequip anything currently in that slot
    for (const i of entity.inventory) {
      if (i.equipped && i.equippedSlot === slot) {
        i.equipped = false
        i.equippedSlot = undefined
      }
    }

    item.equipped = true
    item.equippedSlot = slot
    const gameEvent = this.makeEvent('item_equipped', { entityId, itemName: item.name, slot })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'item_equipped', entityId, itemName: item.name, slot })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  unequipItem(entityId: string, itemId: string): ActionResult {
    const entity = this.state.entities[entityId]
    if (!entity) return { success: false, error: `Entity '${entityId}' not found` }
    if (!entity.inventory) return { success: false, error: `Entity has no inventory` }

    const item = entity.inventory.find((i) => i.id === itemId)
    if (!item) return { success: false, error: `Item '${itemId}' not found in inventory` }
    if (!item.equipped) return { success: false, error: `Item '${itemId}' is not equipped` }

    item.equipped = false
    item.equippedSlot = undefined
    const gameEvent = this.makeEvent('item_unequipped', { entityId, itemName: item.name })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'item_unequipped', entityId, itemName: item.name })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  transferItem(fromEntityId: string, toEntityId: string, itemId: string): ActionResult {
    const fromEntity = this.state.entities[fromEntityId]
    const toEntity = this.state.entities[toEntityId]
    if (!fromEntity) return { success: false, error: `Entity '${fromEntityId}' not found` }
    if (!toEntity) return { success: false, error: `Entity '${toEntityId}' not found` }
    if (!fromEntity.inventory) return { success: false, error: `Source entity has no inventory` }

    const idx = fromEntity.inventory.findIndex((i) => i.id === itemId)
    if (idx === -1) return { success: false, error: `Item '${itemId}' not found in source inventory` }

    const item = fromEntity.inventory.splice(idx, 1)[0]
    item.equipped = false
    item.equippedSlot = undefined

    if (!toEntity.inventory) toEntity.inventory = []
    toEntity.inventory.push(item)

    const gameEvent = this.makeEvent('item_transferred', { fromEntityId, toEntityId, itemName: item.name })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'item_transferred', fromEntityId, toEntityId, itemName: item.name })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  useItem(entityId: string, itemId: string, targetEntityId?: string): ActionResult {
    const entity = this.state.entities[entityId]
    if (!entity) return { success: false, error: `Entity '${entityId}' not found` }
    if (!entity.inventory) return { success: false, error: `Entity has no inventory` }

    const idx = entity.inventory.findIndex((i) => i.id === itemId)
    if (idx === -1) return { success: false, error: `Item '${itemId}' not found in inventory` }

    const item = entity.inventory[idx]
    const gameEvent = this.makeEvent('item_used', { entityId, itemName: item.name, targetEntityId })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'item_used', entityId, itemName: item.name, targetEntityId })

    // Remove consumable items (quantity-based)
    if (item.stackable && item.quantity > 1) {
      item.quantity--
    } else if (item.type === 'potion' || item.tags.includes('consumable')) {
      entity.inventory.splice(idx, 1)
    }

    this.notifyChange()
    return { success: true, event: gameEvent, data: { item } }
  }

  // ── Groups ─────────────────────────────────────────────────────────────

  createGroup(group: EntityGroup): ActionResult {
    if (!this.state.groups) this.state.groups = {}
    if (this.state.groups[group.id]) {
      return { success: false, error: `Group '${group.id}' already exists` }
    }
    this.state.groups[group.id] = { ...group }
    const gameEvent = this.makeEvent('group_created', { groupId: group.id, groupName: group.name })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'group_created', groupId: group.id, groupName: group.name })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  removeGroup(id: string): ActionResult {
    if (!this.state.groups?.[id]) {
      return { success: false, error: `Group '${id}' not found` }
    }
    delete this.state.groups[id]
    this.notifyChange()
    return { success: true }
  }

  addToGroup(groupId: string, entityId: string): ActionResult {
    const group = this.state.groups?.[groupId]
    if (!group) return { success: false, error: `Group '${groupId}' not found` }
    if (group.memberIds.includes(entityId)) return { success: true, data: { alreadyMember: true } }

    group.memberIds.push(entityId)
    const gameEvent = this.makeEvent('group_member_added', { groupId, entityId })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'group_member_added', groupId, entityId })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  removeFromGroup(groupId: string, entityId: string): ActionResult {
    const group = this.state.groups?.[groupId]
    if (!group) return { success: false, error: `Group '${groupId}' not found` }

    const idx = group.memberIds.indexOf(entityId)
    if (idx === -1) return { success: false, error: `Entity '${entityId}' not in group` }

    group.memberIds.splice(idx, 1)
    const gameEvent = this.makeEvent('group_member_removed', { groupId, entityId })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'group_member_removed', groupId, entityId })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  getGroup(id: string): EntityGroup | undefined {
    return this.state.groups?.[id]
  }

  getAllGroups(): EntityGroup[] {
    return Object.values(this.state.groups ?? {})
  }

  getEntityGroups(entityId: string): EntityGroup[] {
    return Object.values(this.state.groups ?? {}).filter((g) => g.memberIds.includes(entityId))
  }

  // ── State Machines ─────────────────────────────────────────────────────

  createStateMachine(sm: StateMachine): ActionResult {
    if (!this.state.stateMachines) this.state.stateMachines = {}
    if (this.state.stateMachines[sm.id]) {
      return { success: false, error: `State machine '${sm.id}' already exists` }
    }
    if (!sm.states.includes(sm.currentState)) {
      return { success: false, error: `Initial state '${sm.currentState}' is not in the states list` }
    }
    this.state.stateMachines[sm.id] = { ...sm }
    this.notifyChange()
    return { success: true, data: { machineId: sm.id } }
  }

  removeStateMachine(id: string): ActionResult {
    if (!this.state.stateMachines?.[id]) {
      return { success: false, error: `State machine '${id}' not found` }
    }
    delete this.state.stateMachines[id]
    this.notifyChange()
    return { success: true }
  }

  transitionState(machineId: string, newState: string, fromAgent?: string): ActionResult {
    const sm = this.state.stateMachines?.[machineId]
    if (!sm) return { success: false, error: `State machine '${machineId}' not found` }

    if (!sm.states.includes(newState)) {
      return { success: false, error: `State '${newState}' is not a valid state. Valid states: [${sm.states.join(', ')}]` }
    }

    const validTransitions = sm.transitions[sm.currentState]
    if (validTransitions && !validTransitions.includes(newState)) {
      return { success: false, error: `Invalid transition from '${sm.currentState}' to '${newState}'. Valid transitions: [${validTransitions.join(', ')}]` }
    }

    const oldState = sm.currentState
    sm.currentState = newState
    const gameEvent = this.makeEvent('state_transition', { machineId, entityId: sm.entityId, oldState, newState }, fromAgent)
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'state_transition', machineId, entityId: sm.entityId, oldState, newState })
    this.notifyChange()
    return { success: true, event: gameEvent, data: { oldState, newState } }
  }

  getStateMachine(id: string): StateMachine | undefined {
    return this.state.stateMachines?.[id]
  }

  getAllStateMachines(): StateMachine[] {
    return Object.values(this.state.stateMachines ?? {})
  }

  // ── Relationships ──────────────────────────────────────────────────────

  createRelationship(rel: Relationship): ActionResult {
    if (!this.state.relationships) this.state.relationships = []

    // Check for duplicate
    const exists = this.state.relationships.find(
      (r) => r.fromEntityId === rel.fromEntityId && r.toEntityId === rel.toEntityId && r.type === rel.type
    )
    if (exists) return { success: false, error: `Relationship already exists` }

    this.state.relationships.push({ ...rel })
    const gameEvent = this.makeEvent('relationship_created', { fromEntityId: rel.fromEntityId, toEntityId: rel.toEntityId, relType: rel.type })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'relationship_created', fromEntityId: rel.fromEntityId, toEntityId: rel.toEntityId, relType: rel.type })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  removeRelationship(fromEntityId: string, toEntityId: string, type: string): ActionResult {
    if (!this.state.relationships) return { success: false, error: `No relationships exist` }

    const idx = this.state.relationships.findIndex(
      (r) => r.fromEntityId === fromEntityId && r.toEntityId === toEntityId && r.type === type
    )
    if (idx === -1) return { success: false, error: `Relationship not found` }

    this.state.relationships.splice(idx, 1)
    const gameEvent = this.makeEvent('relationship_removed', { fromEntityId, toEntityId, relType: type })
    this.addEvent(gameEvent)
    this.rendererEvents.push({ type: 'relationship_removed', fromEntityId, toEntityId, relType: type })
    this.notifyChange()
    return { success: true, event: gameEvent }
  }

  getRelationships(entityId: string, type?: string): Relationship[] {
    if (!this.state.relationships) return []
    return this.state.relationships.filter((r) => {
      const matches = r.fromEntityId === entityId || (r.bidirectional && r.toEntityId === entityId)
      if (!matches) return false
      if (type && r.type !== type) return false
      return true
    })
  }

  getRelatedEntities(entityId: string, type: string): Entity[] {
    const rels = this.getRelationships(entityId, type)
    const relatedIds = rels.map((r) => r.fromEntityId === entityId ? r.toEntityId : r.fromEntityId)
    return relatedIds.map((id) => this.state.entities[id]).filter(Boolean) as Entity[]
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
