# Terminal Habitat — Project Context

## What This Project Is

**Terminal Habitat** is an Electron desktop app (Electron 33 + electron-vite + React 18 + TypeScript) that combines:
- Multiple real terminal panes (node-pty + xterm.js v5)
- Pixel art creatures rendered with Pixi.js v8 that visually represent running sessions
- A **Modular AI Agent Game Engine** — the primary new feature

The app lives at `C:\Users\Sand\Desktop\Coding\Sands Studio`. Always deploy using `Launch Terminal Habitat.bat` (not `npm run dev`).

---

## Architecture at a Glance

```
src/
├── main/                    # Electron main process
│   ├── index.ts            # App lifecycle, window creation, IPC handlers
│   ├── module-engine/
│   │   ├── orchestrator.ts  # Agent scheduling, rate limiting, AI tool-use loop
│   │   ├── agent-pool.ts    # Multi-model AI client management
│   │   └── module-loader.ts # Module loading, validation, bootstrap
│   ├── pty-manager.ts       # Terminal pane PTY management
│   └── agent-runner.ts      # Claude API agent tool-use loop (habitat agents)
│
├── preload/
│   └── index.ts            # IPC bridge via contextBridge (moduleAPI exposed here)
│
├── renderer/               # React UI
│   ├── App.tsx            # Root: conditionally renders Habitat or ModuleView
│   ├── Habitat.tsx        # Pixi.js creature habitat (default view)
│   ├── module-engine/
│   │   ├── types.ts       # Renderer-side types (re-exports from shared/)
│   │   ├── WorldState.ts  # Renderer-side WS manager (re-exports from shared/)
│   │   ├── actionApi.ts   # Renderer-side action API (re-exports from shared/)
│   │   ├── ModuleView.tsx # Pixi.js canvas takeover when module runs
│   │   ├── TileMap.ts     # Grid world tile renderer
│   │   ├── EntityRenderer.ts  # Entity sprites + Tween animations
│   │   ├── UIRenderer.ts  # Speech bubbles, narration, event log
│   │   ├── Camera.ts      # Viewport follow/zoom/pan
│   │   └── BootstrapAgent.ts # AI-assisted module generation
│   └── stores/
│       ├── useModuleStore.ts  # Zustand store for module lifecycle
│       └── useTerminalStore.ts
│
└── shared/                 # Used by BOTH main and renderer (cross-process safe)
    ├── types.ts           # ALL core interfaces (Entity, ModuleManifest, AgentRole, etc.)
    ├── actionApi.ts      # Tool registry: agent-callable functions + Anthropic tool defs
    └── WorldState.ts     # WorldStateManager class (single source of truth)
```

---

## Module Engine — Core Concept

A **module** is a self-contained game scenario. When a module runs:
1. The Pixi.js canvas **fully takes over** from the Habitat view
2. AI agents play autonomously as specified in the module
3. The user is a **pure spectator** — can only start/stop/pause
4. The DM/orchestrator agent **decides all game logic** — the engine just validates and applies

### Scheduling Modes
- **`orchestrated`** — DM/orchestrator agent gives turns to others (D&D-style)
- **`round-robin`** — Fixed turn order through all agents
- **`free-for-all`** — All agents act simultaneously, no orchestrator (e.g. monster battler)

### DM as God
There is **no hardcoded rules engine**. The orchestrator agent calls tools like `narrate`, `move_entity`, `damage_entity`. The engine validates and applies. The DM's personality IS the ruleset.

### Tagged Asset System
Assets are referenced by **semantic tags**, not filenames. Agents say "spawn a goblin at 3,2" → system resolves `goblin` tag to the tagged sprite. This makes modules art-swappable.

