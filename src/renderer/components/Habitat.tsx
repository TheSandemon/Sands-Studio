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
import { BUILTIN_CREATURES, EGG_CREATURE } from '../creatures/builtinCreatures'
import { buildCreatureTextures, type TextureMap, type FpsMap } from '../creatures/spriteSystem'
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
  bakedRef: React.MutableRefObject<Map<string, BakedCreature>>,
  creatureTypeRef: React.MutableRefObject<Map<string, string>>,
  territoryRef: React.MutableRefObject<Map<string, Territory>>
): void {
  if (!app.stage) return

  const terminalIds = new Set(terminals.map((t) => t.id))

  // Remove creatures for deleted terminals
  for (const [id, creature] of creaturesRef.current) {
    if (!terminalIds.has(id)) {
      app.stage.removeChild(creature.container)
      creature.destroy()
      creaturesRef.current.delete(id)
      creatureTypeRef.current.delete(id)
      territoryRef.current.delete(id)
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
    territoryRef.current.set(t.id, territory)

    if (!creaturesRef.current.has(t.id)) {
      // New terminals spawn as eggs; hatched ones use blob
      const defId = creatureTypeRef.current.get(t.id) ?? (t.hatched ? 'blob' : 'egg')
      creatureTypeRef.current.set(t.id, defId)
      const baked = bakedRef.current.get(defId)
      if (!baked) return

      const creature = new Creature(t.id, baked.textureMap, baked.fpsMap, territory)
      creaturesRef.current.set(t.id, creature)
      app.stage.addChild(creature.container)
    } else {
      creaturesRef.current.get(t.id)!.setTerritory(territory)
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
  const bakedRef = useRef<Map<string, BakedCreature>>(new Map())
  const creatureTypeRef = useRef<Map<string, string>>(new Map())
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
    }).then(() => {
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

      app.ticker.add((ticker) => {
        for (const creature of creaturesRef.current.values()) {
          creature.update(ticker.deltaTime)
        }
      })

      syncCreatures(app, terminalsRef.current, creaturesRef, bakedRef, creatureTypeRef, territoryRef)

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

    syncCreatures(app, terminals, creaturesRef, bakedRef, creatureTypeRef, territoryRef)

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

  // ---------------------------------------------------------------------------
  // Listen for hatch events — swap EGG creature → BLOB
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const off = window.agentAPI.onEvent((terminalId, type) => {
      if (type !== 'hatch') return

      const app = appRef.current
      if (!app) return

      const baked = bakedRef.current.get('blob')
      if (!baked) return

      const territory = territoryRef.current.get(terminalId)
      if (!territory) return

      const existing = creaturesRef.current.get(terminalId)
      const savedX = existing?.container.x ?? territory.x + territory.width / 2
      const savedY = existing?.container.y ?? territory.y + territory.height / 2

      if (existing) {
        app.stage.removeChild(existing.container)
        existing.destroy()
      }

      creatureTypeRef.current.set(terminalId, 'blob')
      const blob = new Creature(terminalId, baked.textureMap, baked.fpsMap, territory)
      blob.container.x = savedX
      blob.container.y = savedY
      blob.speedMultiplier = speedRef.current
      creaturesRef.current.set(terminalId, blob)
      app.stage.addChild(blob.container)
      blob.setState('idle')

      // Apply name label after hatch (store update is async, use terminalsRef)
      const t = terminalsRef.current.find((t) => t.id === terminalId)
      blob.setName(t?.creatureName, showNamesRef.current)
    })

    return off
  }, [])

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
