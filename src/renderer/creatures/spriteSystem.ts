/**
 * spriteSystem.ts
 *
 * Converts CreatureDefinition pixel-grid frames into Pixi.js textures,
 * and manages loading of PNG-based sprites from assets/sprites/manifest.json.
 *
 * Pixel grids are rendered with Pixi.js Graphics (one rect per pixel cell),
 * then baked into a RenderTexture. Scale mode is set to 'nearest' for that
 * crisp pixel-art look.
 */

import * as PIXI from 'pixi.js'
import type { CreatureDefinition, CreatureFrame, CreatureStateName } from './builtinCreatures'

export type TextureMap = Record<CreatureStateName, PIXI.Texture[]>
export type FpsMap = Record<CreatureStateName, number>

/**
 * Convert a single pixel-grid frame into a Pixi Texture.
 * Each non-'.' character becomes a (scale × scale) filled rectangle.
 */
export function frameToTexture(
  renderer: PIXI.Renderer | PIXI.WebGLRenderer | PIXI.WebGPURenderer,
  frame: CreatureFrame,
  scale: number
): PIXI.Texture {
  const { grid, palette } = frame
  const g = new PIXI.Graphics()

  for (let y = 0; y < grid.length; y++) {
    const row = grid[y]
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === '.' || ch === ' ') continue
      const color = palette[ch]
      if (color === undefined) continue
      g.rect(x * scale, y * scale, scale, scale).fill({ color, alpha: 1 })
    }
  }

  const texture = renderer.generateTexture(g)
  // Nearest-neighbour — keeps pixels sharp when scaled up
  texture.source.scaleMode = 'nearest'
  g.destroy()
  return texture
}

/**
 * Bake all animation frames for every state of a creature into Textures.
 * Returns { textureMap, fpsMap } keyed by state name.
 */
export function buildCreatureTextures(
  renderer: PIXI.Renderer | PIXI.WebGLRenderer | PIXI.WebGPURenderer,
  def: CreatureDefinition
): { textureMap: TextureMap; fpsMap: FpsMap } {
  const textureMap = {} as TextureMap
  const fpsMap = {} as FpsMap

  for (const [state, anim] of Object.entries(def.animations) as [CreatureStateName, (typeof def.animations)[CreatureStateName]][]) {
    if (!anim) continue
    textureMap[state] = anim.frames.map((f) => frameToTexture(renderer, f, def.scale))
    fpsMap[state] = anim.fps
  }

  return { textureMap, fpsMap }
}

/**
 * Load a PNG-based creature from the user manifest.
 * Manifest entries point to image paths relative to assets/sprites/.
 * This is the extension point — drop PNGs into assets/sprites/,
 * describe them in manifest.json, and they appear as new creature types.
 */
export interface ManifestCreature {
  id: string
  displayName: string
  scale?: number
  spriteSheet?: string
  animations?: Record<
    string,
    {
      fps: number
      frames: string[] // paths relative to assets/sprites/
    }
  >
}

export async function loadManifestCreature(
  manifestEntry: ManifestCreature
): Promise<{ textureMap: Record<string, PIXI.Texture[]>; fpsMap: Record<string, number> }> {
  const textureMap: Record<string, PIXI.Texture[]> = {}
  const fpsMap: Record<string, number> = {}

  if (manifestEntry.spriteSheet) {
    // Replace .png with .json to load the Pixi spritesheet bundle
    const jsonPath = `/assets/sprites/${manifestEntry.spriteSheet.replace('.png', '.json')}`
    try {
      const sheet = await PIXI.Assets.load(jsonPath)
      if (sheet && sheet.animations) {
        for (const [state, textures] of Object.entries(sheet.animations)) {
          const texArray = textures as PIXI.Texture[]
          for (const tex of texArray) {
            tex.source.scaleMode = 'nearest'
          }
          textureMap[state] = texArray
          fpsMap[state] = sheet.data?.meta?.framerate || 8 // default to 8 fps if missing
        }
      }
    } catch (e) {
      console.error(`Failed to load spritesheet JSON for ${manifestEntry.id}:`, e)
    }
  } else if (manifestEntry.animations) {
    // Legacy fallback
    for (const [state, anim] of Object.entries(manifestEntry.animations)) {
      const textures: PIXI.Texture[] = []
      for (const path of anim.frames) {
        const texture = await PIXI.Assets.load(path)
        texture.source.scaleMode = 'nearest'
        textures.push(texture)
      }
      textureMap[state] = textures
      fpsMap[state] = anim.fps
    }
  }

  // Ensure idle always exists or falls back to first available animation
  if (!textureMap['idle'] && Object.keys(textureMap).length > 0) {
    textureMap['idle'] = Object.values(textureMap)[0]
    fpsMap['idle'] = Object.values(fpsMap)[0] || 8
  }

  return { textureMap, fpsMap }
}