```
modules/my-module/assets/
├── tiles/
│   ├── grass.png           # tagged: ["floor", "outdoor"]
│   └── wall_stone.png      # tagged: ["wall", "indoor"]
├── entities/
│   ├── warrior.png         # tagged: ["player", "melee", "humanoid"]
│   └── goblin.png          # tagged: ["enemy", "melee", "goblin"]
└── effects/
    └── fireball.png        # tagged: ["spell", "fire", "animation"]
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/shared/types.ts` | All core interfaces. Single source of truth. Import from both main and renderer. |
| `src/shared/actionApi.ts` | Agent tool registry. Every function is both a JS callable AND an Anthropic tool definition. |
| `src/shared/WorldState.ts` | `WorldStateManager` — single source of truth for game state. |
| `src/main/module-engine/orchestrator.ts` | `ModuleOrchestrator` + `RateLimiter`. Schedules agent turns, runs tool-use loops. |
| `src/main/module-engine/agent-pool.ts` | `AgentPool` manages per-role AI clients (Anthropic, MiniMax, OpenRouter, OpenAI). |
| `src/main/module-engine/module-loader.ts` | `loadModule()`, `listModules()`, `bootstrapModule()`. Asset registry from tagged filenames. |
| `src/renderer/stores/useModuleStore.ts` | Zustand store: `status`, `worldState`, `agentStatuses`, `pendingEvents`. |
| `src/renderer/module-engine/ModuleView.tsx` | React component: initializes PIXI app, TileMap, EntityRenderer, UIRenderer, Camera. |
| `src/renderer/module-engine/EntityRenderer.ts` | Entity sprites + Tween animations + state-based tint colors. |
| `src/renderer/module-engine/UIRenderer.ts` | `SpeechBubble`, `NarrationDisplay` (typewriter effect), event log. |
| `src/renderer/module-engine/types.ts` | Renderer-side re-exports from `../../shared/types`. |
| `src/preload/index.ts` | `moduleAPI` exposed via contextBridge. All IPC channels. |
| `src/main/index.ts` | IPC handlers for module operations. `createWindow()` scoped `currentOrchestrator` + `loadedModule`. |

---

## Development Commands

```bash
npm run dev      # Dev server (bypasses the launcher)
npm run build    # Build all targets (main/preload/renderer)
npm run package  # Build + electron-builder → release/
npm run rebuild  # Rebuild node-pty native module
npm run start    # Preview built app
```

**Always deploy with `Launch Terminal Habitat.bat`** — it handles native module rebuilds, environment, and launching.

---

## Module Structure

```
modules/<module-id>/
├── manifest.json    # Module metadata: scheduling, pacing, renderer config, orchestrator flag
├── world.json       # Initial world state: tick, entities, grid/world config
├── agents/          # One JSON per agent role
│   ├── dm.json     # orchestrator agent with systemPromptTemplate + tools
│   ├── warrior.json
│   └── mage.json
└── assets/          # Optional art assets with tagged filenames
    ├── tiles/
    ├── entities/
    └── effects/
```

### Module Manifest Fields
```json
{
  "id": "module-id",
  "name": "Display Name",
  "worldType": "grid",           // "grid" | "freeform" | "hybrid"
  "scheduling": "free-for-all",  // "orchestrated" | "round-robin" | "free-for-all"
  "pacing": {
    "burstWindowMs": 30000,
    "burstCooldownMs": 2000,
    "maxRequestsPerAgent": 50
  },
  "renderer": {
    "canvasWidth": 1440,
    "canvasHeight": 900,
    "backgroundColor": 4473924,
    "showGrid": true,
    "gridSize": 32
  },
  "hasOrchestrator": false,
  "assets": "assets",
  "agents": "agents",
  "world": "world.json"
}
```

---

## Agent Role Fields

```json
{
  "id": "warrior",
  "name": "The Warrior",
  "personality": "Fierce and tactical, charges into battle...",
  "isOrchestrator": false,
  "model": "claude-sonnet-4-6",
  "provider": "anthropic",
  "systemPromptTemplate": "You are {{role}}. ...\n{{worldState}}\n{{recentEvents}}",
  "tools": ["get_world_state", "get_entities_nearby", "move_entity", "damage_entity", "set_entity_state", "show_speech_bubble"],
  "entityId": "entity-warrior-1"
}
```

---

## Available Agent Tools (from `shared/actionApi.ts`)

| Tool | Who Can Use | Description |
|------|-------------|-------------|
| `get_world_state` | All | Returns serialized world state for agent context |
| `get_entity` | All | Get a single entity by ID |
| `get_entities_by_type` | All | Get all entities of a type (player, enemy, etc.) |
| `get_entities_nearby` | All | Get entities near a position |
| `get_tile` | All | Get tile at grid position |
| `move_entity` | All | Move entity to new position |
| `create_entity` | All | Create a new entity |
| `remove_entity` | All | Remove an entity |
| `update_entity` | All | Partial update to entity properties |
| `damage_entity` | All | Deal damage to an entity |
| `heal_entity` | All | Heal an entity |
| `kill_entity` | All | Kill an entity (sets state to dead) |
| `set_entity_state` | All | Set entity animation state |
| `trigger_animation` | All | Trigger named animation |
| `show_speech_bubble` | All | Show floating speech bubble above entity |
| `show_effect` | All | Play visual effect at position |
| `narrate` | All | DM narration text |
| `describe_scene` | All | Get nearby entities with descriptions |
| `give_turn` | Orchestrator only | Insert agent into turn queue |
| `end_round` | Orchestrator only | Advance to next round |
| `spawn_entity` | All | Spawn entity at position |
| `pause_module` | All | Pause the module |
| `resume_module` | All | Resume the module |

