// =============================================================================
// Module Engine — Module Loader
// Loads, validates, and bootstraps modules from the modules/ directory.
// =============================================================================

import fs from 'fs'
import path from 'path'
import { resolve } from 'path'
import { app } from 'electron'
import type {
  ModuleManifest,
  AgentRole,
  WorldState,
} from '../../shared/types'

// Resolve modules dir correctly in both dev and packaged builds:
// - Dev:         app.getAppPath() → project root  → modules/ is at project root
// - Packaged:    app.getAppPath() → app/ dir      → resources/modules/ is one level up
function getModulesDir(): string {
  const appPath = app.getAppPath()
  // If modules/ exists directly under app path (dev), use it
  const devPath = resolve(appPath, 'modules')
  if (fs.existsSync(devPath)) return devPath
  // Otherwise assume we're packaged: resources/ is a sibling of the app dir
  return resolve(appPath, '..', 'resources', 'modules')
}

const MODULES_DIR = getModulesDir()

// ── Module Loading ────────────────────────────────────────────────────────────

export interface LoadedModule {
  manifest: ModuleManifest
  agents: AgentRole[]
  worldState: WorldState
  assetRegistry: AssetRegistry
  rootPath: string
}

export function listModules(): string[] {
  if (!fs.existsSync(MODULES_DIR)) return []
  return fs.readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
}

