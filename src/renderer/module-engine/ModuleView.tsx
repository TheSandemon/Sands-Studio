// =============================================================================
// Module Engine — ModuleView
// React component that takes over the canvas when a module is running.
// =============================================================================

import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Application, Assets, Container, Graphics } from 'pixi.js'
import { TileMap } from './TileMap'
import { EntityRenderer } from './EntityRenderer'
import { UIRenderer } from './UIRenderer'
import { Camera } from './Camera'
import { useModuleStore } from '../stores/useModuleStore'
import { useSettingsStore } from '../store/useSettingsStore'
import type {
  ModuleManifest,
  ModuleRendererEvent,
  Entity,
  SerializedWorldState,
} from '../module-engine/types'

// ── Asset Resolver ─────────────────────────────────────────────────────────────

function createAssetResolver(
  textureMap: Map<string, PIXI.Texture>
): (tag: string, category: 'tile' | 'entity' | 'effect') => PIXI.Texture | null {
  return (tag: string, category: 'tile' | 'entity' | 'effect'): PIXI.Texture | null => {
    return textureMap.get(`${category}:${tag}`) ?? null
  }
}

// ── ModuleView ────────────────────────────────────────────────────────────────

interface ModuleViewProps {
  manifest: ModuleManifest
  onBack?: () => void
}

