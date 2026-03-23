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
} from './types'
import type { WorldStateManager } from './WorldState'

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
    const entityId = p.entityId as string
    const position = p.position as GridPosition | FreeformPosition
    const animate = (p.animate as boolean) ?? true
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (!position) return { success: false, error: 'position is required' }
    return ctx.worldState.moveEntity(entityId, position, animate, ctx.roleId)
  },

  create_entity: (p, ctx): ActionResult => {
    const entity = p.entity as Entity
    if (!entity?.id || !entity?.type || !entity?.name) {
      return { success: false, error: 'entity must have id, type, and name' }
    }
    return ctx.worldState.createEntity(entity, ctx.roleId)
  },

  remove_entity: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    if (!entityId) return { success: false, error: 'entityId is required' }
    return ctx.worldState.removeEntity(entityId, ctx.roleId)
  },

  update_entity: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    const updates = p.updates as Partial<Entity>
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (!updates) return { success: false, error: 'updates are required' }
    return ctx.worldState.updateEntity(entityId, updates, ctx.roleId)
  },

  damage_entity: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    const amount = p.amount as number
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (typeof amount !== 'number') return { success: false, error: 'amount must be a number' }
    return ctx.worldState.damageEntity(entityId, amount, ctx.roleId)
  },

  heal_entity: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    const amount = (p.amount as number) ?? 0
    if (!entityId) return { success: false, error: 'entityId is required' }
    return ctx.worldState.healEntity(entityId, amount)
  },

  kill_entity: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    if (!entityId) return { success: false, error: 'entityId is required' }
    return ctx.worldState.killEntity(entityId, ctx.roleId)
  },

  respawn_entity: (p, ctx): ActionResult => {
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
    const entityId = p.entityId as string
    const state = p.state as EntityState
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (!state) return { success: false, error: 'state is required' }
    return ctx.worldState.setEntityState(entityId, state)
  },

  trigger_animation: (p, ctx): ActionResult => {
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
    const entityId = p.entityId as string
    const text = p.text as string
    const duration = p.duration as number | undefined
    if (!entityId || !text) return { success: false, error: 'entityId and text are required' }
    ctx.rendererEvents.push({ type: 'speech', entityId, text, duration })
    return { success: true }
  },

  show_effect: (p, ctx): ActionResult => {
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
    return ctx.worldState.narrate(text, ctx.roleId, style)
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
    ctx.worldState.incrementTick()
    const round = ctx.worldState.getRound()
    if (round !== undefined) ctx.worldState.setRound(round + 1)
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

  // ── New Tools ──────────────────────────────────────────────────────────

  set_tile: (p, ctx): ActionResult => {
    const col = p.col as number
    const row = p.row as number
    const updates = p.updates as Partial<import('./types').Tile>
    if (col === undefined || row === undefined) return { success: false, error: 'col and row are required' }
    if (!updates || typeof updates !== 'object') return { success: false, error: 'updates object is required' }
    return ctx.worldState.setTile(col, row, updates, ctx.roleId)
  },

  set_world_property: (p, ctx): ActionResult => {
    const key = p.key as string
    if (!key) return { success: false, error: 'key is required' }
    return ctx.worldState.setWorldProperty(key, p.value, ctx.roleId)
  },

  get_world_properties: (_p, ctx): ActionResult => {
    return { success: true, data: ctx.worldState.getWorldProperties() }
  },

  update_entity_property: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    const key = p.key as string
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (!key) return { success: false, error: 'key is required' }
    return ctx.worldState.updateEntityProperty(entityId, key, p.value, ctx.roleId)
  },

  set_entity_facing: (p, ctx): ActionResult => {
    const entityId = p.entityId as string
    const facing = p.facing as 'left' | 'right' | 'up' | 'down'
    if (!entityId) return { success: false, error: 'entityId is required' }
    if (!facing) return { success: false, error: 'facing is required' }
    return ctx.worldState.setEntityFacing(entityId, facing, ctx.roleId)
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
    description: 'Move an entity to a new position. The engine validates walkability for grid worlds.',
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
    description: 'Deal damage to an entity, reducing its HP.',
    input_schema: buildSchema({
      entityId: { type: 'string', description: 'ID of the entity to damage' },
      amount: { type: 'number', description: 'Amount of damage to deal (positive number)' },
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