export async function loadModule(id: string): Promise<LoadedModule> {
  const modulePath = path.join(MODULES_DIR, id)

  if (!fs.existsSync(modulePath)) {
    throw new Error(`Module '${id}' not found at ${modulePath}`)
  }

  // Load manifest
  const manifestPath = path.join(modulePath, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Module '${id}' is missing manifest.json`)
  }

  const manifest: ModuleManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  validateManifest(manifest)

  // Load world state
  let worldState: WorldState = {
    tick: 0,
    entities: {},
    worldType: manifest.worldType,
    events: [],
  }

  const worldPath = path.join(modulePath, manifest.world ?? 'world.json')
  if (fs.existsSync(worldPath)) {
    const raw = JSON.parse(fs.readFileSync(worldPath, 'utf8'))
    // Convert entity array to map if needed
    if (Array.isArray(raw.entities)) {
      raw.entities = Object.fromEntries(raw.entities.map((e: any) => [e.id, e]))
    }
    worldState = raw as WorldState
  }

  // Load agent roles
  const agentsDir = path.join(modulePath, manifest.agents ?? 'agents')
  const agents: AgentRole[] = []
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (file.endsWith('.json')) {
        const role = JSON.parse(fs.readFileSync(path.join(agentsDir, file), 'utf8')) as AgentRole
        agents.push(role)
      }
    }
  }

  // Build asset registry
  const assetRegistry = await buildAssetRegistry(path.join(modulePath, manifest.assets))

  return {
    manifest,
    agents,
    worldState,
    assetRegistry,
    rootPath: modulePath,
  }
}

function validateManifest(manifest: ModuleManifest): void {
  const required: (keyof ModuleManifest)[] = [
    'id', 'name', 'description', 'worldType', 'scheduling', 'pacing', 'renderer', 'assets',
  ]
  for (const field of required) {
    if (manifest[field] === undefined) {
      throw new Error(`Module manifest missing required field: ${field}`)
    }
  }

  if (!['grid', 'freeform', 'hybrid'].includes(manifest.worldType)) {
    throw new Error(`Invalid worldType: ${manifest.worldType}`)
  }
  if (!['orchestrated', 'round-robin', 'free-for-all'].includes(manifest.scheduling)) {
    throw new Error(`Invalid scheduling: ${manifest.scheduling}`)
  }
}

// ── Asset Registry Builder ────────────────────────────────────────────────────

export async function buildAssetRegistry(assetsPath: string): Promise<AssetRegistry> {
  const registry: AssetRegistry = {
    tiles: {},
    entities: {},
    effects: {},
    getTexture(tag, category) {
      const assets = this[category === 'tile' ? 'tiles' : category === 'entity' ? 'entities' : 'effects'][tag]
      return assets?.[0]?.path ?? null
    },
    getRandomByTag(tag, category) {
      const key = category === 'tile' ? 'tiles' : category === 'entity' ? 'entities' : 'effects'
      const assets = registry[key][tag]
      if (!assets || assets.length === 0) return null
      return assets[Math.floor(Math.random() * assets.length)].path
    },
  }

  if (!fs.existsSync(assetsPath)) return registry

  const categories: Array<keyof Pick<AssetRegistry, 'tiles' | 'entities' | 'effects'>> = [
    'tiles', 'entities', 'effects',
  ]

  for (const category of categories) {
    const catPath = path.join(assetsPath, category)
    if (!fs.existsSync(catPath)) continue

    for (const file of fs.readdirSync(catPath)) {
      if (!file.endsWith('.png') && !file.endsWith('.jpg') && !file.endsWith('.gif')) continue

      const tags = parseAssetTags(file)
      const filePath = path.join(catPath, file)

      for (const tag of tags) {
        if (!registry[category][tag]) registry[category][tag] = []
        registry[category][tag].push({ path: filePath, tags, category })
      }
    }
  }

  return registry
}

// Parse tags from filename: "warrior_player_humanoid.png" → ['warrior', 'player', 'humanoid']
function parseAssetTags(filename: string): string[] {
  const name = filename.replace(/\.(png|jpg|gif)$/, '')
  // Support both underscore-separation and explicit tags: "goblin[enemy,melee]"
  const explicitMatch = name.match(/^(.+)\[(.+)\]$/)
  if (explicitMatch) {
    const base = explicitMatch[1]
    const tags = explicitMatch[2].split(',')
    return [base, ...tags]
  }
  return name.split('_').filter(Boolean)
}

// ── Bootstrap helpers ────────────────────────────────────────────────────────

async function callMessagesAPI(params: {
  apiKey: string
  baseURL?: string
  model: string
  system: string
  userContent: string
  maxTokens: number
}): Promise<string> {
  const base = (params.baseURL ?? 'https://api.anthropic.com').replace(/\/$/, '')
  const url = `${base}/v1/messages`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': params.apiKey,
      'authorization': `Bearer ${params.apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: [{ role: 'user', content: params.userContent }],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${body}`)
  }
  const json = await res.json() as {
    content?: Array<{ type?: string; text?: string }>
    choices?: Array<{ message?: { content?: string } }>
  }
  // M2.7 prepends a thinking block before the text block — find the first text-type block
  const textBlock = json.content?.find((b) => b.type === 'text')
  return textBlock?.text ?? json.choices?.[0]?.message?.content ?? ''
}

// ── Bootstrap Helpers ────────────────────────────────────────────────────────

function deriveProvider(baseURL?: string): string {
  if (!baseURL || baseURL.includes('anthropic.com')) return 'anthropic'
  if (baseURL.includes('openai.com')) return 'openai'
  if (baseURL.includes('minimax.chat')) return 'minimax'
  if (baseURL.includes('openrouter.ai')) return 'openrouter'
  return 'custom'
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

export interface BootstrapInput {
  scenarioPrompt: string
  assetsPath: string
  model?: string
  apiKey?: string
  baseURL?: string
}

export async function bootstrapModule(
  input: BootstrapInput
): Promise<{ manifest: ModuleManifest; world: WorldState; agents: AgentRole[] }> {
  // Build asset list from directory
  const assetManifest = await buildAssetRegistry(input.assetsPath)

  const assetSummary = {
    tiles: Object.keys(assetManifest.tiles),
    entities: Object.keys(assetManifest.entities),
    effects: Object.keys(assetManifest.effects),
  }

  const bootstrapPrompt = `You are a game designer creating a module configuration from a scenario.

## Available Assets
${JSON.stringify(assetSummary, null, 2)}

## Scenario
${input.scenarioPrompt}

Generate a complete module configuration. Respond with ONLY a JSON object (no markdown) with exactly these three keys:

1. "manifest" — with fields:
   - id: string (slug, e.g. "my-dungeon")
   - name: string (display name)
   - description: string (1-2 sentences)
   - worldType: EXACTLY one of "grid" | "freeform" | "hybrid" — DO NOT invent other values
   - scheduling: EXACTLY one of "orchestrated" | "round-robin" | "free-for-all"
   - pacing: { "burstWindowMs": 60000, "burstCooldownMs": 5000, "maxRequestsPerAgent": 20 }
   - renderer: { "canvasWidth": 1440, "canvasHeight": 900, "backgroundColor": 895770, "gridSize": 48 }
   - hasOrchestrator: true if scheduling is "orchestrated", false otherwise
   - assets: "assets"   ← ALWAYS include this exact string value

2. "world" — with fields:
   - tick: 0
   - worldType: must match manifest.worldType exactly
   - events: []
   - entities: array of entity objects, each MUST have ALL of:
     - id: string
     - type: string
     - name: string
     - spriteTag: string (match an available entity asset tag, or a descriptive word)
     - properties: {} (add hp, maxHp, etc. as needed)
     - state: "idle"
     - visible: true
     - position: { "col": number, "row": number } for grid worlds
                 { "x": number, "y": number } for freeform/hybrid worlds
     IMPORTANT: position MUST be a nested object — do NOT put x/y/col/row at the entity's root level
   - grid: { "width": number, "height": number, "tiles": [], "tileWidth": 48, "tileHeight": 48 } — include ONLY if worldType is "grid"

3. "agents" — array of agent objects each with:
   - id, name, personality, isOrchestrator
   - model: "${input.model || ''}"
   - provider: "${deriveProvider(input.baseURL)}"   ← MUST be exactly one of: anthropic | openai | minimax | openrouter | custom${input.baseURL && deriveProvider(input.baseURL) !== 'anthropic' ? `\n   - baseURL: "${input.baseURL}"` : '\n   - do NOT include baseURL for anthropic provider'}
   - Do NOT include apiKey in any agent JSON — keys are provided at runtime via environment
   - systemPromptTemplate: include {{worldState}}, {{recentEvents}}, {{role}}, {{personality}} placeholders
   - tools: array of tool names this agent can call
   - entityId: id of the entity this agent controls (if applicable)

Rules:
- "orchestrated" scheduling needs exactly 1 agent with isOrchestrator: true (the DM/narrator)
- DM tools: narrate, spawn_entity, give_turn, end_round, move_entity, create_entity, damage_entity, get_world_state, describe_scene
- Player/peer agent tools: move_entity, get_world_state, describe_scene, show_speech_bubble, narrate
- Use spriteTag values that match your available assets when possible

Respond with ONLY valid JSON. No markdown fences.`

  // Call AI to generate
  const text = await callMessagesAPI({
    apiKey: input.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
    baseURL: input.baseURL,
    model: input.model ?? '',
    system: 'You are a precise JSON generator for game module configurations. Output ONLY valid JSON, no markdown fences.',
    userContent: bootstrapPrompt,
    maxTokens: 8000,
  })

  // Parse JSON from response
  let jsonStr = text.trim()
  // Strip markdown code fences if present
  jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/\s*```$/, '')

  const generated = JSON.parse(jsonStr)

  // Convert entity arrays to maps in world
  if (Array.isArray(generated.world.entities)) {
    generated.world.entities = Object.fromEntries(
      generated.world.entities.map((e: any) => [e.id, e])
    )
  }

  return generated as { manifest: ModuleManifest; world: WorldState; agents: AgentRole[] }
}

// ── Bootstrap Questions ──────────────────────────────────────────────────────

export interface BootstrapQuestion {
  id: string
  question: string
  placeholder?: string
}

export async function getBootstrapQuestions(input: {
  scenarioPrompt: string
  model?: string
  apiKey?: string
  baseURL?: string
}): Promise<{ questions: BootstrapQuestion[] }> {
  const text = await callMessagesAPI({
    apiKey: input.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
    baseURL: input.baseURL,
    model: input.model ?? '',
    system: 'You generate focused clarifying questions for game module design. Output ONLY valid JSON, no markdown.',
    userContent: `A user wants to create an AI agent game module:\n"${input.scenarioPrompt}"\n\nGenerate 4-6 targeted questions that will help design a well-rounded module. Cover: number/type of agents, scheduling style (does a DM direct action or do agents act freely), win/end conditions, tone/mood, any key mechanics or rules the AI agents should follow.\n\nOutput JSON: { "questions": [{ "id": "q1", "question": "...", "placeholder": "e.g. ..." }] }`,
    maxTokens: 4096,
  })
  const jsonStr = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(jsonStr)
}

export function saveBootstrap(
  moduleId: string,
  data: { manifest: ModuleManifest; world: WorldState; agents: AgentRole[] }
): string {
  const modulePath = path.join(MODULES_DIR, moduleId)
  fs.mkdirSync(modulePath, { recursive: true })
  fs.mkdirSync(path.join(modulePath, 'assets', 'tiles'), { recursive: true })
  fs.mkdirSync(path.join(modulePath, 'assets', 'entities'), { recursive: true })
  fs.mkdirSync(path.join(modulePath, 'assets', 'effects'), { recursive: true })
  fs.mkdirSync(path.join(modulePath, 'agents'), { recursive: true })

  fs.writeFileSync(path.join(modulePath, 'manifest.json'), JSON.stringify(data.manifest, null, 2))

  // Convert entity map back to array for world.json
  const worldData = {
    ...data.world,
    entities: Object.values(data.world.entities),
  }
  fs.writeFileSync(path.join(modulePath, 'world.json'), JSON.stringify(worldData, null, 2))

  for (const agent of data.agents) {
    fs.writeFileSync(
      path.join(modulePath, 'agents', `${agent.id}.json`),
      JSON.stringify(agent, null, 2)
    )
  }

  return modulePath
}
