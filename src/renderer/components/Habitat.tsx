/**
 * Habitat.tsx
 *
 * The Pixi.js creature habitat — a living canvas above the terminals.
 * Each terminal session gets one creature that wanders in its territory,
 * and changes animation state to reflect what the terminal is doing.
 */

import { useEffect, useRef } from 'react'
import * as PIXI from 'pixi.js'
import { useTerminalStore, type TerminalSession, type TerminalState } from '../store/useTerminalStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { Creature, type Territory } from '../creatures/Creature'
import { ComputerIcon } from '../creatures/ComputerIcon'
import { BUILTIN_CREATURES, EGG_CREATURE } from '../creatures/builtinCreatures'
import { buildCreatureTextures, loadManifestCreature, type TextureMap, type FpsMap } from '../creatures/spriteSystem'
import manifest from '../../../public/assets/sprites/manifest.json'
import './Habitat.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface BakedCreature {
  textureMap: TextureMap
  fpsMap: FpsMap
}

type CreatureStateName = TerminalState

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function speedMultiplierFor(speed: 'slow' | 'normal' | 'fast'): number {
  return speed === 'slow' ? 0.4 : speed === 'fast' ? 2.0 : 1.0
}

// ---------------------------------------------------------------------------
// Starfield background helper
// ---------------------------------------------------------------------------
function buildStarfield(app: PIXI.Application, count = 120): PIXI.Graphics {
  const g = new PIXI.Graphics()
  for (let i = 0; i < count; i++) {
    const x = Math.random() * app.screen.width
    const y = Math.random() * app.screen.height
    const r = Math.random() < 0.15 ? 1.5 : 0.8
    const alpha = 0.2 + Math.random() * 0.6
    g.circle(x, y, r).fill({ color: 0xffffff, alpha })
  }
  return g
}

