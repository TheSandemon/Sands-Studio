# Module Asset Guide

Modules are self-contained game scenarios. They live in `modules/<module-id>/` and contain all the configuration, agent definitions, and art assets needed to run a scenario.

## Folder Structure

```
modules/<module-id>/
├── manifest.json       # Module metadata, pacing, renderer config
├── world.json          # Initial world state: entities, grid/map config
├── agents/             # One JSON file per AI agent role
│   ├── dm.json         # Optional DM/orchestrator role
│   ├── warrior.json
│   └── mage.json
└── assets/             # Optional art assets
    ├── tiles/          # Floor, walls, terrain
    ├── entities/       # Creatures, characters, items
    └── effects/        # Spell effects, explosions, particles
```

**Minimum required:** `manifest.json` + `world.json`. Assets are optional — the renderer will use tagged sprite fallbacks if assets aren't provided.

---

## Tagging System

Assets are referenced by **semantic tags**, not filenames. The engine resolves tags to actual image files. This makes modules art-swappable — as long as the right tags are present, any image works.

### Default Tagging (recommended)

Split the filename on underscores. Each segment becomes a tag.

```
assets/entities/warrior_player_humanoid.png
  → tags: ["warrior", "player", "humanoid"]

assets/tiles/grass_floor_outdoor.png
  → tags: ["grass", "floor", "outdoor"]

assets/effects/fireball_spell_fire.png
  → tags: ["fireball", "spell", "fire"]
```

### Explicit Tagging

Use square brackets to list exact tags. Useful when the filename doesn't split cleanly.

```
assets/entities/goblin[enemy,melee,goblin].png
  → tags: ["enemy", "melee", "goblin"]

assets/tiles/dungeon_floor[dungeon,floor,indoor].png
  → tags: ["dungeon", "floor", "indoor"]
```

When explicit tags are present, the bracket content replaces the default underscore split. Without brackets, the file is processed with default tagging.

### Supported Formats

- `.png` (recommended for sprites with transparency)
- `.jpg` / `.jpeg` (photos, textures)
- `.gif` (animated sprites)

### Tag Categories

**Tiles** (`assets/tiles/`):
- Terrain: `grass`, `stone`, `dirt`, `sand`, `water`, `ice`
- Floor types: `floor`, `wood_floor`, `carpet`
- Walls: `wall`, `brick`, `stone_wall`
- Doors: `door`, `open_door`, `closed_door`
- Special: `pit`, `lava`, `void`

**Entities** (`assets/entities/`):
- Alignment: `player`, `enemy`, `ally`, `neutral`
- Type: `humanoid`, `beast`, `dragon`, `undead`, `elemental`, `construct`
- Role: `warrior`, `mage`, `rogue`, `archer`, `healer`
- Faction: `knight`, `goblin`, `skeleton`, `spirit`

**Effects** (`assets/effects/`):
- Elements: `fire`, `ice`, `lightning`, `poison`, `holy`, `dark`
- Type: `spell`, `melee`, `ranged`, `aoe`, `buff`, `debuff`
- Style: `explosion`, `slash`, `sparkles`, `smoke`, `beam`

### Resolution Precedence

When multiple assets share a tag, the **first match** in filesystem scan order is used. To control which asset is chosen:

```
assets/entities/goblin_leader.png   ← used for "goblin" tag
assets/entities/goblin_basic.png
```

The scanner processes directories alphabetically, then files within each directory. Name your preferred asset first alphabetically if you need determinism.

---

## Creating a Module

### Step 1: Create the Directory

```bash
mkdir modules/my-module
mkdir modules/my-module/agents
mkdir modules/my-module/assets/tiles
mkdir modules/my-module/assets/entities
mkdir modules/my-module/assets/effects
```

### Step 2: Write `manifest.json`

