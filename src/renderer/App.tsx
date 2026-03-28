import React, { useState, useEffect, useRef } from 'react'
import Habitat from './components/Habitat'
import TerminalPane from './components/TerminalPane'
import WindowControls from './components/WindowControls'
import MenuBar from './components/MenuBar'
import SettingsDialog from './components/SettingsDialog'
import ModuleSettingsDialog from './components/ModuleSettingsDialog'
import BootstrapTerminal from './components/BootstrapTerminal'
import ModuleCreatorV2 from './components/ModuleCreatorV2'
import HabitatSaveDialog from './components/HabitatSaveDialog'
import HabitatManagerDialog from './components/HabitatManagerDialog'
import ShellSettingsDialog from './components/ShellSettingsDialog'
import DreamStatePanel from './components/DreamStatePanel'
import { useTerminalStore } from './store/useTerminalStore'
import { useSettingsStore } from './store/useSettingsStore'
import { useModuleStore } from './stores/useModuleStore'
import { useHabitatStore } from './store/useHabitatStore'
import ModuleView from './module-engine/ModuleView'
import type { ModuleManifest } from './module-engine/types'
import type { ShellConfig, CreatureConfig, Habitat } from '../shared/habitatTypes'
import './styles/global.css'

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; label: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 16,
          color: '#ff4455',
          fontFamily: 'monospace',
          fontSize: 12,
          background: '#0d0d1a',
          height: '100%',
          overflow: 'auto'
        }}>
          <strong>[{this.props.label}] error:</strong>
          <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const terminals = useTerminalStore((s) => s.terminals)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [bootstrapOpen, setBootstrapOpen] = useState(false)
  const [bootstrapV2Open, setBootstrapV2Open] = useState(false)
  const [moduleSettingsId, setModuleSettingsId] = useState<string | null>(null)
  const [habitatSaveOpen, setHabitatSaveOpen] = useState(false)
  const [habitatSaveId, setHabitatSaveId] = useState<string | null>(null)
  const [habitatManageOpen, setHabitatManageOpen] = useState(false)
  const [shellSettingsSessionId, setShellSettingsSessionId] = useState<string | null>(null)
  const [dreamStateOpen, setDreamStateOpen] = useState(false)
  const terminalPanelHeight = useSettingsStore((s) => s.terminalPanelHeight)
  const habitatVisible = useSettingsStore((s) => s.habitatVisible)
  const terminalVisible = useSettingsStore((s) => s.terminalVisible)
  const accentColor = useSettingsStore((s) => s.accentColor)
  const theme = useSettingsStore((s) => s.theme)
  const moduleStatus = useModuleStore((s) => s.status)
  const activeManifest = useModuleStore((s) => s.activeManifest)
  const showModule = moduleStatus !== 'idle' && moduleStatus !== 'stopped'

  // Track terminal pane refs for serialize/deserialize
  const terminalPaneRefs = useRef<Record<string, { serializeBuffer: () => string } | null>>({})

  // Apply accent color and theme to CSS variables / data attribute
  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentColor)
  }, [accentColor])

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Listen for module:manifest events (sent by resume-from-snapshot to sync store)
  useEffect(() => {
    const api = window.moduleAPI
    if (!api) return
    const handler = (manifest: ModuleManifest, assetPaths: Record<string, string>) => {
      useModuleStore.getState().loadModule(manifest, assetPaths ?? {})
    }
    api.onManifest(handler)
    return () => api.onManifest(handler)
  }, [])

  // Listen for module:status to reset store when module stops cleanly
  useEffect(() => {
    const api = window.moduleAPI
    if (!api) return
    const handler = (status: string) => {
      if (status === 'stopped') {
        useModuleStore.getState().reset()
      }
    }
    api.onStatus(handler)
    return () => api.onStatus(handler)
  }, [])

  // Listen for terminal:batch-created (from habitat:apply) to sync store with main process IDs
  useEffect(() => {
    const off = window.terminalAPI.onBatchCreated(({ sessions, habitatId }) => {
      const addTerminalBatch = useTerminalStore.getState().addTerminalBatch
      addTerminalBatch(
        sessions as Array<{ id: string; name: string; shellConfig: ShellConfig; creature?: CreatureConfig }>
      )
      if (habitatId) {
        useHabitatStore.getState().setActiveHabitatId(habitatId)
      }
    })
    return off
  }, [])

  // Auto-restore last active habitat on mount
  useEffect(() => {
    if (!window.habitatlogAPI?.getLastActive) return

    let cancelled = false
    const restore = async () => {
      try {
        const lastActive = await window.habitatlogAPI.getLastActive()
        if (cancelled || !lastActive) return

        // Apply the habitat to restore shells — look up full Habitat from store first
        if (window.habitatAPI?.apply) {
          const habitat = useHabitatStore.getState().getHabitat(lastActive.habitatId)
          if (habitat) {
            await window.habitatAPI.apply(habitat)
          }
        }

        if (cancelled) return

        // Load terminal buffers from snapshot
        const snapshot = await window.habitatlogAPI.getSnapshot(lastActive.habitatId)
        if (snapshot?.terminalBuffers) {
          // Wait a bit for terminals to mount, then inject buffers
          await new Promise(r => setTimeout(r, 2000))
          if (cancelled) return
          for (const [sessionId, buffer] of Object.entries(snapshot.terminalBuffers)) {
            const paneRef = terminalPaneRefs.current[sessionId]
            if (paneRef?.deserializeBuffer) {
              try { paneRef.deserializeBuffer(buffer) } catch {}
            }
          }
        }
      } catch (err) {
        console.error('[App] auto-restore failed:', err)
      }
    }
    restore()
    return () => { cancelled = true }
  }, [])

  // Snapshot habitat on app close
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (!window.habitatlogAPI?.writeSnapshot) return
      try {
        const buffers: Record<string, string> = {}
        for (const [sessionId, paneRef] of Object.entries(terminalPaneRefs.current)) {
          if (paneRef) {
            try {
              buffers[sessionId] = paneRef.serializeBuffer() ?? ''
            } catch {}
          }
        }
        const [habitatId, habitatName] = await Promise.all([
          window.habitatAPI?.getCurrentHabitatId?.() ?? 'default',
          window.habitatAPI?.getCurrentHabitatName?.() ?? '',
        ])
        window.habitatlogAPI.writeSnapshot({
          type: 'snapshot',
          version: 1,
          habitatId,
          habitatName,
          timestamp: Date.now(),
          terminalBuffers: buffers,
          creatureMemories: {},
          creatureNotes: {},
          eventCount: 0,
        }).catch(() => {})
      } catch {}
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  return (
    <>
      <div className="app">
        {/* ── Draggable title bar with integrated menu ── */}
        <div className="titlebar">
          <MenuBar
            onOpenSettings={() => setSettingsOpen(true)}
            onCreateModule={() => setBootstrapOpen(true)}
            onCreateModuleV2={() => setBootstrapV2Open(true)}
            onOpenModuleSettings={(id) => setModuleSettingsId(id)}
            onSaveHabitat={() => {
              setHabitatSaveId(useHabitatStore.getState().activeHabitatId)
              setHabitatSaveOpen(true)
            }}
            onManageHabitats={() => setHabitatManageOpen(true)}
            onOpenShellSettings={(sessionId) => setShellSettingsSessionId(sessionId)}
            onOpenDreamState={() => setDreamStateOpen(true)}
          />
          <span className="titlebar-title">Terminal Habitat</span>
          <div className="titlebar-actions">
            <WindowControls />
          </div>
        </div>

        {/* ── Module view (canvas takeover) or Habitat ── */}
        {showModule && activeManifest ? (
          <div className="habitat-section" style={{ flex: 1, overflow: 'hidden' }}>
            <ErrorBoundary label="ModuleView">
              <ModuleView
                manifest={activeManifest}
                onBack={() => useModuleStore.getState().reset()}
              />
            </ErrorBoundary>
          </div>
        ) : habitatVisible ? (
          <div className="habitat-section">
            {terminals.length === 0 ? (
              <div className="habitat-empty">
                <p>Open a Shell to summon your first creature.</p>
              </div>
            ) : (
              <ErrorBoundary label="Habitat">
                <Habitat />
              </ErrorBoundary>
            )}
          </div>
        ) : null}

        {/* ── Terminal grid (compact strip) ── */}
        {terminalVisible && (
          <div className="terminal-section" style={{ height: terminalPanelHeight }}>
            {terminals.length === 0 ? (
              <div className="terminals-empty">
                <span>No terminals yet — use <strong>File &gt; New Shell</strong></span>
              </div>
            ) : (
              <ErrorBoundary label="Terminals">
                <div className="terminal-grid">
                  {terminals.map((t) => (
                    <TerminalPane
                      key={t.id}
                      session={t}
                      ref={(el) => { terminalPaneRefs.current[t.id] = el }}
                      onOpenShellSettings={(sessionId) => setShellSettingsSessionId(sessionId)}
                    />
                  ))}
                </div>
              </ErrorBoundary>
            )}
          </div>
        )}
      </div>

      {/* Settings dialog rendered via portal — outside .app to avoid overflow clipping */}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Bootstrap terminal — create new module with AI-guided conversational CLI */}
      {bootstrapOpen && (
        <BootstrapTerminal onClose={() => setBootstrapOpen(false)} />
      )}
      {bootstrapV2Open && (
        <ModuleCreatorV2 onClose={() => setBootstrapV2Open(false)} />
      )}
      {moduleSettingsId && (
        <ModuleSettingsDialog
          moduleId={moduleSettingsId}
          onClose={() => setModuleSettingsId(null)}
          onDelete={async (id) => {
            await window.moduleAPI.deleteModule(id)
            setModuleSettingsId(null)
          }}
        />
      )}

      {habitatSaveOpen && (
        <ErrorBoundary label="HabitatSaveDialog">
          <HabitatSaveDialog
            onClose={() => { setHabitatSaveOpen(false); setHabitatSaveId(null) }}
            initialHabitat={habitatSaveId ? useHabitatStore.getState().getHabitat(habitatSaveId) : undefined}
          />
        </ErrorBoundary>
      )}

      {habitatManageOpen && (
        <ErrorBoundary label="HabitatManagerDialog">
          <HabitatManagerDialog onClose={() => setHabitatManageOpen(false)} />
        </ErrorBoundary>
      )}

      {shellSettingsSessionId && (
        <ErrorBoundary label="ShellSettingsDialog">
          <ShellSettingsDialog
            sessionId={shellSettingsSessionId}
            onClose={() => setShellSettingsSessionId(null)}
          />
        </ErrorBoundary>
      )}

      {dreamStateOpen && (
        <ErrorBoundary label="DreamStatePanel">
          <DreamStatePanel onClose={() => setDreamStateOpen(false)} />
        </ErrorBoundary>
      )}
    </>
  )
}
