# Module Engine — Live Game Feel Changelog

**Date:** 2026-03-23
**Scope:** Studio-wide module engine improvements

This document records all changes made to transform the module engine from "discrete turns with text output" into a continuous live game experience that spectators can watch with dynamic visuals.

---

## Table of Contents

1. [Root Cause: Why the Engine Felt Static](#1-root-cause-why-the-engine-felt-static)
2. [Part 1 — Model/Provider Precedence (Settings Win)](#2-part-1--modelprovider-precedence-settings-win)
3. [Part 2 — Non-Blocking Orchestrator Turns](#3-part-2--non-blocking-orchestrator-turns)
4. [Part 3 — Visual-First System Prompt Rewrites](#4-part-3--visual-first-system-prompt-rewrites)
5. [Part 4 — New Visual Tools & Renderer Events](#5-part-4--new-visual-tools--renderer-events)
6. [Part 5 — Animation Polish (Narration Queue, HP, Spawn/Death)](#6-part-5--animation-polish)
7. [Part 6 — Documentation Overhaul](#7-part-6--documentation-overhaul)
8. [Part 7 — Agent JSON Cleanup](#8-part-7--agent-json-cleanup)
9. [Summary of All Files Changed](#9-summary-of-all-files-changed)
10. [Part 8 — Game Primitives & Module Settings (2026-03-24)](#10-part-8--game-primitives--module-settings-2026-03-24)

---

## 1. Root Cause: Why the Engine Felt Static

The engine had three architectural problems that made it feel like "discrete turns" rather than a live game:

**Problem A — Model precedence was inverted.**
`createClient()` in `agent-pool.ts` used `role.model || defaults.model`. This meant hardcoded values in agent JSON files overrode user settings in **Settings → Agent tab**. If a module's agent JSON specified `"model": "MiniMax-M2.7"`, the user's configured API key and model for that provider would be ignored.

**Problem B — Orchestrator was blocking.**
In orchestrated scheduling mode, the orchestrator fired an LLM call and **waited** for the full multi-turn tool-use response before sending any events to the renderer. Animations only started after the entire LLM loop finished — creating visible pauses between rounds.

**Problem C — Agents produced text, not actions.**
Agent system prompts encouraged verbose narration without mandating visible tool calls (move_entity, spawn_entity, show_effect). Spectators saw walls of text from the orchestrator's inner monologue but very little on-screen movement.

---

## 2. Part 1 — Model/Provider Precedence (Settings Win)

### Files Changed
- `src/main/module-engine/agent-pool.ts`
- `src/shared/types.ts` — `AgentRole.model`, `provider`, `baseURL` made optional

### What Changed

**Before** (`agent-pool.ts` — `createClient()`):
```typescript
const resolvedProvider = role.provider || this.defaults.provider || 'anthropic'
const resolvedModel = role.model || this.defaults.model || ''
```

**After**:
```typescript
// Settings defaults always win — agent JSON fields are a fallback, not an override.
// This ensures changing Settings → Agent tab applies to ALL agents immediately.
const resolvedProvider = this.defaults.provider || role.provider || 'anthropic'
const resolvedModel = this.defaults.model || role.model || ''
const resolvedBaseURL = this.defaults.baseURL || role.baseURL || ''
```

**Schema change** (`types.ts` — `AgentRole`):
```typescript
// Before: all required
model: string
provider: AIProvider
baseURL: string

// After: all optional — injected from settings if absent
model?: string
provider?: AIProvider
baseURL?: string
```

### Why It Matters
Every module agent JSON in the codebase was subsequently stripped of hardcoded `model` and `provider` fields. Now when a user changes their default model or API key in **Settings → Agent tab**, it applies to every module instantly. No more editing JSON files to fix provider routing.

---

## 3. Part 2 — Non-Blocking Orchestrator Turns

### Files Changed
- `src/main/module-engine/orchestrator.ts`

### What Changed

**Orchestrated mode (`executeAgentTurn`)**
In the multi-turn tool-use loop, after each `executeTool()` call, renderer events are drained and sent to the renderer **immediately** — before the next LLM round starts:

```typescript
// NON-BLOCKING: Immediately send WorldState mutations to renderer
// so animations start playing while the next LLM round processes.
// This is the key to a "live game" feel in orchestrated mode.
const pendingWsEvents = this.wsManager.drainRendererEvents()
for (const evt of pendingWsEvents) {
  this.sendRendererEvent(evt)
}
```

**`give_turn` handled immediately** — not after the full orchestrator turn:
```typescript
if (toolBlock.name === 'give_turn') {
  const toAgentId = params.toAgentId as string | undefined
  if (toAgentId) {
    this.pendingTurnQueue.unshift(toAgentId)
    // Camera should follow whoever just got control
    this.sendRendererEvent({ type: 'camera_follow', entityId: toAgentId })
  }
}
```

**`give_turn` skip in remaining orchestratorActions loop** — prevents double-processing since `give_turn` was already handled above.

**Removed `sleep(100)`** between serial turns. The 100ms sleep created visible gaps with no benefit.

**Model pass-through fix** — `model: undefined` passed to `createMessage()` in both `executeAgentTurn` (orchestrated) and `executeAgentTurnQueued` (free-for-all):
```typescript
const response = await client.createMessage({
  model: undefined,  // Use client's stored resolved model (from settings defaults)
  system: systemPrompt,
  messages: currentMessages,
  tools,
  maxTokens: 4096,
})
```
The orchestrator now uses the client's stored resolved model from settings, rather than bypassing it with a hardcoded value from the agent JSON.

### Why It Matters
Animations begin playing while the orchestrator is still thinking. A multi-turn orchestrator turn (DM narrates → spawns goblin → gives turn) now sends events as it goes, so the renderer starts animating the goblin spawn before the DM finishes its entire turn. Combined with immediate `give_turn` handling, the next agent's camera follow fires the instant the turn is passed — no waiting for the orchestrator's full loop.

---

## 4. Part 3 — Visual-First System Prompt Rewrites

### Files Changed
- `src/main/module-engine/orchestrator.ts` — `buildSystemPrompt()`
- `src/main/module-engine/module-loader.ts` — bootstrap prompt

### Orchestrator Prompt Rewrite (`orchestrator.ts`)

The orchestrator's system prompt section was replaced with **visual-first directives**:

```
You are the game master for this module. Your job is to make the game
VISUALLY ENTERTAINING to WATCH.

EVERY round you must produce at least 2-3 visible changes on screen:
  - spawn_entity or move_entity to show action
  - narrate() to describe what the player sees
  - After any damage_entity, narrate() the impact
  - When a creature dies, narrate() with dramatic flair

Pacing:
  - Call end_round() every 3-5 turns to let things breathe
  - Between rounds, narrate what happened and set up the next challenge
  - Keep narration short (1-3 sentences) so it doesn't block action

The spectator is watching sprites move, HP bars change, and effects play.
Your narrations and actions are what they SEE. Make it dynamic.

IMPORTANT: Always prefer move_entity + narrate() over only narrate().
Show, don't just tell.
```

### Non-Orchestrator Agent Instructions (added to prompt)

```
EVERY turn you must:
  1. Call move_entity() FIRST to show yourself moving
  2. Call show_speech_bubble() with a short quip or battle cry
  3. Call damage_entity() on an enemy if one is nearby
  4. Call narrate() to describe the outcome

Keep speech bubbles SHORT (under 10 words). Spectators are reading them live.
Move, THEN narrate. Never just narrate without moving first.
```

### Bootstrap Prompt Update (`module-loader.ts`)

The bootstrap prompt (which generates module files via AI) was updated:
- **Never emit** `model`, `provider`, `baseURL`, or `apiKey` fields in generated agent JSONs
- **Orchestrator agents** must always include visual tools: `narrate, spawn_entity, move_entity, give_turn, end_round, show_effect, show_speech_bubble, damage_entity, create_entity, remove_entity, set_entity_state`
- **Player agents** must always include: `move_entity, damage_entity, show_speech_bubble, narrate, get_world_state, describe_scene`

---

## 5. Part 4 — New Visual Tools & Renderer Events

### Files Changed
- `src/shared/actionApi.ts` — new tool functions + tool definitions
- `src/shared/types.ts` — new event types in `ModuleRendererEvent` union
- `src/renderer/module-engine/Camera.ts` — `shake()` + `getShakeOffset()`
- `src/renderer/module-engine/ModuleView.tsx` — event handlers + screen flash overlay

### New Tools (`actionApi.ts`)

```typescript
shake_camera: (p, ctx): ActionResult => {
  const intensity = (p.intensity as number) ?? 5
  const duration = (p.duration as number) ?? 300
  ctx.rendererEvents.push({ type: 'camera_shake', intensity, duration })
  return { success: true }
}

camera_follow: (p, ctx): ActionResult => {
  const entityId = p.entityId as string
  if (!entityId) return { success: false, error: 'entityId is required' }
  ctx.rendererEvents.push({ type: 'camera_follow', entityId })
  return { success: true }
}

flash_screen: (p, ctx): ActionResult => {
  const color = (p.color as string) ?? '#ffffff'
  const duration = (p.duration as number) ?? 150
  ctx.rendererEvents.push({ type: 'screen_flash', color, duration })
  return { success: true }
}
```

### New Renderer Events (`types.ts`)

```typescript
| { type: 'camera_shake'; intensity: number; duration: number }
| { type: 'camera_follow'; entityId: string }
| { type: 'screen_flash'; color: string; duration: number }
```

### Camera Shake (`Camera.ts`)

Camera now tracks shake state and applies decaying random offsets each frame:

```typescript
shake(intensity: number, durationMs: number): void {
  this.shakeIntensity = intensity
  this.shakeDuration = durationMs
  this.shakeElapsed = 0
}

getShakeOffset(): { x: number; y: number } {
  return { x: this.shakeOffsetX, y: this.shakeOffsetY }
}
```

Applied in the game tick loop:
```typescript
const shake = camera.getShakeOffset()
camera.container.x = (camera.container.x || 0) + shake.x
camera.container.y = (camera.container.y || 0) + shake.y
```

### Screen Flash (`ModuleView.tsx`)

A full-canvas `flashOverlay` PIXI.Graphics is rendered above everything. On `screen_flash` event, it fills the screen with the color at 60% alpha, then fades out using a ticker callback:

```typescript
if (event.type === 'screen_flash') {
  const colorStr = event.color.replace('#', '')
  const colorNum = parseInt(colorStr, 16) || 0xffffff
  flashOverlay.clear()
  flashOverlay.rect(0, 0, canvasWidth, canvasHeight)
  flashOverlay.fill({ color: colorNum, alpha: 0.6 })
  let flashAlpha = 0.6
  const fadeTicker = (t: typeof ticker) => {
    flashAlpha -= 0.05 * t.deltaTime
    if (flashAlpha <= 0) {
      flashOverlay.clear()
      app.ticker.remove(fadeTicker)
    } else {
      flashOverlay.alpha = flashAlpha
    }
  }
  app.ticker.add(fadeTicker)
}
```

---

## 6. Part 5 — Animation Polish

### Files Changed
- `src/renderer/module-engine/UIRenderer.ts`
- `src/renderer/module-engine/EntityRenderer.ts`
- `src/renderer/module-engine/ModuleView.tsx`

### 6A — Narration Queue

**Problem:** New `narrate` calls replaced the current narration instantly, causing spectators to miss content.

**Solution:** Narration events now queue when one is already displaying. Maximum queue depth of 5. When the current narration finishes (5 seconds after full text is displayed), the next queued narration starts.

```typescript
case 'narration': {
  if (this.narration !== null) {
    if (this.narrationQueue.length < UIRenderer.MAX_NARRATION_QUEUE) {
      this.narrationQueue.push({ text: event.text, style: event.style })
    }
  } else {
    this.narration = new NarrationDisplay(this.container, event.text, event.style, ...)
  }
  break
}
```

In `tick()`:
```typescript
if (this.narration && this.narration.isDismissed()) {
  this.narration.destroy()
  this.narration = null
  if (this.narrationQueue.length > 0) {
    const next = this.narrationQueue.shift()!
    this.narration = new NarrationDisplay(this.container, next.text, next.style, ...)
  }
}
```

`NarrationDisplay` gained a `dismissed` flag + `dismiss()`/`isDismissed()` methods. Auto-dismiss now sets `dismissed = true` via setTimeout instead of destroying itself, so UIRenderer controls the queue drain.

### 6B — HP Bar Smooth Interpolation

**Problem:** HP bars snapped to new values instantly when damage or healing occurred.

**Solution:** Added `hpTweens` map. When `sync()` sees a new HP ratio, it starts an HP tween instead of redrawing immediately. The foreground bar width is updated each frame via `tickHpTween()` with 300ms easeOutQuad:

```typescript
interface HpTween {
  entityId: string
  hpBar: PIXI.Container
  currentRatio: number
  targetRatio: number
  startTime: number
  duration: number
  done: boolean
}
```

The tween clears and redraws the foreground Graphics each tick with the interpolated width and color.

### 6C — Spawn Animation

When `entity_created` fires, `animateSpawn()` is called:
- Sprite starts at scale 0
- Tweens to scale 1 with **bounce ease** over **200ms**
- Uses `easeOutBounce` function (standard 4-stage bounce curve)

```typescript
animateSpawn(entityId: string): void {
  const sprite = this.sprites.get(entityId)
  if (!sprite) return
  sprite.scale.set(0)
  this._spawnAnimations.set(entityId, {
    sprite,
    startTime: Date.now(),
    duration: 200,
  })
}
```

### 6D — Death Animation

When `entity_died` fires, `animateDeath()` is called:
- Sprite fades to 50% alpha over **400ms**
- Sprite scales to 80% over **400ms** (both with easeOutQuad)
- After 400ms, `removeEntity()` is called to destroy and clean up

```typescript
animateDeath(entityId: string): void {
  const sprite = this.sprites.get(entityId)
  if (!sprite) return
  this._deathAnimations.set(entityId, {
    sprite,
    startTime: Date.now(),
    duration: 400,
    startAlpha: sprite.alpha,
    startScale: sprite.scale.x,
  })
}
```

### 6E — Animation Stagger in Free-for-All

In `ModuleView.tsx`, when processing `entity_moved` events in a batch, a local `staggerIndex` counter increments per move event. Each `animateMove()` call gets `delay = staggerIndex * 50ms`:

```typescript
let staggerIndex = 0
for (const event of events) {
  if (event.type === 'entity_moved') {
    entityRenderer.animateMove(..., staggerIndex * 50)
    staggerIndex++
  }
  // ...
}
```

The `Tween` interface gained an optional `delay` field. `tickTween()` skips tweening until `delay` has elapsed.

### Cleanup Maps

`removeEntity()` now cleans up all animation maps:
```typescript
this.sprites.delete(entityId)
this.tweens.delete(entityId)
this.hpTweens.delete(entityId)
this._spawnAnimations.delete(entityId)
this._deathAnimations.delete(entityId)
this.hpBars.delete(entityId)
```

---

## 7. Part 6 — Documentation Overhaul

### Files Changed
- `modules/README.md`

### Changes

**Schema Rule Added** — New callout box in Step 4 (Agent Definitions):
> **Do NOT include `model`, `provider`, `baseURL`, or `apiKey` in agent JSON files.** These are injected at runtime from the global settings in **Settings → Agent tab**.

**Visual Gameplay Conventions Section Added** — Full section explaining:
- Orchestrator duties (visible actions every turn, 2-3 per round, short narration)
- Player agent duties (move first, speech bubble, narrate outcome)
- Visual priority hierarchy (movement > combat effects > speech > narration)
- Camera behavior (auto-follow on `give_turn`)
- Animation system behavior (400ms move, 300ms HP, 200ms spawn bounce, 400ms death fade)

**Pitfall #7 Updated** — Removed outdated claim that agent JSONs can include `apiKey` and `baseURL`. Now explicitly states not to include them.

**Example JSONs Updated** — Removed `"model"` and `"provider"` from both example agent JSONs in the README.

---

## 8. Part 7 — Agent JSON Cleanup

### Files Changed
- `modules/monster-battler/agents/bear.json`
- `modules/monster-battler/agents/wolf.json`
- `modules/agents-and-architects/agents/warrior.json`
- `modules/agents-and-architects/agents/mage.json`
- `modules/agents-and-architects/agents/rogue.json`
- `modules/agents-and-architects/agents/dm.json`
- `modules/dog-racing/agents/*.json` (17 files — all dog agents + orchestrator-dm)
- `modules/atlas-wanders/agents/agent-orchestrator.json` (already clean)
- `modules/atlas-wanders/agents/agent-princess.json` (already clean)

### What Was Removed

From each agent JSON, these fields were removed (or set to `null`/`""` and stripped):

```json
"model": "claude-haiku-4-5-20251001",   ← REMOVED
"provider": "anthropic",                  ← REMOVED
"baseURL": ""                             ← REMOVED
```

All agents now rely entirely on **Settings → Agent tab** for AI provider configuration.

---

## 9. Summary of All Files Changed

| File | Changes |
|------|---------|
| `src/main/module-engine/agent-pool.ts` | Reversed model/provider/baseURL precedence (settings win); model pass-through fix |
| `src/main/module-engine/orchestrator.ts` | `model: undefined` in createMessage; non-blocking event drain; immediate give_turn + camera_follow; removed sleep(100); visual-first system prompts |
| `src/main/module-engine/module-loader.ts` | Bootstrap prompt: no model/provider/baseURL generation; always include visual tools; orchestrator visual directive |
| `src/shared/types.ts` | model/provider/baseURL optional in AgentRole; camera_shake/camera_follow/screen_flash added to ModuleRendererEvent |
| `src/shared/actionApi.ts` | Added shake_camera, camera_follow, flash_screen tool functions + tool definitions |
| `src/renderer/module-engine/Camera.ts` | Added shake state, shake() method, getShakeOffset() method, shake decay in update() |
| `src/renderer/module-engine/ModuleView.tsx` | Added handlers for camera_shake/camera_follow/screen_flash; flashOverlay PIXI.Graphics; stagger counter; entity_died wiring; animateSpawn; animateDeath |
| `src/renderer/module-engine/UIRenderer.ts` | Narration queue with MAX_NARRATION_QUEUE=5; NarrationDisplay dismiss/isDismissed/destroy; queue drain in tick() |
| `src/renderer/module-engine/EntityRenderer.ts` | hpTweens map + tickHpTween(); easeOutBounce; animateSpawn(); animateDeath(); _spawnAnimations + _deathAnimations maps; animateMove delay param; full cleanup in removeEntity/destroy |
| `modules/README.md` | Schema rule callout; Visual Gameplay Conventions section; updated example JSONs; fixed pitfall #7 |
| `modules/monster-battler/agents/bear.json` | Stripped model/provider |
| `modules/monster-battler/agents/wolf.json` | Stripped model/provider |
| `modules/agents-and-architects/agents/warrior.json` | Stripped model/provider |
| `modules/agents-and-architects/agents/mage.json` | Stripped model/provider |
| `modules/agents-and-architects/agents/rogue.json` | Stripped model/provider |
| `modules/agents-and-architects/agents/dm.json` | Stripped model/provider |
| `modules/dog-racing/agents/*.json` (17 files) | Stripped model/provider |

---

## 10. Part 8 — Game Primitives & Module Settings (2026-03-24)

### Scope

Added 9 new game subsystems with 33 new tools, giving agents Godot-like building blocks while preserving the "DM as god" philosophy. Also added a full Module Settings Dialog for editing every module parameter.

### New Subsystems

| System | Tools Added | Purpose |
|--------|------------|---------|
| Action Sequencer | `wait_for_animations` + `delay` param on mutations | Cinematic event sequencing instead of everything at once |
| Timers | `create_timer`, `cancel_timer`, `get_timers` | Schedule recurring/one-shot game events |
| Triggers | `create_trigger`, `remove_trigger`, `get_triggers` | Spatial zones (traps, cutscenes, zone effects) |
| Status Effects | `apply_status_effect`, `remove_status_effect`, `get_status_effects` | Buffs/debuffs with tick/time durations |
| Inventory | `give_item`, `remove_item`, `get_inventory`, `equip_item`, `unequip_item`, `transfer_item`, `use_item` | Structured item system |
| Groups | `create_group`, `add_to_group`, `remove_from_group`, `get_group`, `get_groups`, `get_entity_groups` | Named entity groupings/factions |
| Pathfinding | `find_path`, `get_path_distance` | A* grid pathfinding |
| State Machines | `create_state_machine`, `transition_state`, `get_state_machine`, `get_state_machines` | Named states with valid transitions |
| Relationships | `create_relationship`, `remove_relationship`, `get_relationships`, `get_related_entities` | Entity-to-entity typed links |

### New Files Created

| File | Purpose |
|------|---------|
| `src/main/module-engine/action-sequencer.ts` | ActionSequencer class — priority queue, 16ms tick, per-agent tracking |
| `src/shared/pathfinding.ts` | A* implementation with Manhattan/Chebyshev heuristics |
| `src/renderer/components/ModuleSettingsDialog.tsx` | Full module settings editor (4 tabs, grouped tool picker) |
| `src/renderer/components/ModuleSettingsDialog.css` | Styling for module settings dialog |

### Files Modified

| File | Changes |
|------|---------|
| `src/shared/types.ts` | 7 new interfaces, Entity extensions (statusEffects, inventory), WorldState extensions, 20+ new event types |
| `src/shared/actionApi.ts` | 33 new tool implementations + Anthropic tool definitions, `delay` param on mutation tools |
| `src/shared/WorldState.ts` | ~400 lines of new methods for all 9 subsystems, trigger checking in moveEntity() |
| `src/main/module-engine/orchestrator.ts` | ActionSequencer wiring, timer/effect ticking, template vars, expanded system prompts |
| `src/main/module-engine/module-loader.ts` | Backward compat defaults, expanded bootstrap prompt with all new tools |
| `src/main/index.ts` | New `module:getConfig` IPC handler, expanded `module:saveConfigChanges` |
| `src/preload/index.ts` | Added `getModuleConfig()`, updated `saveConfigChanges()` |
| `src/renderer/types/global.d.ts` | Updated type declarations for new IPC methods |
| `src/renderer/module-engine/EntityRenderer.ts` | `flashStatusEffect()`, `applyStateFromEvent()` |
| `src/renderer/module-engine/UIRenderer.ts` | Event handlers for all new event types |
| `src/renderer/module-engine/ModuleView.tsx` | `entity_state_changed` handler |
| `src/renderer/components/MenuBar.tsx` | Settings cog button per module, custom modules dropdown |
| `src/renderer/components/MenuBar.css` | Module row + cog button styles |
| `src/renderer/App.tsx` | ModuleSettingsDialog integration |
| All module agent JSONs (26 files) | Added relevant new tools to tool arrays |

### Module Settings Dialog

New dialog accessible via gear icon next to each module in the Modules menu. Four tabs:

- **General** — Name, description, version, author, world type, scheduling, orchestrator toggle, agent memory
- **Pacing** — Burst window, cooldown, per-agent cap, global RPM limit
- **Renderer** — Canvas dimensions, background color picker, grid settings
- **Agents** — Per-agent config: name, personality, system prompt template (monospace editor), entity ID, AI model/provider overrides, and grouped tool picker with all 60+ tools organized into 14 categories

Features: Ctrl+S save, dirty state tracking, unsaved changes confirmation on close.

### Integration Points Updated

- Bootstrap prompt now lists all 60+ tools organized by category
- `getBootstrapQuestions()` asks about game primitive needs (inventory, status effects, triggers, teams)
- Orchestrator system prompt documents all 9 subsystems + template variables
- Player system prompt mentions inventory, pathfinding, status effects, groups
- `ORCHESTRATOR_ONLY_TOOLS` unchanged (give_turn, end_round, pause_module, resume_module, create_entity)

---

## How the Live Game Feel Works (End-to-End)

1. User clicks **Start** on a module. Orchestrator fires its first LLM call.
2. Orchestrator's `executeAgentTurn()` loops through LLM rounds. Each round may call `spawn_entity`, `move_entity`, `damage_entity`, etc.
3. After **each tool execution**, `wsManager.drainRendererEvents()` sends the resulting `ModuleRendererEvent[]` to the renderer **immediately**, before the next LLM round starts.
4. The renderer begins animating — entities move, effects play, HP bars interpolate.
5. When the orchestrator calls `give_turn('princess')`, it's handled **immediately**: `pendingTurnQueue.unshift('princess')` and `{ type: 'camera_follow', entityId: 'princess' }` fires.
6. Camera follows the princess entity. Animations stagger. Speech bubbles appear above moving entities.
7. New narration events queue instead of overwriting. They drain one by one.
8. Spectators see: continuous action, camera tracking, flowing dialogue, dynamic HP bars — not discrete pulses between agent turns.
