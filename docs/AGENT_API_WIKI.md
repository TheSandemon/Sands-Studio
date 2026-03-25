# Terminal Habitat — Agent API Wiki

> **Last updated:** March 2026
> **Source:** `src/shared/actionApi.ts`, `src/shared/types.ts`, `src/shared/WorldState.ts`, `src/main/module-engine/orchestrator.ts`, `src/main/module-engine/agent-pool.ts`, `src/preload/index.ts`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Agent Tools (Complete Reference)](#3-agent-tools-complete-reference)
   - 3.1 [Query Tools](#category-query-tools)
   - 3.2 [Entity Manipulation](#category-entity-manipulation)
   - 3.3 [Visual & Animation](#category-visual--animation)
   - 3.4 [World State](#category-world-state)
   - 3.5 [Communication](#category-communication)
   - 3.6 [Entity Facing](#category-entity-facing)
   - 3.7 [Orchestrator-Only](#category-orchestrator-only)
   - 3.8 [Camera & Screen Effects](#category-camera--screen-effects)
   - 3.9 [Action Sequencing](#category-action-sequencing)
   - 3.10 [Timers](#category-timers)
   - 3.11 [Triggers](#category-triggers)
   - 3.12 [Status Effects](#category-status-effects)
   - 3.13 [Inventory](#category-inventory)
   - 3.14 [Groups](#category-groups)
   - 3.15 [Pathfinding](#category-pathfinding)
   - 3.16 [State Machines](#category-state-machines)
   - 3.17 [Relationships](#category-relationships)
   - 3.18 [The `delay` Parameter](#the-delay-parameter)
4. [IPC Channels](#4-ipc-channels)
5. [Module Structure](#5-module-structure)
6. [Module Manifest](#6-module-manifest)
7. [Agent Role Definition](#7-agent-role-definition)
8. [Scheduling Modes](#8-scheduling-modes)
9. [Rate Limiting](#9-rate-limiting)
10. [World State Manager](#10-world-state-manager)
11. [Multi-Provider AI](#11-multi-provider-ai)
12. [Quick Reference](#12-quick-reference)
13. [Module Settings Dialog](#13-module-settings-dialog)

---

## 1. Overview

**Terminal Habitat** is an Electron desktop app combining real terminal panes (node-pty + xterm.js) with pixel art creatures (Pixi.js v8) and a **Modular AI Agent Game Engine**.

The game engine runs **modules** — self-contained game scenarios where AI agents act autonomously. Modules use a **DM as authority** model: there is no hardcoded rules engine. The orchestrator agent (or all agents in free-for-all mode) decides all game logic by calling tools. The engine validates and applies.

**Key principles:**
- Agents call tools → engine validates → world state updates → renderer events fire
- No hardcoded rules — the DM's personality IS the ruleset
- Assets are tagged, not hardcoded — semantic tag resolution
- World state is canonical — renderer always reflects the single source of truth

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      MAIN PROCESS                            │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Orchestrator│  │  Agent Pool  │  │  Module Loader    │  │
│  │ (scheduling)│  │ (AI clients) │  │ (asset registry)  │  │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬─────────┘  │
│         │                │                     │            │
│  ┌──────▼────────────────▼─────────────────────▼─────────┐  │
│  │              WorldStateManager                         │  │
│  │         (single source of truth)                       │  │
│  └────────────────────────┬──────────────────────────────┘  │
│                           │ IPC                               │
├───────────────────────────┼──────────────────────────────────┤
│                      PRELOAD                                 │
│              (contextBridge: moduleAPI)                       │
├───────────────────────────┼──────────────────────────────────┤
│                      RENDERER                                 │
│  ┌─────────────┐  ┌──────▼──────┐  ┌─────────────────────┐  │
│  │ React UI    │  │ ModuleView   │  │ Pixi.js Renderer    │  │
│  │ (controls)  │  │ (canvas)    │  │ (TileMap, Entities) │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Agent AI → Tool Call → executeTool() → WorldStateManager mutation
                                              │
                                    ┌──────────▼──────────┐
                                    │  GameEvent +        │
                                    │  ModuleRendererEvent │
                                    └──────────┬──────────┘
                                               │ IPC
                                    ┌──────────▼──────────┐
                                    │  Renderer receives   │
                                    │  and renders        │
                                    └─────────────────────┘
```

---

## 3. Agent Tools (Complete Reference)

**File:** `src/shared/actionApi.ts`

The action API is a registry of **60+ tools** agents can call. Each tool is both a callable function (internal use) and an Anthropic-compatible tool definition (for AI model consumption).

### Orchestrator-Only Tools

Five tools are restricted to agents with `isOrchestrator: true`:

| Tool | Purpose |
|------|---------|
| `give_turn` | Grant a turn to a specific agent |
| `end_round` | Advance to the next round |
| `pause_module` | Pause the module |
| `resume_module` | Resume the module |
| `create_entity` | Spawn a new entity in the world |

---

### Category: Query Tools

#### `get_world_state`

- **Who can use:** All
- **Parameters:** None (`{}`)
- **Returns:** `SerializedWorldState` — full world snapshot
- **Description:** Gets the complete current state of the world — all entities, map, and recent events.
- **Side effects:** None (read-only)

#### `get_entity`

- **Who can use:** All
- **Parameters:**
  - `id` (string, required) — Entity ID to look up
- **Returns:** `Entity` object or error if not found
- **Description:** Get detailed information about a specific entity.
- **Side effects:** None

#### `get_entities_by_type`

- **Who can use:** All
- **Parameters:**
  - `type` (string, required) — Entity type to filter by (e.g., `"player"`, `"enemy"`, `"item"`)
- **Returns:** Array of `Entity` objects matching the type (visible entities only)
- **Description:** Get all entities of a specific type.
- **Side effects:** None

#### `get_entities_nearby`

- **Who can use:** All
- **Parameters:**
  - `position` (object, required) — Center position: `{col, row}` for grid or `{x, y}` for freeform
  - `radius` (number, optional, default: 5) — Search radius in tiles or units
- **Returns:** Array of `Entity` objects within radius
- **Description:** Get all visible entities within a radius of a position.
- **Side effects:** None
- **Note:** Uses Manhattan distance for grid worlds, Euclidean for freeform

#### `get_tile`

- **Who can use:** All
- **Parameters:**
  - `col` (number, required) — Column number
  - `row` (number, required) — Row number
- **Returns:** `Tile` object or error if out of bounds or no grid
- **Description:** Get information about a specific tile in a grid world.
- **Side effects:** None
- **Validation:** Returns error if world has no grid or coordinates are out of bounds

#### `describe_scene`

- **Who can use:** All
- **Parameters:**
  - `radius` (number, optional, default: 5) — View radius
- **Returns:** Array of `Entity` objects near the agent's current entity position
- **Description:** Get a description of the area around the current entity.
- **Side effects:** None
- **Validation:** Returns error if agent has no `currentEntityPosition`

---

### Category: Entity Manipulation

#### `move_entity`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — ID of the entity to move
  - `position` (object, required) — Target: `{col, row}` for grid or `{x, y}` for freeform
  - `animate` (boolean, optional, default: `true`) — Whether to animate the movement
- **Returns:** `ActionResult` with `event: GameEvent` on success
- **Description:** Move an entity to a new position. The engine validates walkability for grid worlds.
- **Side effects:**
  - Emits `entity_moved` GameEvent to event history
  - Emits `entity_moved` ModuleRendererEvent (with `from`, `to`, `animate`)
  - Sets entity state to `'idle'`
- **Validation:** Fails if target tile is not walkable (grid worlds only)

#### `create_entity`

- **Who can use:** Orchestrator only
- **Parameters:**
  - `entity` (object, required) — Full Entity object with `id`, `type`, `name`, `position`, `spriteTag`, `properties`
- **Returns:** `ActionResult` with `event: GameEvent` on success
- **Description:** Create a new entity in the world.
- **Side effects:**
  - Emits `entity_created` GameEvent
  - Emits `entity_created` ModuleRendererEvent with the new entity
- **Validation:** Fails if entity ID already exists

#### `remove_entity`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — ID of the entity to remove
- **Returns:** `ActionResult` with `event: GameEvent` on success
- **Description:** Remove an entity from the world permanently.
- **Side effects:**
  - Emits `entity_removed` GameEvent
  - Emits `entity_removed` ModuleRendererEvent

#### `update_entity`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — ID of the entity to update
  - `updates` (object, required) — Partial Entity updates (state, properties, visible, facing, etc.)
- **Returns:** `ActionResult` on success
- **Description:** Update properties of an existing entity. Properties are deep-merged — only the keys you provide are changed.
- **Side effects:**
  - Emits `entity_state_changed` GameEvent if state is updated
  - Emits `entity_state_changed` ModuleRendererEvent if state is updated
- **Validation:** Deep-merges properties to avoid wiping unrelated keys

#### `damage_entity`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — ID of the entity to damage
  - `amount` (number, required) — Amount of damage to deal (positive number)
- **Returns:** `ActionResult` with `data: {hp: number, alive: boolean}` on success
- **Description:** Deal damage to an entity, reducing its HP.
- **Side effects:**
  - Emits `entity_damaged` GameEvent
  - Emits `entity_damaged` ModuleRendererEvent
  - If HP reaches 0: emits `entity_died` events, sets state to `'dead'`, keeps entity visible

#### `heal_entity`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — ID of the entity to heal
  - `amount` (number, optional, default: 0) — Amount of HP to restore
- **Returns:** `ActionResult` with `data: {hp: number}` on success
- **Description:** Heal an entity, restoring HP up to `maxHp`.
- **Side effects:**
  - Emits `entity_healed` GameEvent
  - Emits `entity_healed` ModuleRendererEvent

#### `kill_entity`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — ID of the entity to kill
- **Returns:** `ActionResult` with `event: GameEvent` on success
- **Description:** Instantly kill an entity (sets HP to 0, state to dead).
- **Side effects:**
  - Emits `entity_died` GameEvent
  - Emits `entity_died` ModuleRendererEvent
  - Sets `entity.properties['hp'] = 0`
  - Sets `entity.state = 'dead'`

#### `respawn_entity`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — ID of the entity to respawn (usually your own entityId)
  - `position` (object, required) — Spawn position: `{col, row}` for grid worlds
  - `hp` (number, required) — HP to restore on respawn (use your `maxHp`)
- **Returns:** `ActionResult` via `updateEntity` on success
- **Description:** Respawn an entity at a position with a specified HP.
- **Side effects:** Updates entity position to spawn position, state to `'idle'`, and `properties.hp` to specified value

#### `update_entity_property`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — ID of the entity
  - `key` (string, required) — The property key to update (e.g., `"hp"`, `"mana"`, `"poisoned"`)
  - `value` (unknown, required) — New value for the property
- **Returns:** `ActionResult` on success
- **Description:** Safely update a single key inside `entity.properties` without overwriting other properties. Prefer this over `update_entity` when only changing a single property.
- **Side effects:** None (does not emit events or notify listeners)
- **Validation:** Fails if entity not found

---

### Category: Visual & Animation

#### `set_entity_state`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — ID of the entity
  - `state` (string, required) — New state. Must be one of: `'idle'`, `'moving'`, `'attacking'`, `'casting'`, `'talking'`, `'dying'`, `'dead'`, `'hidden'`, `'stunned'`, `'flying'`
- **Returns:** `ActionResult` on success
- **Description:** Change an entity's visual/animation state.
- **Side effects:** Emits `entity_state_changed` ModuleRendererEvent

#### `trigger_animation`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — ID of the entity
  - `animType` (string, required) — Animation type to trigger
- **Returns:** `ActionResult` on success
- **Description:** Trigger a visual animation on an entity.
- **Side effects:** Pushes `entity_state_changed` event to rendererEvents with the `animType` as the state

#### `show_speech_bubble`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — ID of the entity to speak
  - `text` (string, required) — The speech text to display
  - `duration` (number, optional) — Duration in ms before auto-dismiss (default: 3000)
- **Returns:** `ActionResult` on success
- **Description:** Display a speech bubble above an entity for spectators to read.
- **Side effects:** Emits `speech` ModuleRendererEvent

#### `show_effect`

- **Who can use:** All
- **Parameters:**
  - `position` (object, required) — Position for the effect: `{col, row}` for grid or `{x, y}` for freeform
  - `effectTag` (string, required) — Effect tag from the assets (e.g., `"fire"`, `"sparkles"`, `"slash"`)
  - `duration` (number, optional) — Effect duration in ms
- **Returns:** `ActionResult` on success
- **Description:** Play a visual effect at a position (spell impact, explosion, magic, etc.).
- **Side effects:** Emits `effect` ModuleRendererEvent

---

### Category: World State

#### `set_tile`

- **Who can use:** All
- **Parameters:**
  - `col` (number, required) — Column of the tile to modify
  - `row` (number, required) — Row of the tile to modify
  - `updates` (object, required) — Tile properties to update: `walkable` (boolean), `type` (string), `spriteTag` (string)
- **Returns:** `ActionResult` with `event: GameEvent` on success
- **Description:** Modify a tile at runtime — change walkability, type, or spriteTag. Use to open doors, reveal traps, or change terrain.
- **Side effects:**
  - Emits `tile_changed` GameEvent
  - Emits `tile_changed` ModuleRendererEvent
- **Validation:** Fails if world has no grid or tile doesn't exist

#### `set_world_property`

- **Who can use:** All
- **Parameters:**
  - `key` (string, required) — Property name (e.g., `"phase"`, `"score"`, `"bossDefeated"`)
  - `value` (unknown, required) — Value to set (JSON-serializable)
- **Returns:** `ActionResult` on success
- **Description:** Set a global game-world property (phase, score, objective status, flags). Use to track global state not tied to an entity.
- **Side effects:**
  - Emits `world_property_set` GameEvent
  - Emits `world_property_set` ModuleRendererEvent

#### `get_world_properties`

- **Who can use:** All
- **Parameters:** None (`{}`)
- **Returns:** `Record<string, unknown>` — all global world properties
- **Description:** Get all global world properties (phase, score, flags, etc.).
- **Side effects:** None

---

### Category: Communication

#### `narrate`

- **Who can use:** All
- **Parameters:**
  - `text` (string, required) — The narration text to display prominently to all spectators
  - `style` (string, optional) — Narration style: `'dramatic'`, `'normal'`, `'shout'`, `'whisper'`
- **Returns:** `ActionResult` with `event: GameEvent` on success
- **Description:** Speak narration text that all spectators can read. Use for DM descriptions, dramatic moments, environmental storytelling.
- **Side effects:**
  - Emits `narration` GameEvent
  - Emits `narration` ModuleRendererEvent with style
  - Sets `gameEvent.narration` field

---

### Category: Entity Facing

#### `set_entity_facing`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — ID of the entity
  - `facing` (string, required) — Direction to face: `'left'`, `'right'`, `'up'`, `'down'`
- **Returns:** `ActionResult` on success
- **Description:** Set the direction an entity is facing. Affects sprite mirroring and combat orientation.
- **Side effects:** Emits `entity_facing_changed` ModuleRendererEvent

---

### Category: Orchestrator-Only

#### `give_turn`

- **Who can use:** Orchestrator only
- **Parameters:**
  - `agentRoleId` (string, required) — The agent role ID to give a turn to
- **Returns:** `ActionResult` on success
- **Description:** Grant a turn to a specific agent. Used in turn-based scheduling to control who acts next.
- **Side effects:** Pushes `OrchestratorAction {type: 'give_turn', toAgentId}` — the orchestrator processes this to unshift the target agent to the front of the pending turn queue

#### `end_round`

- **Who can use:** Orchestrator only
- **Parameters:** None (`{}`)
- **Returns:** `ActionResult` with `data: {tick: number}` on success
- **Description:** End the current round and advance to the next. Increments the tick counter.
- **Side effects:**
  - Increments tick via `worldState.incrementTick()`
  - Increments round counter
  - Emits `OrchestratorAction {type: 'end_round'}` — reinitializes turn queue for non-orchestrator agents
  - Emits `round_started` ModuleRendererEvent

#### `pause_module`

- **Who can use:** Orchestrator only
- **Parameters:** None (`{}`)
- **Returns:** `ActionResult` on success
- **Description:** Pause the module.
- **Side effects:** Pushes `OrchestratorAction {type: 'pause'}` — orchestrator calls `this.pause()` which sets `paused=true`, resets rate limiter, and sends `'paused'` status

#### `resume_module`

- **Who can use:** Orchestrator only
- **Parameters:** None (`{}`)
- **Returns:** `ActionResult` on success
- **Description:** Resume the module after a pause.
- **Side effects:** Pushes `OrchestratorAction {type: 'resume'}` — orchestrator calls `this.resume()` which sets `paused=false` and restarts the run loop

---

### Category: Camera & Screen Effects

#### `shake_camera`

- **Who can use:** All
- **Parameters:**
  - `intensity` (number, optional, default: 5) — Shake intensity from 1-10
  - `duration` (number, optional, default: 300) — Duration in milliseconds
- **Returns:** `ActionResult` on success
- **Description:** Shake the camera to create visual impact for hits, explosions, or dramatic moments.
- **Side effects:** Emits `camera_shake` ModuleRendererEvent with `intensity` and `duration`

#### `camera_follow`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — ID of the entity for the camera to follow
- **Returns:** `ActionResult` on success
- **Description:** Tell the camera to smoothly track a specific entity. Call this when an entity becomes the focus of attention (e.g., during combat or a dramatic reveal).
- **Side effects:** Emits `camera_follow` ModuleRendererEvent with `entityId`

#### `flash_screen`

- **Who can use:** All
- **Parameters:**
  - `color` (string, optional, default: `"#ffffff"`) — Hex color string (e.g., `"#ff0000"` for red)
  - `duration` (number, optional, default: 150) — Duration in milliseconds
- **Returns:** `ActionResult` on success
- **Description:** Flash the screen with a color for dramatic moments (hits, spell impacts, magic bursts, etc.).
- **Side effects:** Emits `screen_flash` ModuleRendererEvent with `color` and `duration`

---

### Category: Action Sequencing

#### `wait_for_animations`

- **Who can use:** All
- **Parameters:**
  - `timeout` (number, optional, default: 5000) — Maximum wait time in milliseconds
- **Returns:** `ActionResult` with `data: { waited: true }`
- **Description:** Pauses the agent's tool loop until all pending delayed events drain from the ActionSequencer. Use this between `move_entity` (with delay) and `damage_entity` to ensure the movement animation finishes before the hit lands visually. This is a sentinel tool — the orchestrator intercepts it and handles the actual wait.
- **Side effects:** Blocks the agent's tool-use loop until the ActionSequencer's pending queue is empty or the timeout expires

---

### Category: Timers

#### `create_timer`

- **Who can use:** All
- **Parameters:**
  - `id` (string, required) — Unique timer ID (e.g., `"poison_dot_warrior"`)
  - `name` (string, required) — Human-readable timer name
  - `delayTicks` (integer, optional) — Fire after this many game ticks
  - `delayMs` (integer, optional) — Fire after this many milliseconds
  - `recurring` (boolean, optional, default: `false`) — Re-schedule the timer after it fires
  - `intervalTicks` (integer, optional) — For recurring timers: fire every N ticks
  - `intervalMs` (integer, optional) — For recurring timers: fire every N milliseconds
  - `data` (object, optional) — Arbitrary payload (entityId, damage amount, etc.)
- **Returns:** `ActionResult` on success
- **Description:** Create a timer that fires after a delay. Use for poison damage-over-time, buff expiry, delayed traps, respawn timers. The DM is notified when the timer fires and decides the mechanical effect. Either `delayTicks` or `delayMs` must be provided.
- **Side effects:** Adds a `GameTimer` to world state. The timer's `createdBy` is set to the calling agent's role ID.
- **Validation:** Fails if neither `delayTicks` nor `delayMs` is provided

#### `cancel_timer`

- **Who can use:** All
- **Parameters:**
  - `timerId` (string, required) — ID of the timer to cancel
- **Returns:** `ActionResult` on success
- **Description:** Cancel an active timer by its ID, preventing it from firing.
- **Side effects:** Removes the timer from world state

#### `get_timers`

- **Who can use:** All
- **Parameters:** None (`{}`)
- **Returns:** Array of `GameTimer` objects
- **Description:** Get all active timers in the world. Useful for checking if a timer already exists before creating duplicates.
- **Side effects:** None (read-only)

---

### Category: Triggers

#### `create_trigger`

- **Who can use:** All
- **Parameters:**
  - `id` (string, required) — Unique trigger ID (e.g., `"trap_room_3"`)
  - `name` (string, required) — Human-readable trigger name
  - `shape` (string, required) — Zone shape: `"rect"` or `"circle"`
  - `col` (integer, optional) — Top-left column (for `rect` shape)
  - `row` (integer, optional) — Top-left row (for `rect` shape)
  - `width` (integer, optional) — Width in tiles (for `rect` shape)
  - `height` (integer, optional) — Height in tiles (for `rect` shape)
  - `centerCol` (integer, optional) — Center column (for `circle` shape)
  - `centerRow` (integer, optional) — Center row (for `circle` shape)
  - `radius` (number, optional) — Radius in tiles (for `circle` shape)
  - `fireOn` (string, optional, default: `"enter"`) — When to fire: `"enter"`, `"exit"`, or `"both"`
  - `oneShot` (boolean, optional, default: `false`) — Destroy the trigger after it fires once
  - `entityFilter` (string, optional) — Only trigger for entities of this type (e.g., `"player"`)
  - `data` (object, optional) — Payload sent to the DM when triggered
- **Returns:** `ActionResult` on success
- **Description:** Create a spatial trigger zone. When entities enter or exit the zone, the DM is notified. Use for traps, zone effects, proximity events, doors, and area-of-effect regions.
- **Side effects:** Adds a `TriggerZone` to world state. The trigger's `createdBy` is set to the calling agent's role ID, and it starts `active` with an empty `entitiesInside` list.

#### `remove_trigger`

- **Who can use:** All
- **Parameters:**
  - `triggerId` (string, required) — ID of the trigger to remove
- **Returns:** `ActionResult` on success
- **Description:** Remove a trigger zone from the world.
- **Side effects:** Removes the trigger from world state

#### `get_triggers`

- **Who can use:** All
- **Parameters:** None (`{}`)
- **Returns:** Array of `TriggerZone` objects
- **Description:** Get all active trigger zones in the world.
- **Side effects:** None (read-only)

---

### Category: Status Effects

#### `apply_status_effect`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — Entity to apply the effect to
  - `name` (string, required) — Effect name (e.g., `"Poisoned"`, `"Shield"`, `"Haste"`)
  - `durationTicks` (integer, optional) — Duration in game ticks
  - `durationMs` (integer, optional) — Duration in milliseconds
  - `permanent` (boolean, optional, default: `false`) — If true, the effect never expires
  - `properties` (object, optional) — Effect properties (e.g., `{ damage_per_tick: 5, armor_bonus: 3 }`)
  - `stackable` (boolean, optional, default: `false`) — Whether multiple instances can exist on the same entity
  - `icon` (string, optional) — Sprite tag for a visual indicator
- **Returns:** `ActionResult` on success
- **Description:** Apply a status effect (buff or debuff) to an entity. The DM is notified when effects expire. Use for poison, shields, haste, stuns, or any timed modifier. An auto-generated ID is assigned to the effect.
- **Side effects:** Adds a `StatusEffect` to world state. The effect's `source` is set to the calling agent's role ID and `appliedAt` is set to the current tick.

#### `remove_status_effect`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — Entity to remove the effect from
  - `effectName` (string, required) — Name of the effect to remove (matches the `name` field, not the auto-generated `id`)
- **Returns:** `ActionResult` on success
- **Description:** Remove a status effect from an entity by its name.
- **Side effects:** Removes the matching status effect from world state

#### `get_status_effects`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — Entity to query
- **Returns:** Array of `StatusEffect` objects
- **Description:** Get all active status effects on an entity.
- **Side effects:** None (read-only)

---

### Category: Inventory

#### `give_item`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — Entity to receive the item
  - `name` (string, required) — Item name (e.g., `"Health Potion"`, `"Iron Sword"`)
  - `type` (string, required) — Item type (e.g., `"weapon"`, `"potion"`, `"key"`, `"armor"`, `"misc"`)
  - `tags` (array, optional) — Array of string tags (e.g., `["healing", "consumable"]`)
  - `properties` (object, optional) — Item properties (e.g., `{ damage: 10, healAmount: 25 }`)
  - `stackable` (boolean, optional, default: `false`) — Whether the item can stack with others of the same name
  - `quantity` (integer, optional, default: 1) — Quantity to give
  - `spriteTag` (string, optional) — Sprite tag for the item's visual
- **Returns:** `ActionResult` on success
- **Description:** Give an item to an entity, creating it in their inventory. An auto-generated ID is assigned to the item. The item starts unequipped.
- **Side effects:** Adds an `Item` to the entity's inventory in world state

#### `remove_item`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — Entity to remove the item from
  - `itemId` (string, required) — ID of the item to remove
- **Returns:** `ActionResult` on success
- **Description:** Remove an item from an entity's inventory permanently.
- **Side effects:** Removes the item from world state

#### `get_inventory`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — Entity to query
- **Returns:** Array of `Item` objects
- **Description:** Get all items in an entity's inventory.
- **Side effects:** None (read-only)

#### `equip_item`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — Entity to equip
  - `itemId` (string, required) — ID of the item to equip
  - `slot` (string, required) — Equipment slot (e.g., `"mainhand"`, `"offhand"`, `"armor"`, `"accessory"`)
- **Returns:** `ActionResult` on success
- **Description:** Equip an item from inventory to a specific equipment slot.
- **Side effects:** Sets the item's `equipped` flag to `true` and records the slot in world state

#### `unequip_item`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — Entity to unequip
  - `itemId` (string, required) — ID of the item to unequip
- **Returns:** `ActionResult` on success
- **Description:** Unequip an item, returning it to the entity's inventory as an unequipped item.
- **Side effects:** Clears the item's `equipped` flag in world state

#### `transfer_item`

- **Who can use:** All
- **Parameters:**
  - `fromEntityId` (string, required) — Entity giving the item
  - `toEntityId` (string, required) — Entity receiving the item
  - `itemId` (string, required) — ID of the item to transfer
- **Returns:** `ActionResult` on success
- **Description:** Transfer an item from one entity to another. Use for loot drops, trading, pickpocketing, or quest item handoffs.
- **Side effects:** Removes the item from the source entity's inventory and adds it to the target entity's inventory

#### `use_item`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — Entity using the item
  - `itemId` (string, required) — ID of the item to use
  - `targetEntityId` (string, optional) — Target entity for the item effect (e.g., throwing a potion at an ally)
- **Returns:** `ActionResult` on success
- **Description:** Use or consume an item from inventory. Consumable items are removed after use. The DM decides the actual mechanical effect of using the item.
- **Side effects:** Processes the item use in world state; consumable items are removed from inventory

---

### Category: Groups

#### `create_group`

- **Who can use:** All
- **Parameters:**
  - `id` (string, required) — Group ID (e.g., `"party"`, `"enemies"`, `"undead"`)
  - `name` (string, required) — Display name for the group
  - `memberIds` (array, optional) — Array of entity IDs to add initially
  - `properties` (object, optional) — Group properties (e.g., `{ teamScore: 0, faction: "alliance" }`)
- **Returns:** `ActionResult` on success
- **Description:** Create a named entity group for batch operations, team tracking, or faction management.
- **Side effects:** Adds an `EntityGroup` to world state. The group's `createdBy` is set to the calling agent's role ID.

#### `add_to_group`

- **Who can use:** All
- **Parameters:**
  - `groupId` (string, required) — Group ID
  - `entityId` (string, required) — Entity ID to add
- **Returns:** `ActionResult` on success
- **Description:** Add an entity to an existing group.
- **Side effects:** Adds the entity ID to the group's `memberIds` in world state

#### `remove_from_group`

- **Who can use:** All
- **Parameters:**
  - `groupId` (string, required) — Group ID
  - `entityId` (string, required) — Entity ID to remove
- **Returns:** `ActionResult` on success
- **Description:** Remove an entity from a group.
- **Side effects:** Removes the entity ID from the group's `memberIds` in world state

#### `get_group`

- **Who can use:** All
- **Parameters:**
  - `groupId` (string, required) — Group ID to look up
- **Returns:** `EntityGroup` object or error if not found
- **Description:** Get a group by its ID, including all member IDs and properties.
- **Side effects:** None (read-only)

#### `get_groups`

- **Who can use:** All
- **Parameters:** None (`{}`)
- **Returns:** Array of `EntityGroup` objects
- **Description:** Get all groups in the world.
- **Side effects:** None (read-only)

#### `get_entity_groups`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — Entity ID to query
- **Returns:** Array of `EntityGroup` objects the entity belongs to
- **Description:** Get all groups that a specific entity is a member of.
- **Side effects:** None (read-only)

---

### Category: Pathfinding

#### `find_path`

- **Who can use:** All
- **Parameters:**
  - `fromCol` (integer, required) — Start column
  - `fromRow` (integer, required) — Start row
  - `toCol` (integer, required) — Target column
  - `toRow` (integer, required) — Target row
  - `maxDistance` (integer, optional, default: 100) — Maximum path length to search
  - `avoidEntities` (boolean, optional, default: `false`) — If true, treats tiles occupied by visible, alive entities as blocked
  - `diagonals` (boolean, optional, default: `false`) — Allow diagonal movement
- **Returns:** `ActionResult` with `data: { path: GridPosition[], distance: number }` on success
- **Description:** Find the shortest path between two grid positions using A* pathfinding. Returns the full path as an array of `{col, row}` positions. The agent decides whether to follow it by calling `move_entity` for each step.
- **Side effects:** None (read-only, does not move any entity)
- **Validation:** Requires a grid world. Returns error if no path is found or world has no grid.

#### `get_path_distance`

- **Who can use:** All
- **Parameters:**
  - `fromCol` (integer, required) — Start column
  - `fromRow` (integer, required) — Start row
  - `toCol` (integer, required) — Target column
  - `toRow` (integer, required) — Target row
- **Returns:** `ActionResult` with distance data
- **Description:** Get the shortest path distance between two grid positions without computing the full path. Faster than `find_path` when you only need the distance for decision-making.
- **Side effects:** None (read-only)
- **Validation:** Requires a grid world

---

### Category: State Machines

#### `create_state_machine`

- **Who can use:** All
- **Parameters:**
  - `id` (string, required) — Unique state machine ID (e.g., `"door_main"`, `"quest_progress"`)
  - `entityId` (string, optional) — Entity this state machine is tied to (omit for global state machines)
  - `initialState` (string, required) — Starting state name
  - `states` (array, required) — Array of all valid state names
  - `transitions` (object, optional) — Map of state name to array of valid target states (e.g., `{"locked": ["unlocked"], "unlocked": ["open", "locked"]}`)
  - `data` (object, optional) — Arbitrary data attached to the state machine
- **Returns:** `ActionResult` on success
- **Description:** Create a state machine with named states and valid transitions. The engine validates transitions at runtime. Use for doors (`locked -> unlocked -> open`), quest progress, combat phases, puzzle states, or any stateful game element.
- **Side effects:** Adds a `StateMachine` to world state. The machine's `createdBy` is set to the calling agent's role ID.

#### `transition_state`

- **Who can use:** All
- **Parameters:**
  - `machineId` (string, required) — State machine ID
  - `newState` (string, required) — Target state to transition to
- **Returns:** `ActionResult` on success
- **Description:** Transition a state machine to a new state. Fails if the transition is not listed in the machine's `transitions` map for the current state.
- **Side effects:** Updates the state machine's `currentState` in world state. Emits appropriate events via `WorldStateManager`.
- **Validation:** Fails if the transition is invalid (target state not in the allowed transitions list for the current state)

#### `get_state_machine`

- **Who can use:** All
- **Parameters:**
  - `machineId` (string, required) — State machine ID to look up
- **Returns:** `StateMachine` object or error if not found
- **Description:** Get a state machine's current state, valid states, transitions, and associated data.
- **Side effects:** None (read-only)

#### `get_state_machines`

- **Who can use:** All
- **Parameters:** None (`{}`)
- **Returns:** Array of `StateMachine` objects
- **Description:** Get all state machines in the world.
- **Side effects:** None (read-only)

---

### Category: Relationships

#### `create_relationship`

- **Who can use:** All
- **Parameters:**
  - `fromEntityId` (string, required) — Source entity ID
  - `toEntityId` (string, required) — Target entity ID
  - `type` (string, required) — Relationship type (e.g., `"owner"`, `"target"`, `"ally"`, `"enemy"`, `"summon_of"`, `"follower"`)
  - `bidirectional` (boolean, optional, default: `false`) — If true, the relationship applies in both directions (A is ally of B implies B is ally of A)
  - `properties` (object, optional) — Relationship properties (e.g., `{ trust: 0.8, since_round: 3 }`)
- **Returns:** `ActionResult` on success
- **Description:** Create a typed relationship between two entities. Use for tracking alliances, enmity, ownership, summons, followers, and any directed or undirected social/mechanical link.
- **Side effects:** Adds a `Relationship` to world state with an auto-generated ID. The relationship's `createdBy` is set to the calling agent's role ID.

#### `remove_relationship`

- **Who can use:** All
- **Parameters:**
  - `fromEntityId` (string, required) — Source entity ID
  - `toEntityId` (string, required) — Target entity ID
  - `type` (string, required) — Relationship type to remove
- **Returns:** `ActionResult` on success
- **Description:** Remove a specific relationship between two entities by type.
- **Side effects:** Removes the matching relationship from world state

#### `get_relationships`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — Entity to query
  - `type` (string, optional) — Filter by relationship type
- **Returns:** Array of `Relationship` objects
- **Description:** Get all relationships for an entity, optionally filtered by type. Returns relationships where the entity is either the source or target.
- **Side effects:** None (read-only)

#### `get_related_entities`

- **Who can use:** All
- **Parameters:**
  - `entityId` (string, required) — Entity to query
  - `type` (string, required) — Relationship type to filter by (e.g., `"ally"`, `"enemy"`)
- **Returns:** Array of `Entity` objects
- **Description:** Get all entities related to a given entity by a specific relationship type. Returns the full entity objects, not just IDs.
- **Side effects:** None (read-only)

---

### The `delay` Parameter

Several mutation tools accept an optional `delay` parameter (in milliseconds) that schedules the resulting event for future dispatch via the **ActionSequencer**. This enables agents to choreograph multi-step action sequences that play out visually over time rather than all at once.

**Tools that support `delay`:**

| Tool | What `delay` does |
|------|-------------------|
| `move_entity` | Delays the movement animation so previous actions can finish first |
| `damage_entity` | Delays the damage event so it visually lands after a movement or effect |
| `narrate` | Delays the narration text so it appears after preceding visual actions |

**How it works:**

1. When an agent calls a tool with `delay: 500`, the tool is intercepted by the ActionSequencer
2. The action is queued instead of executing immediately
3. After `delay` milliseconds, the action is executed and the resulting renderer event is dispatched
4. The agent can call `wait_for_animations` to block until all queued actions have drained

**Example — move then hit:**
```
move_entity({ entityId: "warrior-1", position: { col: 5, row: 3 }, delay: 0 })
damage_entity({ entityId: "goblin-1", amount: 15, delay: 600 })
narrate({ text: "The warrior strikes the goblin!", style: "dramatic", delay: 600 })
wait_for_animations({})
```

This ensures the warrior visually moves to position (5,3) first, then 600ms later the damage and narration appear simultaneously.

---

## 4. IPC Channels

**File:** `src/preload/index.ts`

IPC channels are bidirectional bridges between the main process (orchestrator) and the renderer (UI/canvas).

### Renderer → Main (invoke / send)

| Channel | Signature | Purpose |
|---------|-----------|---------|
| `module:list` | `invoke('module:list')` | List available modules from the `modules/` directory |
| `module:load` | `invoke('module:load', id)` | Load a module manifest and all its files |
| `module:start` | `invoke('module:start', defaults?)` | Start the orchestrator with optional AI defaults |
| `module:stop` | `send('module:stop')` | Stop the orchestrator and cleanup |
| `module:pause` | `send('module:pause')` | Pause the orchestrator loop |
| `module:resume` | `send('module:resume')` | Resume the orchestrator loop |
| `module:unload` | `send('module:unload')` | Unload current module without stopping |
| `module:scan-assets` | `invoke('module:scan-assets', moduleId, assetsPath)` | Scan assets folder, return tagged manifest |
| `module:bootstrap-questions` | `invoke('module:bootstrap-questions', scenarioPrompt, opts?)` | Get AI-generated clarifying questions for module design |
| `module:bootstrap` | `invoke('module:bootstrap', moduleId, prompt, opts?)` | AI-generate module config from scenario |
| `module:save` | `invoke('module:save', id, data)` | Save generated module to disk |
| `module:getConfig` | `invoke('module:getConfig', id)` | Load full module config (manifest + agents) for the settings dialog |
| `module:saveConfigChanges` | `invoke('module:saveConfigChanges', id, changes)` | Save manifest and agent config changes from the settings dialog |

### Main → Renderer (receive / on)

| Channel | Payload | Purpose |
|---------|---------|---------|
| `module:event` | `ModuleRendererEvent` | Game events: moves, animations, narration, effects |
| `module:state` | `SerializedWorldState` | Full world state sync (entities as array) |
| `module:agent-status` | `(roleId: string, status: AgentStatus)` | Per-agent status updates |
| `module:status` | `ModuleStatus` | Module lifecycle status: `'idle'`, `'loading'`, `'running'`, `'paused'`, `'stopped'` |
| `module:agent-log` | `AgentLogEntry` | Tool call logs: roleId, tool name, params, result, latency, tick |
| `module:stats` | `ModuleStats` | Periodic stats: round, requestCounts, consecutiveErrors, queueLength |

---

## 5. Module Structure

Modules are self-contained directories under `modules/<module-id>/`:

```
modules/<module-id>/
├── manifest.json    # Module metadata
├── world.json       # Initial world state: tick, entities, grid config
├── agents/          # One JSON per agent role
│   ├── dm.json      # orchestrator agent
│   ├── warrior.json
│   └── mage.json
└── assets/          # Optional art assets with tagged filenames
    ├── tiles/
    │   ├── grass.png               # tagged: ["floor", "outdoor"]
    │   └── wall_stone.png          # tagged: ["wall", "indoor"]
    ├── entities/
    │   ├── warrior.png             # tagged: ["player", "melee", "humanoid"]
    │   └── goblin.png             # tagged: ["enemy", "melee", "goblin"]
    └── effects/
        └── fireball.png           # tagged: ["spell", "fire", "animation"]
```

### Tag System

Assets are tagged by **filename**. Two formats are supported:

**Underscore-separated:**
```
warrior_player_humanoid.png → tags: ['warrior', 'player', 'humanoid']
```

**Explicit brackets:**
```
goblin[enemy,melee].png → tags: ['goblin', 'enemy', 'melee']
```

The asset registry maps each tag to an array of matching files. Resolve a tag to a texture path via `assetRegistry.getTexture(tag, category)`.

---

## 6. Module Manifest

**File:** `src/shared/types.ts` — `ModuleManifest` interface

```typescript
interface ModuleManifest {
  id: string                              // Unique slug identifier
  name: string                            // Display name
  description: string                     // 1-2 sentence description
  version?: string                         // Semver string (e.g., "1.0.0")
  author?: string                          // Module author
  worldType: 'grid' | 'freeform' | 'hybrid'  // World coordinate system
  scheduling: 'orchestrated' | 'round-robin' | 'free-for-all'  // Turn scheduling
  pacing: PacingConfig                    // Rate limiting configuration
  renderer: RendererConfig                 // Canvas configuration
  hasOrchestrator: boolean                 // True if scheduling is 'orchestrated'
  assets: string                          // Relative path to assets folder
  agents?: string                         // Relative path to agents folder
  world?: string                          // Relative path to world.json
  agentMemory?: number                    // Conversation rounds to retain per agent
}
```

### PacingConfig

```typescript
interface PacingConfig {
  burstWindowMs: number       // Sliding window duration in ms (default: 60000)
  burstCooldownMs: number     // Delay between turn cycles (default: 5000)
  maxRequestsPerAgent: number // Max requests per agent per burst window
  globalRpmLimit?: number     // Optional global RPM cap across all agents
}
```

### RendererConfig

```typescript
interface RendererConfig {
  canvasWidth: number         // Canvas width in pixels (e.g., 1440)
  canvasHeight: number        // Canvas height in pixels (e.g., 900)
  backgroundColor: number     // Hex color as integer (e.g., 657946)
  showGrid?: boolean          // Whether to show grid overlay
  gridSize?: number            // Grid cell size in pixels (e.g., 32 or 48)
  tileWidth?: number           // Override tile width
  tileHeight?: number          // Override tile height
}
```

### Example Manifest

```json
{
  "id": "agents-and-architects",
  "name": "Agents & Architects",
  "description": "A live D&D campaign where AI agents play as adventurers and a DM narrates the world.",
  "version": "1.0.0",
  "author": "Sands Studio",
  "worldType": "grid",
  "scheduling": "orchestrated",
  "pacing": {
    "burstWindowMs": 60000,
    "burstCooldownMs": 5000,
    "maxRequestsPerAgent": 20
  },
  "renderer": {
    "canvasWidth": 1440,
    "canvasHeight": 900,
    "backgroundColor": 657946,
    "showGrid": false,
    "gridSize": 48
  },
  "hasOrchestrator": true,
  "assets": "assets",
  "agents": "agents",
  "world": "world.json"
}
```

---

## 7. Agent Role Definition

**File:** `src/shared/types.ts` — `AgentRole` interface

```typescript
interface AgentRole {
  id: string                    // Unique role identifier (e.g., "warrior", "dm")
  name: string                  // Display name (e.g., "Sir Bramwell the Fighter")
  personality: string           // Character personality description for system prompt
  isOrchestrator: boolean        // True if this agent is the DM/narrator
  model: string                 // Model name (e.g., "claude-opus-4-6", "claude-sonnet-4-6")
  provider: AIProvider          // 'anthropic' | 'openai' | 'minimax' | 'openrouter' | 'custom'
  baseURL?: string             // Custom API endpoint (required for non-anthropic providers)
  apiKey?: string              // Provider API key (can be omitted if set via environment)
  systemPromptTemplate: string  // System prompt with template placeholders
  tools: string[]               // Array of tool names this agent can call
  entityId?: string             // ID of the entity this agent controls (for non-orchestrators)
}

type AIProvider = 'anthropic' | 'openai' | 'minimax' | 'openrouter' | 'custom'
```

### System Prompt Template Placeholders

The orchestrator substitutes the following placeholders at runtime:

| Placeholder | Replaced With |
|-------------|---------------|
| `{{worldState}}` | JSON summary of current tick, round, entities with positions/states/hp |
| `{{recentEvents}}` | Last 20 GameEvents as JSON array |
| `{{role}}` | Agent's display name |
| `{{name}}` | Agent's display name (alias for `{{role}}`) |
| `{{personality}}` | Agent's personality string |
| `{{entityId}}` | The agent's controlled entity ID |
| `{{spawnPosition}}` | JSON position object of entity's initial spawn |
| `{{myHp}}` | Current HP of agent's entity |
| `{{myState}}` | Current state of agent's entity |
| `{{wins}}` | Win count stored in entity properties |

### Example Agent Role (DM)

```json
{
  "id": "dm",
  "name": "The Dungeon Master",
  "personality": "An experienced dungeon master with a flair for dramatic storytelling...",
  "isOrchestrator": true,
  "model": "claude-opus-4-6",
  "provider": "anthropic",
  "systemPromptTemplate": "You are {{name}}, the Dungeon Master...\n{{worldState}}\n{{recentEvents}}",
  "tools": [
    "narrate",
    "get_world_state",
    "get_entity",
    "get_entities_nearby",
    "describe_scene",
    "move_entity",
    "damage_entity",
    "heal_entity",
    "kill_entity",
    "create_entity",
    "remove_entity",
    "update_entity",
    "set_entity_state",
    "show_effect",
    "give_turn",
    "end_round",
    "set_tile",
    "set_world_property",
    "get_world_properties",
    "update_entity_property",
    "set_entity_facing"
  ],
  "entityId": null
}
```

---

## 8. Scheduling Modes

**File:** `src/shared/types.ts` — `SchedulingMode` type

```typescript
type SchedulingMode = 'orchestrated' | 'round-robin' | 'free-for-all'
```

### `orchestrated` (D&D-style)

- One agent is marked `isOrchestrator: true` (the DM/narrator)
- The DM acts first to set the scene and narrate
- The DM uses `give_turn` to grant turns to specific agents
- The DM uses `end_round` to advance time
- Queue re-fills after `burstCooldownMs`
- **Example:** `agents-and-architects` — DM + 3 adventurers in a dungeon crawl

### `round-robin`

- Fixed turn order through all agents
- Agents are queued in the order they appear in the agents/ directory
- When queue empties, round increments and queue resets immediately (no cooldown)
- No orchestrator — agents take turns in sequence
- **Example:** Competitive games with sequential turns

### `free-for-all`

- All agents act simultaneously (or near-simultaneously via queue cycling)
- No orchestrator — peer agents fight/compete without a narrator
- Queue re-fills after `burstCooldownMs`
- **Example:** `monster-battler` — creatures spawn, fight, and evolve autonomously

---

## 9. Rate Limiting

**File:** `src/main/module-engine/orchestrator.ts` — `RateLimiter` class

### Algorithm

The `RateLimiter` uses a **sliding window** (60-second window) per agent:

```typescript
class RateLimiter {
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
```

### Behavior

- Each agent has their own sliding window counter
- When `maxRequestsPerAgent` is exhausted within the burst window, the agent is re-queued for later
- When the module is paused or resumed, all rate limiter windows are reset
- Global RPM limit (if specified in pacing) sums all agent request counts
- After the turn queue empties in `free-for-all`/`orchestrated` modes, the orchestrator waits `burstCooldownMs` before re-queuing all agents
- In `round-robin` mode, rounds advance immediately without cooldown

---

## 10. World State Manager

**File:** `src/shared/WorldState.ts`

`WorldStateManager` is the **single source of truth** for the running module's world. All agent mutations flow through it.

### State Structure

```typescript
interface WorldState {
  tick: number
  entities: Record<string, Entity>
  worldType: WorldType                      // 'grid' | 'freeform' | 'hybrid'
  grid?: GridWorld                          // Grid data (only for grid/hybrid)
  freeform?: FreeformWorld                  // Freeform bounds (only for freeform/hybrid)
  events: GameEvent[]                       // Recent event history (max 100)
  round?: number                            // Current round number
  properties?: Record<string, unknown>      // Global world properties
}
```

### Entity Interface

```typescript
interface Entity {
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

type EntityState =
  | 'idle' | 'moving' | 'attacking' | 'casting' | 'talking'
  | 'dying' | 'dead' | 'hidden' | 'stunned' | 'flying'
```

### Grid World Interface

```typescript
interface GridWorld {
  width: number; height: number
  tiles: Tile[][]
  tileWidth: number; tileHeight: number
}

interface Tile {
  col: number; row: number
  type: string
  spriteTag: string
  walkable: boolean
  properties: Record<string, unknown>
}
```

### Serialization

`getSerialized()` converts the internal entity map to an array for IPC:

```typescript
interface SerializedWorldState {
  tick: number
  entities: Entity[]              // Converted from Record<string, Entity>
  worldType: WorldType
  grid?: GridWorld
  freeform?: FreeformWorld
  events: GameEvent[]             // Max 100 (trimmed)
  round?: number
  properties: Record<string, unknown>
}
```

### Key Methods

**Queries (read-only):**
- `getEntity(id)` — Get single entity or undefined
- `getEntities()` — Get all entities as Record
- `getEntitiesByType(type)` — Filter visible entities by type
- `getEntitiesAt(position)` — Find entities at exact position
- `getTile(col, row)` — Get tile at grid coordinates (with bounds check)
- `getNearbyEntities(position, radius)` — Entities within radius
- `getRecentEvents(count)` — Last N events (default 20)
- `getTick()` / `getRound()` — Current tick/round
- `getWorldProperties()` — Global properties map
- `getSerialized()` — Full state for IPC (entities as array)

**Entity Mutations:**
- `moveEntity(id, newPos, animate?, fromAgent?)` — Move with optional grid walkability check
- `damageEntity(id, amount, source)` — Deal damage, auto-kill at 0 HP
- `healEntity(id, amount)` — Restore HP up to maxHp
- `killEntity(id, fromAgent?)` — Instant kill (HP=0, state='dead')
- `createEntity(entity, fromAgent?)` — Add new entity
- `removeEntity(id, fromAgent?)` — Remove entity permanently
- `updateEntity(id, updates, fromAgent?)` — Partial update with deep-merge on properties
- `setEntityState(id, state)` — Change animation state
- `setEntityFacing(id, facing)` — Set direction

**World Mutations:**
- `setTile(col, row, updates, fromAgent?)` — Modify tile properties
- `setWorldProperty(key, value, fromAgent?)` — Set global property

**Communication:**
- `narrate(text, fromAgent?, style?)` — Emit narration event

**Tick/Round:**
- `incrementTick()` — Advance tick counter
- `setRound(round)` — Set round number (emits `round_started`)

**Renderer Events:**
- `pushRendererEvent(event)` — Queue a ModuleRendererEvent
- `drainRendererEvents()` — Flush all queued renderer events (returns array, clears queue)

**Change Tracking:**
- `onChange(listener)` — Subscribe to state changes (returns unsubscribe function)

---

## 11. Multi-Provider AI

**File:** `src/main/module-engine/agent-pool.ts`

`AgentPool` manages per-role AI client instances. Each client implements the `AIProviderClient` interface:

```typescript
interface AIProviderClient {
  name: string
  provider: AIProvider
  model: string
  baseURL: string

  createMessage(params: {
    model: string
    system: string
    messages: Anthropic.MessageParam[]
    tools: Anthropic.Tool[]
    maxTokens?: number
  }): Promise<{
    content: Anthropic.ContentBlock[]
    stopReason: string
    usage?: { inputTokens: number; outputTokens: number }
  }>
}
```

### Provider Implementations

**AnthropicProvider:**
- Uses `@anthropic-ai/sdk` directly
- Calls `/v1/messages` endpoint
- Supports Claude-specific features

**OpenAICompatibleProvider:**
- Uses `fetch` with OpenAI-compatible `/chat/completions` endpoint
- Converts Anthropic format ↔ OpenAI format bidirectionally
- Handles tool_calls conversion
- Supports MiniMax, OpenRouter, OpenAI, and any custom OpenAI-compatible API

### Provider Configuration

| Provider | Default Endpoint | API Key Env Var |
|----------|-------------------|-----------------|
| `anthropic` | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| `minimax` | `https://api.minimax.chat/v1` | — |
| `openrouter` | `https://openrouter.ai/api/v1` | — |
| `openai` | `https://api.openai.com/v1` | — |
| `custom` | User-specified `baseURL` | — |

### API Key Resolution

Priority order (first found wins):
1. `role.apiKey` (from agent JSON)
2. `process.env.ANTHROPIC_API_KEY` (for anthropic provider only)
3. `defaults.apiKey` (from orchestrator config)
4. Throws error if none found

---

## 12. Quick Reference

### Tool by Category

| Category | Tools |
|----------|-------|
| **Query** | `get_world_state`, `get_entity`, `get_entities_by_type`, `get_entities_nearby`, `get_tile`, `describe_scene` |
| **Entity** | `move_entity`, `create_entity`, `remove_entity`, `update_entity`, `damage_entity`, `heal_entity`, `kill_entity`, `respawn_entity`, `update_entity_property` |
| **Visual** | `set_entity_state`, `trigger_animation`, `show_speech_bubble`, `show_effect` |
| **World** | `set_tile`, `set_world_property`, `get_world_properties` |
| **Communication** | `narrate` |
| **Orchestrator** | `give_turn`, `end_round`, `pause_module`, `resume_module` |
| **Facing** | `set_entity_facing` |
| **Camera** | `shake_camera`, `camera_follow`, `flash_screen` |
| **Sequencing** | `wait_for_animations` |
| **Timers** | `create_timer`, `cancel_timer`, `get_timers` |
| **Triggers** | `create_trigger`, `remove_trigger`, `get_triggers` |
| **Status Effects** | `apply_status_effect`, `remove_status_effect`, `get_status_effects` |
| **Inventory** | `give_item`, `remove_item`, `get_inventory`, `equip_item`, `unequip_item`, `transfer_item`, `use_item` |
| **Groups** | `create_group`, `add_to_group`, `remove_from_group`, `get_group`, `get_groups`, `get_entity_groups` |
| **Pathfinding** | `find_path`, `get_path_distance` |
| **State Machines** | `create_state_machine`, `transition_state`, `get_state_machine`, `get_state_machines` |
| **Relationships** | `create_relationship`, `remove_relationship`, `get_relationships`, `get_related_entities` |

### Common Tool Patterns

**Check what's around you:**
```
get_entities_nearby({ position: { col: 5, row: 3 }, radius: 5 })
describe_scene({ radius: 5 })
```

**Move and attack:**
```
move_entity({ entityId: "goblin-1", position: { col: 6, row: 3 }, animate: true })
damage_entity({ entityId: "warrior-1", amount: 15 })
```

**DM narration:**
```
narrate({ text: "The goblin snarls and lunges at the warrior!", style: "dramatic" })
```

**Create and spawn:**
```
create_entity({ entity: { id: "goblin-scout", type: "enemy", name: "Goblin Scout", position: { col: 10, row: 5 }, spriteTag: "goblin", properties: { hp: 20, maxHp: 20 } } })
set_entity_state({ entityId: "goblin-scout", state: "idle" })
```

**Track game state:**
```
set_world_property({ key: "bossDefeated", value: true })
set_world_property({ key: "score", value: 150 })
```

**Change terrain:**
```
set_tile({ col: 5, row: 3, updates: { walkable: true, spriteTag: "open_door" } })
```

**Inventory management:**
```
give_item({ entityId: "warrior-1", name: "Health Potion", type: "potion", properties: { healAmount: 25 }, stackable: true })
equip_item({ entityId: "warrior-1", itemId: "item_abc123", slot: "mainhand" })
use_item({ entityId: "warrior-1", itemId: "item_abc123", targetEntityId: "mage-1" })
transfer_item({ fromEntityId: "goblin-1", toEntityId: "warrior-1", itemId: "item_xyz789" })
```

**Status effects:**
```
apply_status_effect({ entityId: "warrior-1", name: "Poisoned", durationTicks: 5, properties: { damage_per_tick: 3 } })
remove_status_effect({ entityId: "warrior-1", effectName: "Poisoned" })
```

**Groups and relationships:**
```
create_group({ id: "party", name: "The Party", memberIds: ["warrior-1", "mage-1"] })
create_relationship({ fromEntityId: "warrior-1", toEntityId: "mage-1", type: "ally", bidirectional: true })
```

**Pathfinding:**
```
find_path({ fromCol: 2, fromRow: 3, toCol: 8, toRow: 7, avoidEntities: true })
get_path_distance({ fromCol: 2, fromRow: 3, toCol: 8, toRow: 7 })
```

**State machines:**
```
create_state_machine({ id: "door_main", initialState: "locked", states: ["locked", "unlocked", "open"], transitions: { "locked": ["unlocked"], "unlocked": ["open", "locked"] } })
transition_state({ machineId: "door_main", newState: "unlocked" })
```

**Timers and triggers:**
```
create_timer({ id: "respawn_goblin", name: "Goblin Respawn", delayTicks: 3, data: { entityType: "goblin" } })
create_trigger({ id: "trap_hall", name: "Hall Trap", shape: "rect", col: 4, row: 2, width: 3, height: 1, fireOn: "enter", oneShot: true })
```

**Camera effects:**
```
shake_camera({ intensity: 8, duration: 500 })
flash_screen({ color: "#ff0000", duration: 200 })
camera_follow({ entityId: "warrior-1" })
```

### Module Lifecycle

```
module:list → module:load → module:start → [running] → module:stop
                                    ↑
                              module:pause ↔ module:resume
```

### Agent Turn Flow

```
1. Orchestrator selects next agent from queue
2. Build system prompt with template substitutions
3. AI client.createMessage() with tools
4. For each tool_use block in response:
   a. executeTool() → WorldStateManager mutation
   b. Send AgentLogEntry via IPC
   c. Return tool_result to AI client
5. Continue until stop_reason != 'tool_use' or MAX_TOOL_ROUNDS (10)
6. Drain renderer events and send to renderer
7. Handle orchestrator actions (give_turn, end_round, pause, resume)
8. Sync world state to renderer
9. Re-queue agent if not done (non-round-robin)
```

---

## 13. Module Settings Dialog

The **Module Settings Dialog** provides a GUI for editing all module configuration without hand-editing JSON files. It is accessible via the **gear icon** that appears next to each module in the Modules dropdown menu.

### How to Access

1. Click the **Modules** menu in the top menu bar
2. Hover over any listed module
3. Click the **gear icon** that appears next to the module name
4. The settings dialog opens as a modal overlay

### What Can Be Edited

#### Manifest Settings

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name for the module |
| `description` | string | 1-2 sentence description |
| `scheduling` | select | Scheduling mode: `orchestrated`, `round-robin`, `free-for-all` |
| `worldType` | select | Coordinate system: `grid`, `freeform`, `hybrid` |
| `hasOrchestrator` | boolean | Whether one agent is the orchestrator/DM |

#### Pacing Settings

| Field | Type | Description |
|-------|------|-------------|
| `burstWindowMs` | number | Sliding window duration in ms (e.g., 60000) |
| `burstCooldownMs` | number | Delay between turn cycles in ms (e.g., 5000) |
| `maxRequestsPerAgent` | number | Max requests per agent per burst window |
| `globalRpmLimit` | number | Optional global RPM cap across all agents |

#### Renderer Settings

| Field | Type | Description |
|-------|------|-------------|
| `canvasWidth` | number | Canvas width in pixels |
| `canvasHeight` | number | Canvas height in pixels |
| `backgroundColor` | number | Background color as hex integer |
| `showGrid` | boolean | Whether to show grid overlay |
| `gridSize` | number | Grid cell size in pixels |

#### Agent Configuration

For each agent in the module, the following fields can be edited:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Agent display name |
| `personality` | textarea | Character personality and behavior description |
| `systemPromptTemplate` | textarea | Full system prompt with `{{placeholder}}` support |
| `tools` | multi-select | Which tools this agent can call |
| `model` | string | AI model name (e.g., `claude-sonnet-4-6`) |
| `provider` | select | AI provider: `anthropic`, `openai`, `minimax`, `openrouter`, `custom` |
| `baseURL` | string | Custom API endpoint (for non-anthropic providers) |
| `apiKey` | string | Provider API key override |
| `isOrchestrator` | boolean | Whether this agent is the DM/narrator |

### IPC Channels Used

The settings dialog communicates with the main process via two IPC channels:

- **`module:getConfig`** — Invoked when the dialog opens. Returns the full module configuration including the parsed manifest and all agent role definitions.
- **`module:saveConfigChanges`** — Invoked when the user clicks Save. Sends the updated manifest and agent configs back to the main process, which writes them to the module's JSON files on disk.

### Notes

- Changes are saved to the module's files on disk (`manifest.json` and individual agent JSON files in `agents/`)
- Changes take effect the next time the module is loaded — they do not affect a currently running module
- The dialog validates required fields before allowing save
- Model and provider overrides allow mixing AI providers within a single module (e.g., Claude for the DM, MiniMax for creature agents)