```json
{
  "id": "my-module",
  "name": "My Module",
  "description": "What happens in this module",
  "worldType": "grid",
  "scheduling": "free-for-all",
  "pacing": {
    "burstWindowMs": 30000,
    "burstCooldownMs": 2000,
    "maxRequestsPerAgent": 50
  },
  "renderer": {
    "canvasWidth": 1440,
    "canvasHeight": 900,
    "backgroundColor": 1118481,
    "showGrid": true,
    "gridSize": 32
  },
  "hasOrchestrator": false,
  "assets": "assets",
  "agents": "agents",
  "world": "world.json"
}
```

**Key manifest fields:**

| Field | Values | Notes |
|-------|--------|-------|
| `worldType` | `"grid"` / `"freeform"` / `"hybrid"` | Grid uses tiles; freeform uses x/y positions |
| `scheduling` | `"orchestrated"` / `"round-robin"` / `"free-for-all"` | How agents take turns |
| `hasOrchestrator` | `true` / `false` | DM role present in agents/ |
| `burstCooldownMs` | milliseconds | Pause between free-for-all rounds |
| `maxRequestsPerAgent` | number | LLM rate limit per agent per minute |

### Step 3: Write `world.json`

Defines the starting state of the world: grid size, initial entities, and their positions.

```json
{
  "tick": 0,
  "entities": {
    "entity-warrior-1": {
      "id": "entity-warrior-1",
      "type": "warrior",
      "name": "Ragnar",
      "position": { "col": 3, "row": 2 },
      "spriteTag": "warrior",
      "state": "idle",
      "visible": true,
      "properties": { "hp": 100, "maxHp": 100, "attack": 15 }
    }
  },
  "worldType": "grid",
  "grid": {
    "width": 20,
    "height": 15,
    "tileWidth": 32,
    "tileHeight": 32,
    "tiles": [
      [{ "col": 0, "row": 0, "type": "grass", "spriteTag": "grass", "walkable": true, "properties": {} }]
    ]
  },
  "events": [],
  "round": 0
}
```

### Step 4: Write Agent Definitions

Each file in `agents/` is one AI-controlled role.

**Agent JSON Schema Rule:**
> **Do NOT include `model`, `provider`, `baseURL`, or `apiKey` in agent JSON files.** These are injected at runtime from the global settings in **Settings → Agent tab**. Including them overrides user settings and makes modules fragile. Only include module-specific fields: `id`, `name`, `personality`, `isOrchestrator`, `systemPromptTemplate`, `tools`, and `entityId`.

**`agents/warrior.json`:**

```json
{
  "id": "warrior",
  "name": "Ragnar the Warrior",
  "personality": "Fierce and direct, prefers melee combat over tactics.",
  "isOrchestrator": false,
  "systemPromptTemplate": "You are {{role}}. Your goal is to defeat all enemies.\n{{worldState}}\n{{recentEvents}}",
  "tools": [
    "get_world_state", "get_entities_nearby", "move_entity",
    "damage_entity", "set_entity_state", "show_speech_bubble",
    "wait_for_animations", "get_inventory", "equip_item", "use_item",
    "get_status_effects", "find_path", "get_entity_groups"
  ],
  "entityId": "entity-warrior-1"
}
```

**Orchestrated modules** need a DM role:

**`agents/dm.json`:**

```json
{
  "id": "dm",
  "name": "Dungeon Master",
  "personality": "You are the game master. You control NPCs, narrate events, and guide the story.",
  "isOrchestrator": true,
  "systemPromptTemplate": "You are the DM. Narrate the world.\n{{worldState}}\n{{recentEvents}}",
  "tools": [
    "get_world_state", "get_entity", "get_entities_nearby",
    "move_entity", "create_entity", "damage_entity",
    "narrate", "give_turn", "end_round",
    "show_speech_bubble", "show_effect", "set_tile",
    "wait_for_animations",
    "create_timer", "cancel_timer", "get_timers",
    "create_trigger", "remove_trigger", "get_triggers",
    "apply_status_effect", "remove_status_effect", "get_status_effects",
    "give_item", "get_inventory", "equip_item", "use_item",
    "create_group", "add_to_group",
    "find_path", "create_state_machine", "transition_state",
    "create_relationship", "get_relationships"
  ]
}
```

