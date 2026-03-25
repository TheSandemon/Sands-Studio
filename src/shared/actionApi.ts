// =============================================================================
// Module Engine — Action API
// Registry of tools agents can call. Each tool is both a callable function
// and an Anthropic-compatible tool definition.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk'
import type {
  ActionResult,
  AgentContext,
  GridPosition,
  FreeformPosition,
  EntityState,
  ModuleRendererEvent,
  GameEvent,
  Entity,
  GameTimer,
  TriggerZone,
  StatusEffect,
  Item,
  EntityGroup,
  StateMachine,
  Relationship,
} from './types'
import type { WorldStateManager } from './WorldState'
import { findPath, getPathDistance } from './pathfinding'

// ── Tool function signature ───────────────────────────────────────────────────

type ActionFn = (
  params: Record<string, unknown>,
  context: AgentContext
) => ActionResult

// ── Orchestrator-only tools ──────────────────────────────────────────────────

const ORCHESTRATOR_ONLY_TOOLS = new Set([
  'give_turn',
  'end_round',
  'pause_module',
  'resume_module',
  'create_entity',
])

// ── Action Registry ───────────────────────────────────────────────────────────

export const actionApi: Record<string, ActionFn> = {

  // ── World Queries ──────────────────────────────────────────────────────

  get_world_state: (_p, ctx): ActionResult => {
    const view = ctx.worldState.getSerialized()
    return { success: true, data: view }
  },

  get_entity: (p, ctx): ActionResult => {
    const id = p.id as string
    if (!id) return { success: false, error: 'id is required' }
    const entity = ctx.worldState.getEntity(id)
    if (!entity) return { success: false, error: `Entity '${id}' not found` }
    return { success: true, data: entity }
  },

  get_entities_by_type: (p, ctx): ActionResult => {
    const type = p.type as string
    if (!type) return { success: false, error: 'type is required' }
    return { success: true, data: ctx.worldState.getEntitiesByType(type) }
  },

  get_entities_nearby: (p, ctx): ActionResult => {
    const pos = p.position as GridPosition | FreeformPosition
    const radius = (p.radius as number) ?? 5
    if (!pos) return { success: false, error: 'position is required' }
    return { success: true, data: ctx.worldState.getNearbyEntities(pos, radius) }
  },

  get_tile: (p, ctx): ActionResult => {
    const col = p.col as number
    const row = p.row as number
    if (col === undefined || row === undefined) {
      return { success: false, error: 'col and row are required' }
    }
    const tile = ctx.worldState.getTile(col, row)
    if (!tile) return { success: false, error: `No tile at (${col}, ${row})` }
    return { success: true, data: tile }
  },

  // ── Entity Manipulation ────────────────────────────────────────────────

  move_entity: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'move_entity', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const position = p.position as GridPosition | FreeformPosition
    const animate = (p.animate as boolean) ?? true
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (!position) return { success: false, error: 'position is required' }
    return ctx.worldState.moveEntity(entityId, position, animate, ctx.roleId)
  },

  create_entity: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'create_entity', params: p })
      return { success: true }
    }
    const entity = p.entity as Entity
    if (!entity?.id || !entity?.type || !entity?.name) {
      return { success: false, error: 'entity must have id, type, and name' }
    }
    return ctx.worldState.createEntity(entity, ctx.roleId)
  },

  remove_entity: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'remove_entity', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    if (!entityId) return { success: false, error: 'entityId is required' }
    return ctx.worldState.removeEntity(entityId, ctx.roleId)
  },

  update_entity: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'update_entity', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const updates = p.updates as Partial<Entity>
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (!updates) return { success: false, error: 'updates are required' }
    return ctx.worldState.updateEntity(entityId, updates, ctx.roleId)
  },

  damage_entity: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'damage_entity', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const amount = p.amount as number
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (typeof amount !== 'number') return { success: false, error: 'amount must be a number' }
    return ctx.worldState.damageEntity(entityId, amount, ctx.roleId)
  },

  heal_entity: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'heal_entity', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const amount = (p.amount as number) ?? 0
    if (!entityId) return { success: false, error: 'entityId is required' }
    return ctx.worldState.healEntity(entityId, amount)
  },

  kill_entity: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'kill_entity', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    if (!entityId) return { success: false, error: 'entityId is required' }
    return ctx.worldState.killEntity(entityId, ctx.roleId)
  },

  respawn_entity: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'respawn_entity', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const position = p.position as { col: number; row: number }
    const hp = p.hp as number
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (!position) return { success: false, error: 'position is required' }
    if (typeof hp !== 'number') return { success: false, error: 'hp must be a number' }
    const entity = ctx.worldState.getEntity(entityId)
    if (!entity) return { success: false, error: `Entity '${entityId}' not found` }
    return ctx.worldState.updateEntity(entityId, {
      position,
      state: 'idle',
      properties: { ...entity.properties, hp },
    }, ctx.roleId)
  },

  // ── Visual & Animation ─────────────────────────────────────────────────

  set_entity_state: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'set_entity_state', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const state = p.state as EntityState
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (!state) return { success: false, error: 'state is required' }
    return ctx.worldState.setEntityState(entityId, state)
  },

  trigger_animation: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'trigger_animation', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const animType = p.animType as string
    if (!entityId || !animType) return { success: false, error: 'entityId and animType are required' }
    ctx.rendererEvents.push({
      type: 'entity_state_changed',
      entityId,
      state: animType as EntityState,
    })
    return { success: true }
  },

  show_speech_bubble: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'show_speech_bubble', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const text = p.text as string
    const duration = p.duration as number | undefined
    if (!entityId || !text) return { success: false, error: 'entityId and text are required' }
    ctx.rendererEvents.push({ type: 'speech', entityId, text, duration })
    return { success: true }
  },

  show_effect: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'show_effect', params: p })
      return { success: true }
    }
    const position = p.position as GridPosition | FreeformPosition
    const effectTag = p.effectTag as string
    const duration = p.duration as number | undefined
    if (!position || !effectTag) {
      return { success: false, error: 'position and effectTag are required' }
    }
    ctx.rendererEvents.push({ type: 'effect', position, effectTag, duration })
    return { success: true }
  },

  // ── Communication ───────────────────────────────────────────────────────

  narrate: (p, ctx): ActionResult => {
    const text = p.text as string
    const style = p.style as string | undefined
    if (!text) return { success: false, error: 'text is required' }
    // In queuing mode, only queue the action — the event will be produced when the queued
    // narrate is processed through WorldState.narrate which pushes the renderer event.
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'narrate', params: p })
      return { success: true }
    }
    ctx.rendererEvents.push({ type: 'narration', text, style: style as 'dramatic' | 'normal' | 'shout' | 'whisper' | undefined })
    return { success: true }
  },

  describe_scene: (p, ctx): ActionResult => {
    const pos = ctx.currentEntityPosition
    const radius = (p.radius as number) ?? 5
    if (!pos) return { success: false, error: 'No current entity position' }
    const nearby = ctx.worldState.getNearbyEntities(pos, radius)
    return { success: true, data: nearby }
  },

  // ── Orchestrator-only Tools ────────────────────────────────────────────

  give_turn: (p, ctx): ActionResult => {
    if (!ctx.isOrchestrator) return { success: false, error: 'Only the orchestrator can give turns' }
    const toAgentId = p.agentRoleId as string
    if (!toAgentId) return { success: false, error: 'agentRoleId is required' }
    ctx.orchestratorActions.push({ type: 'give_turn', toAgentId })
    return { success: true }
  },

  end_round: (_p, ctx): ActionResult => {
    if (!ctx.isOrchestrator) return { success: false, error: 'Only the orchestrator can end rounds' }
    // In queuing mode, do NOT mutate tick/round — handleOrchestratorAction will do it in the events phase
    if (!ctx.queuing) {
      ctx.worldState.incrementTick()
      const round = ctx.worldState.getRound()
      if (round !== undefined) ctx.worldState.setRound(round + 1)
    }
    ctx.orchestratorActions.push({ type: 'end_round' })
    return { success: true, data: { tick: ctx.worldState.getTick() } }
  },

  pause_module: (_p, ctx): ActionResult => {
    if (!ctx.isOrchestrator) return { success: false, error: 'Only the orchestrator can pause' }
    ctx.orchestratorActions.push({ type: 'pause' })
    return { success: true }
  },

  resume_module: (_p, ctx): ActionResult => {
    if (!ctx.isOrchestrator) return { success: false, error: 'Only the orchestrator can resume' }
    ctx.orchestratorActions.push({ type: 'resume' })
    return { success: true }
  },

  // ── Visual Effect Tools ─────────────────────────────────────────────────

  /** Shake the camera for impact moments. Orchestrator or any agent can call this. */
  shake_camera: (p, ctx): ActionResult => {
    const intensity = (p.intensity as number) ?? 5
    const duration = (p.duration as number) ?? 300
    ctx.rendererEvents.push({ type: 'camera_shake', intensity, duration })
    return { success: true }
  },

  /** Request the camera to follow a specific entity. Orchestrator or any agent can call this. */
  camera_follow: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    if (!entityId) return { success: false, error: 'entityId is required' }
    ctx.rendererEvents.push({ type: 'camera_follow', entityId })
    return { success: true }
  },

  /** Flash the screen for dramatic moments (hits, magic, etc.). Orchestrator or any agent can call this. */
  flash_screen: (p, ctx): ActionResult => {
    const color = (p.color as string) ?? '#ffffff'
    const duration = (p.duration as number) ?? 150
    ctx.rendererEvents.push({ type: 'screen_flash', color, duration })
    return { success: true }
  },

  // ── New Tools ──────────────────────────────────────────────────────────

  set_tile: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'set_tile', params: p })
      return { success: true }
    }
    const col = p.col as number
    const row = p.row as number
    const updates = p.updates as Partial<import('./types').Tile>
    if (col === undefined || row === undefined) return { success: false, error: 'col and row are required' }
    if (!updates || typeof updates !== 'object') return { success: false, error: 'updates object is required' }
    return ctx.worldState.setTile(col, row, updates, ctx.roleId)
  },

  set_world_property: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'set_world_property', params: p })
      return { success: true }
    }
    const key = p.key as string
    if (!key) return { success: false, error: 'key is required' }
    return ctx.worldState.setWorldProperty(key, p.value, ctx.roleId)
  },

  get_world_properties: (_p, ctx): ActionResult => {
    return { success: true, data: ctx.worldState.getWorldProperties() }
  },

  update_entity_property: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'update_entity_property', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const key = p.key as string
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (!key) return { success: false, error: 'key is required' }
    return ctx.worldState.updateEntityProperty(entityId, key, p.value, ctx.roleId)
  },

  set_entity_facing: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'set_entity_facing', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const facing = p.facing as 'left' | 'right' | 'up' | 'down'
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (!facing) return { success: false, error: 'facing is required' }
    return ctx.worldState.setEntityFacing(entityId, facing, ctx.roleId)
  },

  // ── Action Sequencer ────────────────────────────────────────────────────

  wait_for_animations: (_p, _ctx): ActionResult => {
    // This is a sentinel tool — the orchestrator intercepts it and handles the wait.
    // The tool itself just returns success.
    return { success: true, data: { waited: true } }
  },

  // ── Timers ──────────────────────────────────────────────────────────────

  create_timer: (p, ctx): ActionResult => {
    const id = p.id as string
    const name = p.name as string
    if (!id || !name) return { success: false, error: 'id and name are required' }

    const delayTicks = p.delayTicks as number | undefined
    const delayMs = p.delayMs as number | undefined
    if (delayTicks === undefined && delayMs === undefined) {
      return { success: false, error: 'Either delayTicks or delayMs is required' }
    }

    const timer: GameTimer = {
      id,
      name,
      targetTick: delayTicks !== undefined ? ctx.worldState.getTick() + delayTicks : undefined,
      targetTimeMs: delayMs !== undefined ? Date.now() + delayMs : undefined,
      recurring: (p.recurring as boolean) ?? false,
      intervalTicks: p.intervalTicks as number | undefined,
      intervalMs: p.intervalMs as number | undefined,
      data: (p.data as Record<string, unknown>) ?? {},
      createdBy: ctx.roleId,
      createdAt: Date.now(),
      paused: false,
    }
    return ctx.worldState.createTimer(timer)
  },

  cancel_timer: (p, ctx): ActionResult => {
    const timerId = p.timerId as string
    if (!timerId) return { success: false, error: 'timerId is required' }
    return ctx.worldState.cancelTimer(timerId)
  },

  get_timers: (_p, ctx): ActionResult => {
    return { success: true, data: ctx.worldState.getTimers() }
  },

  // ── Triggers ────────────────────────────────────────────────────────────

  create_trigger: (p, ctx): ActionResult => {
    const id = p.id as string
    const name = p.name as string
    const shape = p.shape as 'rect' | 'circle'
    if (!id || !name || !shape) return { success: false, error: 'id, name, and shape are required' }

    const trigger: TriggerZone = {
      id,
      name,
      shape,
      rect: shape === 'rect' ? {
        col: p.col as number,
        row: p.row as number,
        width: p.width as number,
        height: p.height as number,
      } : undefined,
      center: shape === 'circle' ? { col: p.centerCol as number, row: p.centerRow as number } as GridPosition : undefined,
      radius: p.radius as number | undefined,
      fireOn: (p.fireOn as 'enter' | 'exit' | 'both') ?? 'enter',
      oneShot: (p.oneShot as boolean) ?? false,
      entityFilter: p.entityFilter as string | undefined,
      data: (p.data as Record<string, unknown>) ?? {},
      createdBy: ctx.roleId,
      active: true,
      entitiesInside: [],
    }
    return ctx.worldState.createTrigger(trigger)
  },

  remove_trigger: (p, ctx): ActionResult => {
    const triggerId = p.triggerId as string
    if (!triggerId) return { success: false, error: 'triggerId is required' }
    return ctx.worldState.removeTrigger(triggerId)
  },

  get_triggers: (_p, ctx): ActionResult => {
    return { success: true, data: ctx.worldState.getTriggers() }
  },

  // ── Status Effects ──────────────────────────────────────────────────────

  apply_status_effect: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    const name = p.name as string
    if (!entityId || !name) return { success: false, error: 'entityId and name are required' }

    const effect: StatusEffect = {
      id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      entityId,
      durationTicks: p.durationTicks as number | undefined,
      durationMs: p.durationMs as number | undefined,
      permanent: (p.permanent as boolean) ?? false,
      properties: (p.properties as Record<string, unknown>) ?? {},
      source: ctx.roleId,
      appliedAt: ctx.worldState.getTick(),
      stackable: (p.stackable as boolean) ?? false,
      icon: p.icon as string | undefined,
    }
    return ctx.worldState.applyStatusEffect(effect)
  },

  remove_status_effect: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    const effectName = p.effectName as string
    if (!entityId || !effectName) return { success: false, error: 'entityId and effectName are required' }
    return ctx.worldState.removeStatusEffect(entityId, effectName)
  },

  get_status_effects: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    if (!entityId) return { success: false, error: 'entityId is required' }
    return { success: true, data: ctx.worldState.getStatusEffects(entityId) }
  },

  // ── Inventory ───────────────────────────────────────────────────────────

  give_item: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'give_item', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const name = p.name as string
    const type = p.type as string
    if (!entityId || !name || !type) return { success: false, error: 'entityId, name, and type are required' }

    const item: Item = {
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      type,
      tags: (p.tags as string[]) ?? [],
      properties: (p.properties as Record<string, unknown>) ?? {},
      spriteTag: p.spriteTag as string | undefined,
      stackable: (p.stackable as boolean) ?? false,
      quantity: (p.quantity as number) ?? 1,
      equipped: false,
    }
    return ctx.worldState.addItem(entityId, item)
  },

  remove_item: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'remove_item', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const itemId = p.itemId as string
    if (!entityId || !itemId) return { success: false, error: 'entityId and itemId are required' }
    return ctx.worldState.removeItem(entityId, itemId)
  },

  get_inventory: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    if (!entityId) return { success: false, error: 'entityId is required' }
    return { success: true, data: ctx.worldState.getInventory(entityId) }
  },

  equip_item: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'equip_item', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const itemId = p.itemId as string
    const slot = p.slot as string
    if (!entityId || !itemId || !slot) return { success: false, error: 'entityId, itemId, and slot are required' }
    return ctx.worldState.equipItem(entityId, itemId, slot)
  },

  unequip_item: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'unequip_item', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const itemId = p.itemId as string
    if (!entityId || !itemId) return { success: false, error: 'entityId and itemId are required' }
    return ctx.worldState.unequipItem(entityId, itemId)
  },

  transfer_item: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'transfer_item', params: p })
      return { success: true }
    }
    const fromEntityId = p.fromEntityId as string
    const toEntityId = p.toEntityId as string
    const itemId = p.itemId as string
    if (!fromEntityId || !toEntityId || !itemId) {
      return { success: false, error: 'fromEntityId, toEntityId, and itemId are required' }
    }
    return ctx.worldState.transferItem(fromEntityId, toEntityId, itemId)
  },

  use_item: (p, ctx): ActionResult => {
    if (ctx.queuing && ctx.queueAction) {
      ctx.queueAction({ toolName: 'use_item', params: p })
      return { success: true }
    }
    const entityId = p.entityId as string
    const itemId = p.itemId as string
    if (!entityId || !itemId) return { success: false, error: 'entityId and itemId are required' }
    return ctx.worldState.useItem(entityId, itemId, p.targetEntityId as string | undefined)
  },

  // ── Groups ──────────────────────────────────────────────────────────────

  create_group: (p, ctx): ActionResult => {
    const id = p.id as string
    const name = p.name as string
    if (!id || !name) return { success: false, error: 'id and name are required' }

    const group: EntityGroup = {
      id,
      name,
      memberIds: (p.memberIds as string[]) ?? [],
      properties: (p.properties as Record<string, unknown>) ?? {},
      createdBy: ctx.roleId,
    }
    return ctx.worldState.createGroup(group)
  },

  add_to_group: (p, ctx): ActionResult => {
    const groupId = p.groupId as string
    const entityId = p.entityId as string
    if (!groupId || !entityId) return { success: false, error: 'groupId and entityId are required' }
    return ctx.worldState.addToGroup(groupId, entityId)
  },

  remove_from_group: (p, ctx): ActionResult => {
    const groupId = p.groupId as string
    const entityId = p.entityId as string
    if (!groupId || !entityId) return { success: false, error: 'groupId and entityId are required' }
    return ctx.worldState.removeFromGroup(groupId, entityId)
  },

  get_group: (p, ctx): ActionResult => {
    const groupId = p.groupId as string
    if (!groupId) return { success: false, error: 'groupId is required' }
    const group = ctx.worldState.getGroup(groupId)
    if (!group) return { success: false, error: `Group '${groupId}' not found` }
    return { success: true, data: group }
  },

  get_groups: (_p, ctx): ActionResult => {
    return { success: true, data: ctx.worldState.getGroups() }
  },

  get_entity_groups: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    if (!entityId) return { success: false, error: 'entityId is required' }
    return { success: true, data: ctx.worldState.getEntityGroups(entityId) }
  },

  // ── Pathfinding ─────────────────────────────────────────────────────────

  find_path: (p, ctx): ActionResult => {
    const grid = ctx.worldState.getGridWorld()
    if (!grid) return { success: false, error: 'Pathfinding requires a grid world' }

    const fromCol = p.fromCol as number
    const fromRow = p.fromRow as number
    const toCol = p.toCol as number
    const toRow = p.toRow as number
    if (fromCol === undefined || fromRow === undefined || toCol === undefined || toRow === undefined) {
      return { success: false, error: 'fromCol, fromRow, toCol, toRow are required' }
    }

    const avoidPositions: GridPosition[] = []
    if (p.avoidEntities) {
      const entities = ctx.worldState.getEntities()
      for (const entity of Object.values(entities)) {
        if ('col' in entity.position && entity.visible && entity.state !== 'dead') {
          avoidPositions.push(entity.position as GridPosition)
        }
      }
    }

    const path = findPath(grid, { col: fromCol, row: fromRow }, { col: toCol, row: toRow }, {
      maxDistance: (p.maxDistance as number) ?? 100,
      avoidPositions,
      diagonals: (p.diagonals as boolean) ?? false,
    })

    if (!path) return { success: false, error: 'No path found' }
    return { success: true, data: { path, distance: path.length - 1 } }
  },

  get_path_distance: (p, ctx): ActionResult => {
    const grid = ctx.worldState.getGridWorld()
    if (!grid) return { success: false, error: 'Pathfinding requires a grid world' }

    const fromCol = p.fromCol as number
    const fromRow = p.fromRow as number
    const toCol = p.toCol as number
    const toRow = p.toRow as number
    if (fromCol === undefined || fromRow === undefined || toCol === undefined || toRow === undefined) {
      return { success: false, error: 'fromCol, fromRow, toCol, toRow are required' }
    }

    const result = getPathDistance(grid, { col: fromCol, row: fromRow }, { col: toCol, row: toRow })
    return { success: true, data: result }
  },

  // ── State Machines ──────────────────────────────────────────────────────

  create_state_machine: (p, ctx): ActionResult => {
    const id = p.id as string
    const initialState = p.initialState as string
    const states = p.states as string[]
    const transitions = p.transitions as Record<string, string[]>
    if (!id || !initialState || !states) {
      return { success: false, error: 'id, initialState, and states are required' }
    }

    const sm: StateMachine = {
      id,
      entityId: p.entityId as string | undefined,
      currentState: initialState,
      states,
      transitions: transitions ?? {},
      data: (p.data as Record<string, unknown>) ?? {},
      createdBy: ctx.roleId,
    }
    return ctx.worldState.createStateMachine(sm)
  },

  transition_state: (p, ctx): ActionResult => {
    const machineId = p.machineId as string
    const newState = p.newState as string
    if (!machineId || !newState) return { success: false, error: 'machineId and newState are required' }
    return ctx.worldState.transitionState(machineId, newState, ctx.roleId)
  },

  get_state_machine: (p, ctx): ActionResult => {
    const machineId = p.machineId as string
    if (!machineId) return { success: false, error: 'machineId is required' }
    const sm = ctx.worldState.getStateMachine(machineId)
    if (!sm) return { success: false, error: `State machine '${machineId}' not found` }
    return { success: true, data: sm }
  },

  get_state_machines: (_p, ctx): ActionResult => {
    return { success: true, data: ctx.worldState.getStateMachines() }
  },

  // ── Relationships ───────────────────────────────────────────────────────

  create_relationship: (p, ctx): ActionResult => {
    const fromEntityId = p.fromEntityId as string
    const toEntityId = p.toEntityId as string
    const type = p.type as string
    if (!fromEntityId || !toEntityId || !type) {
      return { success: false, error: 'fromEntityId, toEntityId, and type are required' }
    }

    const rel: Relationship = {
      id: `rel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromEntityId,
      toEntityId,
      type,
      bidirectional: (p.bidirectional as boolean) ?? false,
      properties: (p.properties as Record<string, unknown>) ?? {},
      createdBy: ctx.roleId,
    }
    return ctx.worldState.createRelationship(rel)
  },

  remove_relationship: (p, ctx): ActionResult => {
    const fromEntityId = p.fromEntityId as string
    const toEntityId = p.toEntityId as string
    const type = p.type as string
    if (!fromEntityId || !toEntityId || !type) {
      return { success: false, error: 'fromEntityId, toEntityId, and type are required' }
    }
    return ctx.worldState.removeRelationship(fromEntityId, toEntityId, type)
  },

  get_relationships: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    if (!entityId) return { success: false, error: 'entityId is required' }
    return { success: true, data: ctx.worldState.getRelationships(entityId, p.type as string | undefined) }
  },

  get_related_entities: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    const type = p.type as string
    if (!entityId || !type) return { success: false, error: 'entityId and type are required' }
    return { success: true, data: ctx.worldState.getRelatedEntities(entityId, type) }
  },
}

// ── Anthropic Tool Definitions ────────────────────────────────────────────────

type SchemaProp =
  | { type: 'string'; description?: string; enum?: string[] }
  | { type: 'number'; description?: string }
  | { type: 'boolean'; description?: string }
  | { type: 'integer'; description?: string }
  | { type: 'object'; description?: string; properties?: Record<string, SchemaProp> }

function buildSchema(
  props: Record<string, SchemaProp>,
  required?: string[]
): { type: 'object'; properties: typeof props; required: string[] } {
  return { type: 'object', properties: props, required: required ?? [] }
}

const TOOL_DEFINITIONS: Record<string, Anthropic.Tool> = {
  get_world_state: {
    name: 'get_world_state',
    description: 'Get the complete current state of the world — all entities, map, and recent events. Call this to understand the current situation before taking actions.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  get_entity: {
    name: 'get_entity',
    description: 'Get detailed information about a specific entity.',
    input_schema: buildSchema({
      id: { type: 'string', description: 'The entity ID to look up' },
    }, ['id']),
  },

  get_entities_by_type: {
    name: 'get_entities_by_type',
    description: 'Get all entities of a specific type (e.g. "player", "enemy", "item").',
    input_schema: buildSchema({
      type: { type: 'string', description: 'Entity type to filter by (e.g. "player", "enemy", "item")' },
    }, ['type']),
  },

  get_entities_nearby: {
    name: 'get_entities_nearby',
    description: 'Get all visible entities within a radius of a position.',
    input_schema: buildSchema({
      position: {
        type: 'object',
        description: 'Center position — use {col, row} for grid worlds or {x, y} for freeform worlds',
        properties: {
          col: { type: 'number', description: 'Column (grid world)' },
          row: { type: 'number', description: 'Row (grid world)' },
          x: { type: 'number', description: 'X coordinate (freeform world)' },
          y: { type: 'number', description: 'Y coordinate (freeform world)' },
        },
      },
      radius: { type: 'number', description: 'Search radius (default: 5 tiles or units)' },
    }, ['position']),
  },

  get_tile: {
    name: 'get_tile',
    description: 'Get information about a specific tile in a grid world.',
    input_schema: buildSchema({
      col: { type: 'number', description: 'Column number' },
      row: { type: 'number', description: 'Row number' },
    }, ['col', 'row']),
  },

  move_entity: {
    name: 'move_entity',
    description: 'Move an entity to a new position. The engine validates walkability for grid worlds. Use delay to sequence actions visually.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'ID of the entity to move' },
      position: {
        type: 'object',
        description: 'Target position — {col, row} for grid or {x, y} for freeform',
        properties: {
          col: { type: 'number', description: 'Column (grid world)' },
          row: { type: 'number', description: 'Row (grid world)' },
          x: { type: 'number', description: 'X coordinate (freeform world)' },
          y: { type: 'number', description: 'Y coordinate (freeform world)' },
        },
      },
      animate: { type: 'boolean', description: 'Whether to animate the movement (default: true)' },
      delay: { type: 'number', description: 'Delay in ms before this action takes visual effect (default: 0)' },
    }, ['entityId', 'position']),
  },

  create_entity: {
    name: 'create_entity',
    description: '[Orchestrator only] Create a new entity in the world.',
    input_schema: {
      type: 'object',
      properties: {
        entity: {
          type: 'object',
          description: 'The entity to create. Must include id, type, name, position, spriteTag, and properties.',
        },
      },
      required: ['entity'],
    },
  },

  remove_entity: {
    name: 'remove_entity',
    description: 'Remove an entity from the world permanently.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'ID of the entity to remove' },
    }, ['entityId']),
  },

  update_entity: {
    name: 'update_entity',
    description: 'Update properties of an existing entity. Properties are deep-merged — only the keys you provide are changed.',
    input_schema: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'ID of the entity to update' },
        updates: {
          type: 'object',
          description: 'Partial entity updates (state, properties, visible, facing, etc.)',
        },
      },
      required: ['entityId', 'updates'],
    },
  },

  damage_entity: {
    name: 'damage_entity',
    description: 'Deal damage to an entity, reducing its HP. Use delay to visually sequence after a move.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'ID of the entity to damage' },
      amount: { type: 'number', description: 'Amount of damage to deal (positive number)' },
      delay: { type: 'number', description: 'Delay in ms before this action takes visual effect (default: 0)' },
    }, ['entityId', 'amount']),
  },

  heal_entity: {
    name: 'heal_entity',
    description: 'Heal an entity, restoring HP up to maxHp.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'ID of the entity to heal' },
      amount: { type: 'number', description: 'Amount of HP to restore' },
    }, ['entityId', 'amount']),
  },

  kill_entity: {
    name: 'kill_entity',
    description: 'Instantly kill an entity (sets HP to 0, state to dead).',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'ID of the entity to kill' },
    }, ['entityId']),
  },

  respawn_entity: {
    name: 'respawn_entity',
    description: 'Respawn an entity at a position with a specified HP. Use this after death to return to the fight. Pass your spawn position and maxHp to reset fully.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entityId: { type: 'string', description: 'ID of the entity to respawn (usually your own entityId)' },
        position: {
          type: 'object',
          description: 'Spawn position — {col, row} for grid worlds',
          properties: {
            col: { type: 'number' },
            row: { type: 'number' },
          },
        },
        hp: { type: 'number', description: 'HP to restore on respawn (use your maxHp)' },
      },
      required: ['entityId', 'position', 'hp'],
    },
  },

  set_entity_state: {
    name: 'set_entity_state',
    description: 'Change an entity\'s visual/animation state.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'ID of the entity' },
      state: {
        type: 'string',
        description: 'New state',
        enum: ['idle', 'moving', 'attacking', 'casting', 'talking', 'dying', 'dead', 'hidden', 'stunned', 'flying'],
      },
    }, ['entityId', 'state']),
  },

  trigger_animation: {
    name: 'trigger_animation',
    description: 'Trigger a visual animation on an entity.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'ID of the entity' },
      animType: { type: 'string', description: 'Animation type to trigger' },
    }, ['entityId', 'animType']),
  },

  show_speech_bubble: {
    name: 'show_speech_bubble',
    description: 'Display a speech bubble above an entity for spectators to read.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'ID of the entity to speak' },
      text: { type: 'string', description: 'The speech text to display' },
      duration: { type: 'number', description: 'Duration in ms before auto-dismiss (default: 3000)' },
    }, ['entityId', 'text']),
  },

  show_effect: {
    name: 'show_effect',
    description: 'Play a visual effect at a position (spell impact, explosion, magic, etc.).',
    input_schema: buildSchema({
      position: {
        type: 'object',
        description: 'Position for the effect',
        properties: {
          col: { type: 'number', description: 'Column (grid)' },
          row: { type: 'number', description: 'Row (grid)' },
          x: { type: 'number', description: 'X coordinate (freeform)' },
          y: { type: 'number', description: 'Y coordinate (freeform)' },
        },
      },
      effectTag: { type: 'string', description: 'Effect tag from the assets (e.g. "fire", "sparkles", "slash")' },
      duration: { type: 'number', description: 'Effect duration in ms' },
    }, ['position', 'effectTag']),
  },

  narrate: {
    name: 'narrate',
    description: 'Speak narration text that all spectators can read. Use for DM descriptions, dramatic moments, environmental storytelling. This is your primary storytelling tool.',
    input_schema: buildSchema({
      text: { type: 'string', description: 'The narration text to display prominently to all spectators' },
      style: {
        type: 'string',
        description: 'Narration style',
        enum: ['dramatic', 'normal', 'shout', 'whisper'],
      },
      delay: { type: 'number', description: 'Delay in ms before this narration appears (default: 0)' },
    }, ['text']),
  },

  describe_scene: {
    name: 'describe_scene',
    description: 'Get a description of the area around the current entity.',
    input_schema: buildSchema({
      radius: { type: 'number', description: 'View radius (default: 5)' },
    }),
  },

  // Orchestrator-only
  give_turn: {
    name: 'give_turn',
    description: '[Orchestrator only] Grant a turn to a specific agent. Used in turn-based scheduling to control who acts next.',
    input_schema: buildSchema({
      agentRoleId: { type: 'string', description: 'The agent role ID to give a turn to' },
    }, ['agentRoleId']),
  },

  end_round: {
    name: 'end_round',
    description: '[Orchestrator only] End the current round and advance to the next. Increments the tick counter.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  pause_module: {
    name: 'pause_module',
    description: '[Orchestrator only] Pause the module.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  resume_module: {
    name: 'resume_module',
    description: '[Orchestrator only] Resume the module after a pause.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  // New tools
  set_tile: {
    name: 'set_tile',
    description: 'Modify a tile at runtime — change walkability, type, or spriteTag. Use to open doors, reveal traps, or change terrain.',
    input_schema: buildSchema({
      col: { type: 'number', description: 'Column of the tile to modify' },
      row: { type: 'number', description: 'Row of the tile to modify' },
      updates: {
        type: 'object',
        description: 'Tile properties to update: walkable (boolean), type (string), spriteTag (string)',
      },
    }, ['col', 'row', 'updates']),
  },

  set_world_property: {
    name: 'set_world_property',
    description: 'Set a global game-world property (phase, score, objective status, flags). Use to track global state not tied to an entity.',
    input_schema: buildSchema({
      key: { type: 'string', description: 'Property name (e.g. "phase", "score", "bossDefeated")' },
      value: { type: 'string', description: 'Value to set (JSON-serializable)' },
    }, ['key', 'value']),
  },

  get_world_properties: {
    name: 'get_world_properties',
    description: 'Get all global world properties (phase, score, flags, etc.).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  update_entity_property: {
    name: 'update_entity_property',
    description: 'Safely update a single key inside entity.properties without overwriting other properties. Prefer this over update_entity when only changing hp, mana, or a custom flag.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'ID of the entity' },
      key: { type: 'string', description: 'The property key to update (e.g. "hp", "mana", "poisoned")' },
      value: { type: 'string', description: 'New value for the property' },
    }, ['entityId', 'key', 'value']),
  },

  set_entity_facing: {
    name: 'set_entity_facing',
    description: 'Set the direction an entity is facing. Affects sprite mirroring and combat orientation.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'ID of the entity' },
      facing: {
        type: 'string',
        description: 'Direction to face',
        enum: ['left', 'right', 'up', 'down'],
      },
    }, ['entityId', 'facing']),
  },

  shake_camera: {
    name: 'shake_camera',
    description: 'Shake the camera to create impact for hits, explosions, or dramatic moments. Use intensity 1-10 (default 5) and duration in milliseconds (default 300).',
    input_schema: buildSchema({
      intensity: { type: 'number', description: 'Shake intensity 1-10 (default: 5)' },
      duration: { type: 'number', description: 'Duration in ms (default: 300)' },
    }, []),
  },

  camera_follow: {
    name: 'camera_follow',
    description: 'Tell the camera to follow a specific entity. The camera will smoothly track that entity. Call this when an entity becomes the focus of attention.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'ID of the entity for the camera to follow' },
    }, ['entityId']),
  },

  flash_screen: {
    name: 'flash_screen',
    description: 'Flash the screen with a color for dramatic moments (hits, spells, etc.). Use color hex like "#ff0000" for red or "#ffffff" for white. Duration in ms (default 150).',
    input_schema: buildSchema({
      color: { type: 'string', description: 'Hex color string e.g. "#ff0000" (default: #ffffff)' },
      duration: { type: 'number', description: 'Duration in ms (default: 150)' },
    }, []),
  },

  // ── Action Sequencer ────────────────────────────────────────────────────

  wait_for_animations: {
    name: 'wait_for_animations',
    description: 'Wait for all pending animations and delayed actions to complete before continuing. Use this between move_entity and damage_entity to ensure the movement finishes before the hit lands visually.',
    input_schema: buildSchema({
      timeout: { type: 'number', description: 'Max wait time in ms (default: 5000)' },
    }, []),
  },

  // ── Timers ──────────────────────────────────────────────────────────────

  create_timer: {
    name: 'create_timer',
    description: 'Create a timer that fires after a delay. Use for poison DOT, buff expiry, delayed traps, respawn timers. The DM is notified when the timer fires and decides the effect.',
    input_schema: buildSchema({
      id: { type: 'string', description: 'Unique timer ID (e.g. "poison_dot_warrior")' },
      name: { type: 'string', description: 'Human-readable timer name' },
      delayTicks: { type: 'integer', description: 'Fire after this many game ticks' },
      delayMs: { type: 'integer', description: 'Fire after this many milliseconds' },
      recurring: { type: 'boolean', description: 'Re-schedule after firing (default: false)' },
      intervalTicks: { type: 'integer', description: 'For recurring: fire every N ticks' },
      intervalMs: { type: 'integer', description: 'For recurring: fire every N ms' },
      data: { type: 'object', description: 'Arbitrary payload (entityId, damage amount, etc.)' },
    }, ['id', 'name']),
  },

  cancel_timer: {
    name: 'cancel_timer',
    description: 'Cancel a running timer by ID.',
    input_schema: buildSchema({
      timerId: { type: 'string', description: 'ID of the timer to cancel' },
    }, ['timerId']),
  },

  get_timers: {
    name: 'get_timers',
    description: 'Get all active timers.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  // ── Triggers ────────────────────────────────────────────────────────────

  create_trigger: {
    name: 'create_trigger',
    description: 'Create a spatial trigger zone. When entities enter/exit the zone, the DM is notified. Use for traps, zone effects, proximity events, doors.',
    input_schema: buildSchema({
      id: { type: 'string', description: 'Unique trigger ID (e.g. "trap_room_3")' },
      name: { type: 'string', description: 'Human-readable name' },
      shape: { type: 'string', description: 'Zone shape', enum: ['rect', 'circle'] },
      col: { type: 'integer', description: 'Top-left column (rect shape)' },
      row: { type: 'integer', description: 'Top-left row (rect shape)' },
      width: { type: 'integer', description: 'Width in tiles (rect shape)' },
      height: { type: 'integer', description: 'Height in tiles (rect shape)' },
      centerCol: { type: 'integer', description: 'Center column (circle shape)' },
      centerRow: { type: 'integer', description: 'Center row (circle shape)' },
      radius: { type: 'number', description: 'Radius in tiles (circle shape)' },
      fireOn: { type: 'string', description: 'When to fire', enum: ['enter', 'exit', 'both'] },
      oneShot: { type: 'boolean', description: 'Destroy after first fire (default: false)' },
      entityFilter: { type: 'string', description: 'Only trigger for this entity type (e.g. "player")' },
      data: { type: 'object', description: 'Payload sent to DM when triggered' },
    }, ['id', 'name', 'shape']),
  },

  remove_trigger: {
    name: 'remove_trigger',
    description: 'Remove a trigger zone.',
    input_schema: buildSchema({
      triggerId: { type: 'string', description: 'ID of the trigger to remove' },
    }, ['triggerId']),
  },

  get_triggers: {
    name: 'get_triggers',
    description: 'Get all active trigger zones.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  // ── Status Effects ──────────────────────────────────────────────────────

  apply_status_effect: {
    name: 'apply_status_effect',
    description: 'Apply a status effect (buff/debuff) to an entity. The DM is notified when effects expire. Use for poison, shields, haste, stuns, etc.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'Entity to apply the effect to' },
      name: { type: 'string', description: 'Effect name (e.g. "Poisoned", "Shield", "Haste")' },
      durationTicks: { type: 'integer', description: 'Duration in game ticks' },
      durationMs: { type: 'integer', description: 'Duration in milliseconds' },
      permanent: { type: 'boolean', description: 'Never expires (default: false)' },
      properties: { type: 'object', description: 'Effect properties (damage_per_tick, armor_bonus, etc.)' },
      stackable: { type: 'boolean', description: 'Can multiple instances exist on same entity (default: false)' },
      icon: { type: 'string', description: 'Sprite tag for visual indicator' },
    }, ['entityId', 'name']),
  },

  remove_status_effect: {
    name: 'remove_status_effect',
    description: 'Remove a status effect from an entity by name.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'Entity to remove the effect from' },
      effectName: { type: 'string', description: 'Name of the effect to remove' },
    }, ['entityId', 'effectName']),
  },

  get_status_effects: {
    name: 'get_status_effects',
    description: 'Get all active status effects on an entity.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'Entity to query' },
    }, ['entityId']),
  },

  // ── Inventory ───────────────────────────────────────────────────────────

  give_item: {
    name: 'give_item',
    description: 'Give an item to an entity. Creates the item in their inventory.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'Entity to receive the item' },
      name: { type: 'string', description: 'Item name (e.g. "Health Potion", "Iron Sword")' },
      type: { type: 'string', description: 'Item type (weapon, potion, key, armor, misc)' },
      tags: { type: 'object', description: 'Array of tags (e.g. ["healing", "consumable"])' },
      properties: { type: 'object', description: 'Item properties (damage, healAmount, etc.)' },
      stackable: { type: 'boolean', description: 'Can stack with same name (default: false)' },
      quantity: { type: 'integer', description: 'Quantity (default: 1)' },
      spriteTag: { type: 'string', description: 'Sprite tag for visual' },
    }, ['entityId', 'name', 'type']),
  },

  remove_item: {
    name: 'remove_item',
    description: 'Remove an item from an entity\'s inventory.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'Entity to remove item from' },
      itemId: { type: 'string', description: 'ID of the item to remove' },
    }, ['entityId', 'itemId']),
  },

  get_inventory: {
    name: 'get_inventory',
    description: 'Get all items in an entity\'s inventory.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'Entity to query' },
    }, ['entityId']),
  },

  equip_item: {
    name: 'equip_item',
    description: 'Equip an item from inventory to a slot (mainhand, offhand, armor, accessory).',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'Entity to equip' },
      itemId: { type: 'string', description: 'ID of the item to equip' },
      slot: { type: 'string', description: 'Equipment slot (mainhand, offhand, armor, accessory)' },
    }, ['entityId', 'itemId', 'slot']),
  },

  unequip_item: {
    name: 'unequip_item',
    description: 'Unequip an item, returning it to inventory.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'Entity to unequip' },
      itemId: { type: 'string', description: 'ID of the item to unequip' },
    }, ['entityId', 'itemId']),
  },

  transfer_item: {
    name: 'transfer_item',
    description: 'Transfer an item from one entity to another (loot, trade, pickpocket).',
    input_schema: buildSchema({
      fromEntityId: { type: 'string', description: 'Entity giving the item' },
      toEntityId: { type: 'string', description: 'Entity receiving the item' },
      itemId: { type: 'string', description: 'ID of the item to transfer' },
    }, ['fromEntityId', 'toEntityId', 'itemId']),
  },

  use_item: {
    name: 'use_item',
    description: 'Use an item from inventory. Consumable items are removed. The DM decides the mechanical effect.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'Entity using the item' },
      itemId: { type: 'string', description: 'ID of the item to use' },
      targetEntityId: { type: 'string', description: 'Optional target entity (for thrown items, potions on ally, etc.)' },
    }, ['entityId', 'itemId']),
  },

  // ── Groups ──────────────────────────────────────────────────────────────

  create_group: {
    name: 'create_group',
    description: 'Create a named entity group (party, enemies, undead, etc.) for batch operations.',
    input_schema: buildSchema({
      id: { type: 'string', description: 'Group ID (e.g. "party", "enemies")' },
      name: { type: 'string', description: 'Display name' },
      memberIds: { type: 'object', description: 'Array of entity IDs to add initially' },
      properties: { type: 'object', description: 'Group properties (team score, faction, etc.)' },
    }, ['id', 'name']),
  },

  add_to_group: {
    name: 'add_to_group',
    description: 'Add an entity to a group.',
    input_schema: buildSchema({
      groupId: { type: 'string', description: 'Group ID' },
      entityId: { type: 'string', description: 'Entity ID to add' },
    }, ['groupId', 'entityId']),
  },

  remove_from_group: {
    name: 'remove_from_group',
    description: 'Remove an entity from a group.',
    input_schema: buildSchema({
      groupId: { type: 'string', description: 'Group ID' },
      entityId: { type: 'string', description: 'Entity ID to remove' },
    }, ['groupId', 'entityId']),
  },

  get_group: {
    name: 'get_group',
    description: 'Get a group by ID.',
    input_schema: buildSchema({
      groupId: { type: 'string', description: 'Group ID' },
    }, ['groupId']),
  },

  get_groups: {
    name: 'get_groups',
    description: 'Get all groups.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  get_entity_groups: {
    name: 'get_entity_groups',
    description: 'Get all groups an entity belongs to.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'Entity ID' },
    }, ['entityId']),
  },

  // ── Pathfinding ─────────────────────────────────────────────────────────

  find_path: {
    name: 'find_path',
    description: 'Find the shortest path between two grid positions using A*. Returns the path — you decide whether to follow it by calling move_entity for each step.',
    input_schema: buildSchema({
      fromCol: { type: 'integer', description: 'Start column' },
      fromRow: { type: 'integer', description: 'Start row' },
      toCol: { type: 'integer', description: 'Target column' },
      toRow: { type: 'integer', description: 'Target row' },
      maxDistance: { type: 'integer', description: 'Max path length (default: 100)' },
      avoidEntities: { type: 'boolean', description: 'Avoid tiles occupied by entities (default: false)' },
      diagonals: { type: 'boolean', description: 'Allow diagonal movement (default: false)' },
    }, ['fromCol', 'fromRow', 'toCol', 'toRow']),
  },

  get_path_distance: {
    name: 'get_path_distance',
    description: 'Get the shortest path distance between two grid positions without the full path.',
    input_schema: buildSchema({
      fromCol: { type: 'integer', description: 'Start column' },
      fromRow: { type: 'integer', description: 'Start row' },
      toCol: { type: 'integer', description: 'Target column' },
      toRow: { type: 'integer', description: 'Target row' },
    }, ['fromCol', 'fromRow', 'toCol', 'toRow']),
  },

  // ── State Machines ──────────────────────────────────────────────────────

  create_state_machine: {
    name: 'create_state_machine',
    description: 'Create a state machine with named states and valid transitions. The engine validates transitions. Use for doors (locked→unlocked→open), quest progress, combat phases, etc.',
    input_schema: buildSchema({
      id: { type: 'string', description: 'Unique state machine ID (e.g. "door_main", "quest_progress")' },
      entityId: { type: 'string', description: 'Entity this state machine is tied to (optional, can be global)' },
      initialState: { type: 'string', description: 'Starting state' },
      states: { type: 'object', description: 'Array of all valid state names' },
      transitions: { type: 'object', description: 'Map of state → array of valid target states (e.g. {"locked": ["unlocked"], "unlocked": ["open", "locked"]})' },
      data: { type: 'object', description: 'Arbitrary data attached to the state machine' },
    }, ['id', 'initialState', 'states']),
  },

  transition_state: {
    name: 'transition_state',
    description: 'Transition a state machine to a new state. Fails if the transition is invalid.',
    input_schema: buildSchema({
      machineId: { type: 'string', description: 'State machine ID' },
      newState: { type: 'string', description: 'Target state' },
    }, ['machineId', 'newState']),
  },

  get_state_machine: {
    name: 'get_state_machine',
    description: 'Get a state machine by ID.',
    input_schema: buildSchema({
      machineId: { type: 'string', description: 'State machine ID' },
    }, ['machineId']),
  },

  get_state_machines: {
    name: 'get_state_machines',
    description: 'Get all state machines.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },

  // ── Relationships ───────────────────────────────────────────────────────

  create_relationship: {
    name: 'create_relationship',
    description: 'Create a typed relationship between two entities (owner, target, ally, enemy, summon_of, follower).',
    input_schema: buildSchema({
      fromEntityId: { type: 'string', description: 'Source entity' },
      toEntityId: { type: 'string', description: 'Target entity' },
      type: { type: 'string', description: 'Relationship type (owner, target, ally, enemy, summon_of, follower)' },
      bidirectional: { type: 'boolean', description: 'If true, A→B implies B→A (default: false)' },
      properties: { type: 'object', description: 'Relationship properties' },
    }, ['fromEntityId', 'toEntityId', 'type']),
  },

  remove_relationship: {
    name: 'remove_relationship',
    description: 'Remove a relationship between two entities.',
    input_schema: buildSchema({
      fromEntityId: { type: 'string', description: 'Source entity' },
      toEntityId: { type: 'string', description: 'Target entity' },
      type: { type: 'string', description: 'Relationship type to remove' },
    }, ['fromEntityId', 'toEntityId', 'type']),
  },

  get_relationships: {
    name: 'get_relationships',
    description: 'Get all relationships for an entity, optionally filtered by type.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'Entity to query' },
      type: { type: 'string', description: 'Optional: filter by relationship type' },
    }, ['entityId']),
  },

  get_related_entities: {
    name: 'get_related_entities',
    description: 'Get all entities related to a given entity by a specific relationship type. Returns full entity objects.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'Entity to query' },
      type: { type: 'string', description: 'Relationship type (e.g. "ally", "enemy")' },
    }, ['entityId', 'type']),
  },
}

export { TOOL_DEFINITIONS, ORCHESTRATOR_ONLY_TOOLS }

// ── Tool Converter ───────────────────────────────────────────────────────────

export function getAnthropicTools(
  availableTools: string[],
  isOrchestrator: boolean
): Anthropic.Tool[] {
  return availableTools
    .filter((name) => {
      if (ORCHESTRATOR_ONLY_TOOLS.has(name) && !isOrchestrator) return false
      return name in TOOL_DEFINITIONS
    })
    .map((name) => TOOL_DEFINITIONS[name])
}

export function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  context: AgentContext
): ActionResult {
  const fn = actionApi[toolName]
  if (!fn) return { success: false, error: `Unknown tool: ${toolName}` }
  try {
    return fn(params, context)
  } catch (err) {
    return { success: false, error: String(err) }
  }
}
