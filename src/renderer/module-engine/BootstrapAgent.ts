// =============================================================================
// Module Engine — Bootstrap Agent
// Scans assets and triggers AI-assisted module generation.
// =============================================================================

import type { ModuleManifest, AgentRole, WorldState, GeneratedModuleConfig } from './types'
import { useModuleStore } from '../stores/useModuleStore'

export interface BootstrapOptions {
  scenarioPrompt: string
  moduleId: string
  assetsPath: string           // relative to modules/{moduleId}/
  model?: string
  apiKey?: string
  baseURL?: string
}

export async function bootstrapModuleFromRenderer(options: BootstrapOptions): Promise<{
  manifest: ModuleManifest
  world: WorldState
  agents: AgentRole[]
}> {
  const store = useModuleStore.getState()
  store.setBootstrapStatus('scanning')

  // Scan assets directory via main process (IPC)
  const assetSummary = await window.moduleAPI.scanAssets(options.moduleId, options.assetsPath)
  store.setBootstrapStatus('generating')

  // Build bootstrap prompt
  const prompt = buildBootstrapPrompt(options.scenarioPrompt, assetSummary)

  // Call AI
  const result = await window.moduleAPI.generateModuleConfig(options.moduleId, prompt, {
    model: options.model,
    apiKey: options.apiKey,
    baseURL: options.baseURL,
  })

  store.setBootstrapStatus('done')
  return result as { manifest: ModuleManifest; world: WorldState; agents: AgentRole[] }
}

function buildBootstrapPrompt(scenario: string, assets: {
  tiles: string[]
  entities: string[]
  effects: string[]
}): string {
  return `## Available Assets (tagged)
Tiles: ${assets.tiles.join(', ') || 'none'}
Entities: ${assets.entities.join(', ') || 'none'}
Effects: ${assets.effects.join(', ') || 'none'}

## Scenario
${scenario}`
}