---

## Multi-Provider AI

`AgentPool` in `agent-pool.ts` manages AI clients per agent role:
- **`anthropic`**: Uses `@anthropic-ai/sdk` directly
- **`openai`**, **`minimax`**, **`openrouter`**, **`custom`**: Use `fetch` with OpenAI-compatible `/chat/completions` endpoint

Each `AgentRole` specifies its own `provider`, `model`, `baseURL`, and `apiKey`. No hardcoded model names.

---

## IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `module:list` | main→renderer | List available modules |
| `module:load` | renderer→main | Load a module manifest |
| `module:start` | renderer→main | Start orchestrator |
| `module:stop` | renderer→main | Stop and cleanup |
| `module:pause` | renderer→main | Pause orchestrator loop |
| `module:resume` | renderer→main | Resume orchestrator loop |
| `module:scan-assets` | renderer→main | Scan assets folder, return tagged manifest |
| `module:bootstrap` | renderer→main | AI-generate module config from scenario |
| `module:save` | renderer→main | Save generated module to disk |
| `module:event` | main→renderer | Game events (moves, animations, narration) |
| `module:state` | main→renderer | World state sync |
| `module:agent-status` | main→renderer | Per-agent status updates |
| `module:status` | main→renderer | Module lifecycle status |

---

## Rate Limiting

`RateLimiter` in `orchestrator.ts` uses a sliding window (60s) per-agent:
- Tracks `{ count, resetAt }` per `agentId`
- `canMakeRequest()` checks and increments atomically
- Global RPM limit is enforced by summing all agent request counts
- Target: MiniMax M2.7 supports 4500 RPM (75 RPS) as a reference

---

## Pixi.js v8 Rendering

All Pixi.js code uses v8 API:
- `app.init({ width, height, background })` — not constructor
- `Graphics.fill()` + `Graphics.rect()` — not `beginFill()`/`drawRect()`
- EntityRenderer: Tween animations with easing functions
- UIRenderer: Typewriter narration reveal, fade-out speech bubbles

---

## Brain Router Agent

The local agent definition is at `.claude/agents/brain-router.md` (v1.0.7). It connects to Firebase Firestore to discover expert agents from the Sands Cloud Brain meta-brain.

- **Project ID**: `sands-cloud-brain`
- **Firestore URL**: `https://firestore.googleapis.com/v1/projects/sands-cloud-brain/databases/(default)/documents`
- **Service account**: `C:\Users\Sand\Desktop\firebase-service-account.json`

On first invocation, the brain router auto-installs Firebase Admin SDK:
```bash
pip install firebase-admin>=6.4.0 google-cloud-firestore>=2.23.0 google-auth>=2.0.0
```

If Firestore is empty (no agents synced), fall back to local agent discovery via Glob/Grep.

---

## Design Principles

1. **DM as authority, not rules engine** — Orchestrator agent decides everything. No D&D-like hardcoded rules.
2. **Generalizable beyond orchestrated games** — `free-for-all` scheduling means peer agents with no narrator.
3. **Assets are tagged, not hardcoded** — Semantic tag resolution means art can be swapped without breaking modules.
4. **World state is canonical** — Renderer reflects WorldState only. Agent actions: Agent → actionApi → WorldState → IPC → Renderer events.
5. **Rate limiting is first-class** — Built into orchestrator, not bolted on.
6. **Bootstrap makes modules accessible** — User writes a scenario prompt, AI generates manifest + world + agents. Hand-editing always available.
7. **Cross-process safety** — All shared code lives in `src/shared/`. Renderer files re-export from there.

---

## Sample Modules

| Module | Scheduling | Description |
|--------|------------|-------------|
| `agents-and-architects` | orchestrated | D&D-style dungeon crawl: DM + 3 adventurers |
| `monster-battler` | free-for-all | Peer-agent arena, no narrator, creatures fight and evolve |

---

## Cross-Process Import Rule

**CRITICAL**: Never import renderer-only code (`src/renderer/`) from main process code (`src/main/`). Shared code lives in `src/shared/`. The renderer has re-export shims (`src/renderer/module-engine/types.ts`, etc.) that point to `../../shared/`.