// ---------------------------------------------------------------------------
// Standalone creature sync — called from both the init .then() and useEffect
// ---------------------------------------------------------------------------
function syncCreatures(
  app: PIXI.Application,
  terminals: TerminalSession[],
  creaturesRef: React.MutableRefObject<Map<string, Creature>>,
  iconsRef: React.MutableRefObject<Map<string, ComputerIcon>>,
  bakedRef: React.MutableRefObject<Map<string, BakedCreature>>,
  creatureTypeRef: React.MutableRefObject<Map<string, string>>,
  territoryRef: React.MutableRefObject<Map<string, Territory>>,
  spriteTextureMapsRef: React.MutableRefObject<Record<string, Record<string, PIXI.Texture[]>>>,
  spriteFpsMapsRef: React.MutableRefObject<Record<string, Record<string, number>>>
): void {
  if (!app.stage) return

  const terminalIds = new Set(terminals.map((t) => t.id))
  
  // Use .current to access the map
  const territoryMap = territoryRef.current

  // Remove creatures/icons for deleted terminals
  for (const [id, creature] of creaturesRef.current) {
    if (!terminalIds.has(id)) {
      app.stage.removeChild(creature.container)
      creature.destroy()
      creaturesRef.current.delete(id)
      
      const icon = iconsRef.current.get(id)
      if (icon) {
        app.stage.removeChild(icon.container)
        icon.destroy()
        iconsRef.current.delete(id)
      }
      
      creatureTypeRef.current.delete(id)
      territoryMap.delete(id)
    }
  }

  const count = terminals.length
  if (count === 0) return

  const W = app.screen.width || 800
  const H = app.screen.height || 220
  const sectionW = W / count

  terminals.forEach((t, i) => {
    const territory: Territory = {
      x: i * sectionW + 4,
      y: 4,
      width: sectionW - 8,
      height: H - 8
    }
    territoryMap.set(t.id, territory)

    // Ensure icon exists/updated
    let icon = iconsRef.current.get(t.id)
    if (!icon) {
      icon = new ComputerIcon(t.id, territory)
      iconsRef.current.set(t.id, icon)
      app.stage.addChild(icon.container)
    } else {
      icon.setPosition(territory)
    }
    icon.setState(t.state as TerminalState)
    icon.setActive(t.visible !== false)

    const spriteId = t.shellConfig?.creature?.spriteId
    let currentDefId = creatureTypeRef.current.get(t.id)
    let defId = spriteId ?? currentDefId ?? (t.hatched ? '' : 'egg')
    
    // Fallback: if hatched but no sprite assigned (or still an egg), pick a random manifest sprite
    if (t.hatched && !spriteId && (!defId || defId === 'egg')) {
      const keys = Object.keys(spriteTextureMapsRef.current)
      if (keys.length > 0) {
        defId = keys[Math.floor(Math.random() * keys.length)]
        
        // Persist so choice survives terminal array re-renders
        const store = useTerminalStore.getState()
        store.setShellConfig(t.id, {
          ...(t.shellConfig || { id: t.id }),
          id: t.id,
          creature: {
            ...(t.shellConfig?.creature || { id: t.id }),
            id: t.id,
            hatched: t.hatched,
            spriteId: defId
          }
        } as any)
      } else {
        defId = 'egg'
      }
    }

    const isTransforming = currentDefId && currentDefId !== defId
    creatureTypeRef.current.set(t.id, defId)

    let baked = bakedRef.current.get(defId)
    // Fall back to sprite textures if not a built-in
    if (!baked && spriteTextureMapsRef.current[defId]) {
      baked = { textureMap: spriteTextureMapsRef.current[defId] as TextureMap, fpsMap: spriteFpsMapsRef.current[defId] as FpsMap }
    }
    
    // If still no baked definition found (e.g. manifest not loaded), skip creation until next sync
    if (!baked) return

    const existing = creaturesRef.current.get(t.id)
    if (!existing) {
      const creature = new Creature(t.id, baked.textureMap, baked.fpsMap, territory, icon)
      creaturesRef.current.set(t.id, creature)
      app.stage.addChild(creature.container)
    } else if (isTransforming) {
      const savedX = existing.container.x
      const savedY = existing.container.y
      app.stage.removeChild(existing.container)
      existing.destroy()

      const creature = new Creature(t.id, baked.textureMap, baked.fpsMap, territory, icon)
      creature.container.x = savedX
      creature.container.y = savedY
      creaturesRef.current.set(t.id, creature)
      app.stage.addChild(creature.container)
    } else {
      existing.setTerritory(territory)
      // also strictly pass computerIcon updates if existing:
      existing.setComputerIcon(icon)
    }

    // Sync state
    const creature = creaturesRef.current.get(t.id)
    if (creature) creature.setState(t.state as CreatureStateName)
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function Habitat() {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const creaturesRef = useRef<Map<string, Creature>>(new Map())
  const iconsRef = useRef<Map<string, ComputerIcon>>(new Map())
  const bakedRef = useRef<Map<string, BakedCreature>>(new Map())
  const creatureTypeRef = useRef<Map<string, string>>(new Map())
  const spriteTextureMapsRef = useRef<Record<string, Record<string, PIXI.Texture[]>>>({})
  const spriteFpsMapsRef = useRef<Record<string, Record<string, number>>>({})
  const territoryRef = useRef<Map<string, Territory>>(new Map())

  const terminals = useTerminalStore((s) => s.terminals)
  const terminalsRef = useRef(terminals)

  const creatureSpeed    = useSettingsStore((s) => s.creatureSpeed)
  const showCreatureNames = useSettingsStore((s) => s.showCreatureNames)
  // Refs so effects can read latest values without stale closures
  const speedRef     = useRef(speedMultiplierFor(creatureSpeed))
  const showNamesRef = useRef(showCreatureNames)

  // ---------------------------------------------------------------------------
  // Init Pixi app once
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    let cancelled = false

    const app = new PIXI.Application()
    appRef.current = app

    app.init({
      background: 0x0d0d1a,
      resizeTo: el,
      antialias: false,
      resolution: window.devicePixelRatio ?? 1,
      autoDensity: true
    }).then(async () => {
      if (cancelled) return

      el.appendChild(app.canvas as HTMLCanvasElement)
      ;(app.canvas as HTMLCanvasElement).classList.add('habitat-canvas')

      app.stage.addChild(buildStarfield(app))

      // Bake all creature textures (built-ins + egg)
      const renderer = app.renderer as PIXI.Renderer
      for (const def of [...BUILTIN_CREATURES, EGG_CREATURE]) {
        const { textureMap, fpsMap } = buildCreatureTextures(renderer, def)
        bakedRef.current.set(def.id, { textureMap, fpsMap })
      }

      // Load PNG spritesheets from manifest
      const textureMaps: Record<string, Record<string, PIXI.Texture[]>> = {}
      const fpsMaps: Record<string, Record<string, number>> = {}

      for (const entry of manifest.creatures) {
        const { textureMap, fpsMap } = await loadManifestCreature(entry as any)
        textureMaps[entry.id] = textureMap
        fpsMaps[entry.id] = fpsMap
      }
      
      spriteTextureMapsRef.current = textureMaps
      spriteFpsMapsRef.current = fpsMaps

      app.ticker.add((ticker) => {
        for (const creature of creaturesRef.current.values()) {
          creature.update(ticker.deltaTime)
        }
      })

      syncCreatures(app, terminalsRef.current, creaturesRef, iconsRef, bakedRef, creatureTypeRef, territoryRef, spriteTextureMapsRef, spriteFpsMapsRef)

      // Apply initial settings to any creatures that were just created
      applySpeedToAll(creaturesRef, speedRef.current)
      applyNamesToAll(creaturesRef, terminalsRef.current, showNamesRef.current)
    }).catch((err) => {
      if (!cancelled) console.error('[Habitat] Pixi init failed:', err)
    })

    return () => {
      cancelled = true
      app.destroy(true, { children: true })
      appRef.current = null
      creaturesRef.current.clear()
      bakedRef.current.clear()
      creatureTypeRef.current.clear()
      territoryRef.current.clear()
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Keep terminalsRef current + sync creatures when terminals change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    terminalsRef.current = terminals

    const app = appRef.current
    if (!app || !bakedRef.current.size) return

    syncCreatures(app, terminals, creaturesRef, iconsRef, bakedRef, creatureTypeRef, territoryRef, spriteTextureMapsRef, spriteFpsMapsRef)

    // After sync, apply current speed + names to all creatures (including new ones)
    applySpeedToAll(creaturesRef, speedRef.current)
    applyNamesToAll(creaturesRef, terminals, showNamesRef.current)
  }, [terminals])

  // ---------------------------------------------------------------------------
  // Creature speed setting
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const m = speedMultiplierFor(creatureSpeed)
    speedRef.current = m
    applySpeedToAll(creaturesRef, m)
  }, [creatureSpeed])

  // ---------------------------------------------------------------------------
  // Show creature names setting
  // ---------------------------------------------------------------------------
  useEffect(() => {
    showNamesRef.current = showCreatureNames
    applyNamesToAll(creaturesRef, terminalsRef.current, showCreatureNames)
  }, [showCreatureNames])



  return <div ref={containerRef} className="habitat" />
}

// ---------------------------------------------------------------------------
// Pure helpers (outside component to avoid re-creation)
// ---------------------------------------------------------------------------
function applySpeedToAll(
  creaturesRef: React.MutableRefObject<Map<string, Creature>>,
  multiplier: number
): void {
  for (const creature of creaturesRef.current.values()) {
    creature.speedMultiplier = multiplier
  }
}

function applyNamesToAll(
  creaturesRef: React.MutableRefObject<Map<string, Creature>>,
  terminals: TerminalSession[],
  visible: boolean
): void {
  const termMap = new Map(terminals.map((t) => [t.id, t]))
  for (const [id, creature] of creaturesRef.current) {
    const t = termMap.get(id)
    creature.setName(t?.creatureName, visible)
  }
}