### Step 5: Add Assets (optional)

```
modules/my-module/assets/
├── tiles/
│   ├── grass.png              → tagged: grass, floor, outdoor
│   └── stone_wall.png         → tagged: stone, wall, indoor
├── entities/
│   ├── warrior_player.png      → tagged: warrior, player, humanoid
│   └── goblin_enemy.png       → tagged: goblin, enemy, melee
└── effects/
    └── fireball_spell.png      → tagged: fireball, spell, fire
```

The engine builds the asset registry automatically. To verify which tags are registered, use the **Bootstrap Agent** in the app's module creation UI, or check the browser console when loading a module.

---

## Scheduling Modes

### `free-for-all` (recommended for combat arenas)
All agents act simultaneously. Each agent fires its LLM call in parallel, all actions are batched, then applied together. Best for peer-agent battle scenarios where no single coordinator is needed.

### `orchestrated` (D&D-style)
A DM/orchestrator agent decides who acts and when. The DM role uses `give_turn` to grant turns to specific agents, and `end_round` to advance the round.

### `round-robin`
Fixed turn order cycling through all agents. The orchestrator does NOT give turns — agents act in the order defined in `agents/`.

---

## Visual Gameplay Conventions

For a module to look good live, agents must produce **visible actions** — not just text. Spectators watch sprites move, HP bars change, and effects play. Narration and dialogue are the commentary, but movement and combat effects are what they *see*.

### Orchestrator (DM) agents
- `narrate()` every 1-2 turns — describe what's happening on screen
- `spawn_entity` or `move_entity` to show action, not just describe it
- After `damage_entity`, call `narrate()` to describe the impact
- Use `give_turn()` to pass control to player agents
- Use `end_round()` every 3-5 turns to advance time
- Call `show_effect()` for spell impacts, explosions, and dramatic moments
- Call `shake_camera()` for big hits and dramatic reveals
- Use `create_timer()` to schedule delayed events (poison, spawn waves)
- Use `apply_status_effect()` for visual buffs/debuffs on entities
- Use `wait_for_animations()` after sequenced actions with `delay` params

### Player/peer agents
- Always call `move_entity()` **before** `narrate()` — show, don't just tell
- Use `show_speech_bubble()` with short text (under 10 words)
- After dealing damage, call `narrate()` to describe the outcome
- Keep it punchy — spectators are reading live

### Visual priority
1. **Movement** — shows action happening (highest value to spectators)
2. **Combat effects** — damage flashes, heal pulses, HP bar changes
3. **Speech bubbles** — character personality and live reactions
4. **Narration** — context, drama, and scene-setting

### Camera
Camera auto-follows the active entity on `give_turn`. Agents can call `shake_camera()` for impact moments and `flash_screen()` for dramatic reveals.

### Animation system
The renderer handles animations automatically:
- Entity movement tweens over 400ms with easeOutQuad
- HP bars interpolate over 300ms (no snapping)
- Spawn animation: scale 0→1 with bounce ease over 200ms
- Death animation: fade to 50% + scale to 0.8 over 400ms, then remove
- Free-for-all batch moves stagger by 50ms per entity

---

## Entity Properties

Entities can carry arbitrary properties used by agents for game logic:

| Property | Type | Usage |
|----------|------|-------|
| `hp` | number | Current health |
| `maxHp` | number | Maximum health |
| `attack` | number | Damage dealt |
| `defense` | number | Damage reduction |
| `speed` | number | Turn order priority |
| `wins` | number | Survival win counter (monster-battler) |
| `kills` | number | Death count |

Properties are accessed in agent prompts via `{{myHp}}`, `{{myState}}`, etc.

---

## Game Primitives

The engine provides 9 subsystems that agents can use as building blocks for complex gameplay. These are all available as agent tools — just add them to an agent's `tools` array.

### Action Sequencing
Use the `delay` parameter on mutation tools (`move_entity`, `damage_entity`, `show_effect`, etc.) to stagger actions over time. Call `wait_for_animations()` to block until all pending animations complete before continuing. This enables cinematic multi-step sequences.

