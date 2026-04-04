/**
 * Habitat.tsx
 *
 * The Pixi.js creature habitat — a living canvas above the terminals.
 * Each shell agent gets a sprite that stands by its PC icon.
 * A Mermaid flowchart workspace renders in the background layer;
 * the Pixi canvas overlays it with a transparent background so
 * sprites can physically walk across the diagram.
 */

import { useEffect, useRef, useState } from 'react'
import * as PIXI from 'pixi.js'
import { useTerminalStore, type TerminalSession, type TerminalState } from '../store/useTerminalStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useFlowchartStore } from '../store/useFlowchartStore'
import { Creature, type Territory } from '../creatures/Creature'
import { ComputerIcon } from '../creatures/ComputerIcon'
import { BUILTIN_CREATURES, EGG_CREATURE } from '../creatures/builtinCreatures'
import { buildCreatureTextures, loadManifestCreature, type TextureMap, type FpsMap } from '../creatures/spriteSystem'
import manifest from '../../../public/assets/sprites/manifest.json'
import FlowchartWorkspace from './FlowchartWorkspace'
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
  spriteFpsMapsRef: React.MutableRefObject<Record<string, Record<string, number>>>,
  flowchartDimensions: { width: number, height: number },
  flowchartNodes: import('../store/useFlowchartStore').FlowchartNodeCoords[],
  cam: { x: number; y: number; scale: number } = { x: 0, y: 0, scale: 1 }
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

  let W = Math.max(800, count * 150)
  let H = 220

  // Fallback: center of flowchart dimensions
  let startX = (flowchartDimensions.width / 2) - (W / 2)
  let startY = flowchartDimensions.height + 100

  if (flowchartNodes && flowchartNodes.length > 0) {
    const terminalHub = flowchartNodes.find((n) => n.id === 'TerminalHub' || n.label.includes('Active Shells'))

    if (terminalHub) {
      // node.x/y are already in camera-local (SVG) space.
      // Canvas is also in the camera div => same coordinate space, no transform needed.
      startX = terminalHub.x - terminalHub.width / 2
      W = terminalHub.width
      startY = (terminalHub.y - terminalHub.height / 2) + 20
      H = terminalHub.height - 40
    }
  }

  const sectionW = W / count

  terminals.forEach((t, i) => {
    const territory: Territory = {
      x: startX + i * sectionW,
      y: startY,
      width: sectionW,
      height: H
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
  const cameraRef = useRef<HTMLDivElement>(null)
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

  const flowchartDimensions = useFlowchartStore((s) => s.dimensions)
  const flowchartDimensionsRef = useRef(flowchartDimensions)

  const creatureSpeed    = useSettingsStore((s) => s.creatureSpeed)
  const showCreatureNames = useSettingsStore((s) => s.showCreatureNames)
  const habitatBackground = useSettingsStore((s) => s.habitatBackground)
  // Refs so effects can read latest values without stale closures
  const speedRef     = useRef(speedMultiplierFor(creatureSpeed))
  const showNamesRef = useRef(showCreatureNames)

  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 })
  const cameraRef2 = useRef({ x: 0, y: 0, scale: 1 })  // mirror for use in effects
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

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
      backgroundAlpha: 0,
      resizeTo: el,
      antialias: false,
      resolution: window.devicePixelRatio ?? 1,
      autoDensity: true
    }).then(async () => {
      if (cancelled) return

      const targetEl = cameraRef.current || el
      targetEl.appendChild(app.canvas as HTMLCanvasElement)
      ;(app.canvas as HTMLCanvasElement).classList.add('habitat-canvas')

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

      // Setup robust resize observer to prevent Pixi canvas squishing
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === el) {
            const { width, height } = entry.contentRect
            if (width > 0 && height > 0) {
              app.renderer.resize(width, height)
            }
          }
        }
      })
      ro.observe(el)

      app.ticker.add((ticker) => {
        for (const creature of creaturesRef.current.values()) {
          creature.update(ticker.deltaTime)
        }
      })

      // Cleanup
      const oldDestroy = app.destroy.bind(app)
      app.destroy = (...args: any[]) => {
        ro.disconnect()
        oldDestroy(...args)
      }

      syncCreatures(app, terminalsRef.current, creaturesRef, iconsRef, bakedRef, creatureTypeRef, territoryRef, spriteTextureMapsRef, spriteFpsMapsRef, flowchartDimensionsRef.current, useFlowchartStore.getState().nodes)

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

  // Sync camera state into a ref so effects can read it without stale closure
  useEffect(() => {
    cameraRef2.current = camera
  }, [camera])

  // ---------------------------------------------------------------------------
  // Keep terminalsRef current + sync creatures when terminals change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    terminalsRef.current = terminals
    flowchartDimensionsRef.current = flowchartDimensions

    const app = appRef.current
    if (!app || !bakedRef.current.size) return

    syncCreatures(app, terminals, creaturesRef, iconsRef, bakedRef, creatureTypeRef, territoryRef, spriteTextureMapsRef, spriteFpsMapsRef, flowchartDimensions, useFlowchartStore.getState().nodes)

    // After sync, apply current speed + names to all creatures (including new ones)
    applySpeedToAll(creaturesRef, speedRef.current)
    applyNamesToAll(creaturesRef, terminals, showNamesRef.current)
  // Note: camera intentionally NOT in deps — icon positions only change when the
  // flowchart graph re-renders (flowchartNodes change) or terminals change.
  // Camera changes are handled by the claims effect below which re-targets walking agents.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminals, flowchartDimensions])

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

  // Determine cwd for flowchart discovery from first terminal's shell config
  const firstTerminal = terminals[0]
  const flowchartCwd = firstTerminal?.shellConfig?.cwd || undefined
  const flowchartVisible = useFlowchartStore((s) => s.visible)
  const flowchartNodes = useFlowchartStore((s) => s.nodes)
  const flowchartClaims = useFlowchartStore((s) => s.claims)

  // ── Feed flowchart node coords to claimed creatures (re-runs on camera change for live tracking) ──
  useEffect(() => {
    if (flowchartNodes.length === 0) return

    for (const [nodeId, creatureId] of Object.entries(flowchartClaims)) {
      const creature = creaturesRef.current.get(creatureId)
      if (!creature) continue

      const node = flowchartNodes.find((n) => n.id === nodeId)
      if (!node) continue

      // Canvas and SVG are both inside the camera div => same local coordinate space
      creature.setFlowchartTarget(node.x, node.y)
    }

    // Clear flowchart target for unclaimed creatures
    for (const [id, creature] of creaturesRef.current) {
      const isClaimed = Object.values(flowchartClaims).includes(id)
      if (!isClaimed) {
        creature.clearFlowchartTarget()
      }
    }
  }, [flowchartNodes, flowchartClaims, camera])

  // ── Pan and Zoom Handlers ───────────────────────────────────────────────
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault()
      const zoomSensitivity = 0.002
      let newScale = camera.scale - e.deltaY * zoomSensitivity
      newScale = Math.max(0.1, Math.min(newScale, 5))

      const el = containerRef.current
      if (!el) return

      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const ds = newScale - camera.scale
      const tx = camera.x - (mouseX - camera.x) * (ds / camera.scale)
      const ty = camera.y - (mouseY - camera.y) * (ds / camera.scale)

      setCamera({ x: tx, y: ty, scale: newScale })
    } else {
      setCamera(c => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }))
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 1) { // 1 is middle mouse button
      e.preventDefault()
      isDragging.current = true
      lastPos.current = { x: e.clientX, y: e.clientY }
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging.current) {
      e.preventDefault()
      const dx = e.clientX - lastPos.current.x
      const dy = e.clientY - lastPos.current.y
      setCamera(c => ({ ...c, x: c.x + dx, y: c.y + dy }))
      lastPos.current = { x: e.clientX, y: e.clientY }
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.button === 1) {
      isDragging.current = false
    }
  }

  return (
    <div 
      ref={containerRef} 
      className={`habitat bg-${habitatBackground}`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      style={{
        backgroundPosition: `${camera.x * 0.5}px ${camera.y * 0.5}px`
      }}
    >
      <div 
        ref={cameraRef}
        className="habitat-camera"
        style={{ 
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          transformOrigin: '0 0'
        }}
      >
        {/* Flowchart renders behind the Pixi canvas */}
        <FlowchartWorkspace cwd={flowchartCwd} />
      </div>
    </div>
  )
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