export default function ModuleView({ manifest, onBack }: ModuleViewProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const tileMapRef = useRef<TileMap | null>(null)
  const entityRendererRef = useRef<EntityRenderer | null>(null)
  const uiRendererRef = useRef<UIRenderer | null>(null)
  const cameraRef = useRef<Camera | null>(null)
  const unsubscribesRef = useRef<Array<() => void>>([])
  const cameraCenteredRef = useRef(false)
  const [loadingLog, setLoadingLog] = useState<string[]>([`Loading ${manifest.name}…`])
  const [hasAgentActivity, setHasAgentActivity] = useState(false)
  const hasAgentActivityRef = useRef(false)
  const prevAgentStatusesRef = useRef<Record<string, string>>({})

  const addLog = useCallback((msg: string) => {
    setLoadingLog((prev) => [...prev, msg])
  }, [])

  const agentStatuses = useModuleStore((s) => s.agentStatuses)
  const status = useModuleStore((s) => s.status)
  const worldState = useModuleStore((s) => s.worldState)
  const assetPaths = useModuleStore((s) => s.assetPaths)

  // Wire up IPC event listeners
  const setupListeners = useCallback(() => {
    const store = useModuleStore.getState()

    const unsubEvent = window.moduleAPI.onEvent((event: unknown) => {
      const e = event as ModuleRendererEvent
      store.pushRendererEvent(e)

      // Handle camera events
      if (e.type === 'round_started' && cameraRef.current) {
        // Could pan camera to overview
      }
    })

    const unsubState = window.moduleAPI.onState((state: unknown) => {
      const ws = state as SerializedWorldState
      store.setWorldState(ws)

      // Sync entities
      if (entityRendererRef.current && ws.entities) {
        const tileSize = manifest.renderer.gridSize ?? 32
        entityRendererRef.current.sync(ws.entities as unknown as Entity[], tileSize)
      }

      // Sync grid
      if (tileMapRef.current && ws.grid) {
        tileMapRef.current.setGrid(ws.grid as any)
        // Center camera on the grid the first time world state arrives
        if (cameraRef.current && !cameraCenteredRef.current) {
          cameraCenteredRef.current = true
          const grid = ws.grid as any
          const tileSize = manifest.renderer.gridSize ?? 32
          cameraRef.current.panTo(
            (grid.width * tileSize) / 2,
            (grid.height * tileSize) / 2,
            false
          )
        }
      }
    })

    const unsubAgentStatus = window.moduleAPI.onAgentStatus((roleId: string, status: string) => {
      store.setAgentStatus(roleId, status as any)
    })

    const unsubStatus = window.moduleAPI.onStatus((status: string) => {
      store.setStatus(status as any)
    })

    unsubscribesRef.current = [unsubEvent, unsubState, unsubAgentStatus, unsubStatus]
  }, [manifest])

  // Initialize Pixi app
  useEffect(() => {
    if (!canvasRef.current) return

    // Setup IPC listeners FIRST so we don't miss any status/event messages
    // that arrive while the canvas is still initializing
    setupListeners()
    addLog('IPC listeners attached')

    const { canvasWidth, canvasHeight, backgroundColor } = manifest.renderer

    addLog('Initializing Pixi canvas…')
    const app = new Application()
    appRef.current = app

    app.init({
      width: canvasWidth,
      height: canvasHeight,
      backgroundColor,
      antialias: false,
      resolution: window.devicePixelRatio ?? 1,
      autoDensity: true,
    }).then(async () => {
      if (!canvasRef.current) return
      canvasRef.current.appendChild(app.canvas as HTMLCanvasElement)
      ;(app.canvas as HTMLCanvasElement).style.display = 'block'
      ;(app.canvas as HTMLCanvasElement).style.imageRendering = 'pixelated'

      // Preload module assets
      const textureMap = new Map<string, PIXI.Texture>()
      const assetEntries = Object.entries(assetPaths)
      if (assetEntries.length > 0) {
        addLog(`Loading ${assetEntries.length} assets…`)
        await Promise.all(
          assetEntries.map(async ([key, filePath]) => {
            try {
              const url = 'file:///' + filePath.replace(/\\/g, '/')
              const texture = await Assets.load(url)
              textureMap.set(key, texture)
            } catch {
              // Asset failed to load — placeholder rendering will be used
            }
          })
        )
        addLog(`${textureMap.size}/${assetEntries.length} assets loaded`)
      }

      addLog('Canvas ready — building scene layers…')

      const resolver = createAssetResolver(textureMap)

      // Layer 1: Camera viewport — world content (tiles + entities) lives inside here
      const camera = new Camera(app)
      cameraRef.current = camera

      // Layer 2: Tile map — inside camera viewport so it scrolls with the world
      const tileMap = new TileMap(camera.container, resolver, manifest.renderer.showGrid)
      tileMapRef.current = tileMap

      // Layer 3: Entity renderer — inside camera viewport so it scrolls with the world
      const entityRenderer = new EntityRenderer(camera.container, resolver)
      entityRendererRef.current = entityRenderer

      // Layer 4: UI overlay — on app.stage directly, does NOT scroll (HUD)
      const uiRenderer = new UIRenderer(app.stage, canvasWidth, canvasHeight, resolver, app.ticker)
      uiRenderer.setEntityRenderer(entityRenderer)
      uiRenderer.setEntityPositionResolver((entityId: string) => {
        const sprite = entityRenderer.getSprite(entityId)
        if (!sprite) return null
        return camera.worldToScreen(sprite.x, sprite.y)
      })
      uiRendererRef.current = uiRenderer

      // Game tick loop
      app.ticker.add((ticker) => {
        const delta = ticker.deltaTime

        camera.update(delta)
        entityRenderer.update(delta)
        uiRenderer.tick()

        // Drain and handle pending renderer events
        const store = useModuleStore.getState()
        const events = store.drainRendererEvents()
        const tileSize = manifest.renderer.gridSize ?? 32
        for (const event of events) {
          uiRenderer.handleEvent(event)

          if (event.type === 'entity_moved') {
            entityRenderer.animateMove(event.entityId, event.from, event.to, tileSize)
          }
          if (event.type === 'entity_created') {
            entityRenderer.addEntity(event.entity, tileSize)
          }
          if (event.type === 'entity_removed') {
            entityRenderer.removeEntity(event.entityId)
          }
          if (event.type === 'tile_changed' && tileMapRef.current) {
            const tile = store.worldState?.grid?.tiles[event.row]?.[event.col]
            if (tile) tileMapRef.current.updateTile(event.col, event.row, tile)
          }
        }
      })

      // Start the orchestrator now that listeners and canvas are ready
      addLog('Starting orchestrator…')
      const { defaultModel, defaultBaseURL, defaultApiKey } = useSettingsStore.getState()
      window.moduleAPI.startModule({
        model: defaultModel || undefined,
        baseURL: defaultBaseURL || undefined,
        apiKey: defaultApiKey || undefined,
      })
        .then(() => addLog('Orchestrator started — waiting for agents…'))
        .catch((err: unknown) => addLog(`Error starting orchestrator: ${String(err)}`))
    }).catch((err: unknown) => {
      addLog(`Canvas init failed: ${String(err)}`)
    })

    return () => {
      // Cleanup
      for (const unsub of unsubscribesRef.current) {
        unsub()
      }
      unsubscribesRef.current = []

      tileMapRef.current?.destroy()
      entityRendererRef.current?.destroy()
      uiRendererRef.current?.destroy()
      app.destroy(true, { children: true })
      appRef.current = null
    }
  }, [manifest, setupListeners, addLog, assetPaths])

  // Safety timeout: force-hide loading screen after 10s in case agents never start
  useEffect(() => {
    const t = setTimeout(() => {
      if (!hasAgentActivityRef.current) {
        hasAgentActivityRef.current = true
        setHasAgentActivity(true)
        addLog('Timeout — proceeding anyway')
      }
    }, 10_000)
    return () => clearTimeout(t)
  }, [addLog])

  // Log agent status transitions and detect first agent activity
  useEffect(() => {
    for (const [roleId, st] of Object.entries(agentStatuses)) {
      const prev = prevAgentStatusesRef.current[roleId]
      if (prev === st) continue
      prevAgentStatusesRef.current[roleId] = st

      if (st === 'idle' && prev === undefined) {
        addLog(`Agent ${roleId}: initialized`)
      } else if (st === 'thinking') {
        addLog(`Agent ${roleId}: calling AI…`)
        if (!hasAgentActivityRef.current) {
          hasAgentActivityRef.current = true
          setHasAgentActivity(true)
        }
      } else if (st === 'error') {
        addLog(`Agent ${roleId}: ERROR — check API key or agent config`)
        if (!hasAgentActivityRef.current) {
          hasAgentActivityRef.current = true
          setHasAgentActivity(true)
        }
      }
    }
  }, [agentStatuses, addLog])

  return (
    <div
      style={{
        position: 'relative',
        width: manifest.renderer.canvasWidth,
        height: manifest.renderer.canvasHeight,
        background: `#${manifest.renderer.backgroundColor.toString(16).padStart(6, '0')}`,
        overflow: 'hidden',
      }}
    >
      {/* Pixi canvas container */}
      <div ref={canvasRef} style={{ width: '100%', height: '100%' }} />

      {/* Loading overlay — shown until an agent starts or errors, or the 10s timeout fires */}
      {!hasAgentActivity && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(13,13,26,0.96)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          <div style={{ fontSize: 13, color: '#ccc', marginBottom: 20 }}>
            {manifest.name}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minWidth: 320,
            }}
          >
            {loadingLog.map((msg, i) => {
              const isLast = i === loadingLog.length - 1
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 11,
                    color: isLast ? '#44aaff' : '#444',
                  }}
                >
                  <span style={{ width: 12, textAlign: 'center' }}>
                    {isLast ? '▶' : '✓'}
                  </span>
                  <span>{msg}</span>
                </div>
              )
            })}
          </div>
          <div
            style={{
              marginTop: 24,
              width: 200,
              height: 2,
              background: '#1a1a2e',
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: '40%',
                background: '#44aaff',
                borderRadius: 1,
                animation: 'pulse-bar 1.2s ease-in-out infinite',
              }}
            />
          </div>
          <style>{`
            @keyframes pulse-bar {
              0%   { transform: translateX(-100%); }
              100% { transform: translateX(350%); }
            }
          `}</style>
        </div>
      )}

      {/* Module HUD overlay */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          alignItems: 'flex-end',
        }}
      >
        {/* Status badge */}
        <div
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            background: 'rgba(0,0,0,0.6)',
            color: status === 'running' ? '#44ff44' : status === 'paused' ? '#ffaa44' : '#888',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
          }}
        >
          {status.toUpperCase()} — {manifest.name}
        </div>

        {/* Agent statuses */}
        {Object.entries(agentStatuses).map(([roleId, agentStatus]) => (
          <div
            key={roleId}
            style={{
              padding: '2px 8px',
              borderRadius: 3,
              background: 'rgba(0,0,0,0.5)',
              color:
                agentStatus === 'thinking' ? '#44aaff'
                : agentStatus === 'done' ? '#44ff44'
                : agentStatus === 'error' ? '#ff4444'
                : '#888888',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 9,
            }}
          >
            {roleId}: {agentStatus}
          </div>
        ))}

        {/* Tick counter */}
        {worldState && (
          <div
            style={{
              padding: '2px 8px',
              borderRadius: 3,
              background: 'rgba(0,0,0,0.5)',
              color: '#666',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 9,
            }}
          >
            Tick: {worldState.tick} {worldState.round !== undefined ? `| Round: ${worldState.round}` : ''}
          </div>
        )}
      </div>

      {/* Stop button */}
      <button
        onClick={() => {
          window.moduleAPI.stopModule()
          onBack?.()
        }}
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          padding: '6px 16px',
          borderRadius: 4,
          border: '1px solid #ff4444',
          background: 'rgba(255,68,68,0.1)',
          color: '#ff4444',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        Stop Module
      </button>

      {/* Pause/Resume */}
      {status === 'running' && (
        <button
          onClick={() => window.moduleAPI.pauseModule()}
          style={{
            position: 'absolute',
            bottom: 12,
            right: 110,
            padding: '6px 16px',
            borderRadius: 4,
            border: '1px solid #ffaa44',
            background: 'rgba(255,170,68,0.1)',
            color: '#ffaa44',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Pause
        </button>
      )}
      {status === 'paused' && (
        <button
          onClick={() => window.moduleAPI.resumeModule()}
          style={{
            position: 'absolute',
            bottom: 12,
            right: 110,
            padding: '6px 16px',
            borderRadius: 4,
            border: '1px solid #44ff44',
            background: 'rgba(68,255,68,0.1)',
            color: '#44ff44',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Resume
        </button>
      )}
    </div>
  )
}