### Timers
Schedule recurring or one-shot events with `create_timer`. Timers fire callbacks at specified intervals (e.g., poison damage every 3 seconds, spawn waves every 30 seconds). Cancel with `cancel_timer`, list active timers with `get_timers`.

### Triggers / Areas
Define spatial zones on the grid that fire when entities enter or exit them using `create_trigger`. Useful for traps, doorways, quest zones, and ambush areas. Remove with `remove_trigger`, inspect with `get_triggers`.

### Status Effects
Apply buffs and debuffs with durations via `apply_status_effect`. Effects have a name, duration, and arbitrary properties (e.g., `{ "name": "poisoned", "duration": 3, "damagePerTick": 5 }`). Query with `get_status_effects`, remove early with `remove_status_effect`.

### Inventory
Give structured items to entities with `give_item`. Items can be equipped (`equip_item`) or consumed (`use_item`). Query an entity's inventory with `get_inventory`. Items support arbitrary properties like damage, armor, healing amount, etc.

### Groups / Teams
Create named entity groupings with `create_group` and assign entities with `add_to_group`. Useful for factions, parties, squads, and any scenario where entities need team-based logic. Query with `get_entity_groups`.

### Pathfinding
A* grid pathfinding with `find_path`. Returns the shortest walkable path between two grid positions, respecting tile walkability. Agents can use this to plan multi-step movement or check reachability.

### State Machines
Define named states with valid transitions via `create_state_machine`. Transition between states with `transition_state`. Useful for entity behavior phases (e.g., patrol → alert → chase → attack) or game phases (e.g., setup → combat → resolution).

### Relationships
Create typed entity-to-entity links with `create_relationship` (e.g., ally, rival, mentor, pet-owner). Query with `get_relationships`. Agents can use these to inform dialogue, targeting, and story decisions.

---

## Common Pitfalls

1. **Case sensitivity**: Tags are case-sensitive. `Goblin.png` ≠ `goblin.png`.

2. **Missing entity sprite**: If no file matches an entity's `spriteTag`, the renderer uses a colored rectangle placeholder.

3. **Too many agents**: Each agent makes LLM calls. With 10+ agents and 50 max requests/minute, you may hit rate limits quickly. Adjust `pacing.maxRequestsPerAgent` and `pacing.globalRpmLimit`.

4. **Walkability**: Grid tiles default to walkable. Set `"walkable": false` on walls, pits, and water.

5. **Entity ID uniqueness**: Every entity must have a unique `id`. If two entities share an ID, the second overwrites the first in `world.json`'s entity map.

6. **Agent `entityId`**: The `entityId` field in an agent definition must match an entity's `id` in `world.json`. This links the AI agent to its visual representation.

7. **API keys**: Do NOT put `apiKey`, `baseURL`, `model`, or `provider` in agent JSON files. These are injected from the global **Settings → Agent tab** at runtime. If no API key is configured, the agent will error on its first turn.

---

## Bootstrap (AI-Assisted Creation)

Instead of writing files manually, use the **Bootstrap Agent** in the app:
1. Click "Create Module" in the module browser
2. Describe your scenario in plain English
3. The AI generates `manifest.json`, `world.json`, and agent definitions
4. Review and edit before saving

The bootstrap flow is implemented in `src/main/module-engine/module-loader.ts` → `bootstrapModule()`.

---

## Module Settings

Every module has a settings dialog accessible via the gear icon next to each module in the **Modules** menu. The settings dialog exposes every parameter for editing:

- **General**: Name, description, version, author, world type, scheduling mode, orchestrator toggle, agent memory
- **Pacing**: Burst window, cooldown, per-agent request cap, global RPM limit
- **Renderer**: Canvas size, background color, grid settings, tile dimensions
- **Agents**: Per-agent name, personality, system prompt template, entity ID, AI model/provider overrides, and a grouped tool picker for selecting from 60+ available tools

Changes are saved to disk immediately when you click Save. Ctrl+S also works.
