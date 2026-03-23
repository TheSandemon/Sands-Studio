import React, { useState } from 'react'
import Habitat from './components/Habitat'
import TerminalPane from './components/TerminalPane'
import WindowControls from './components/WindowControls'
import MenuBar from './components/MenuBar'
import SettingsDialog from './components/SettingsDialog'
import BootstrapTerminal from './components/BootstrapTerminal'
import { useTerminalStore } from './store/useTerminalStore'
import { useSettingsStore } from './store/useSettingsStore'
import { useModuleStore } from './stores/useModuleStore'
import ModuleView from './module-engine/ModuleView'
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
  const terminalPanelHeight = useSettingsStore((s) => s.terminalPanelHeight)
  const habitatVisible = useSettingsStore((s) => s.habitatVisible)
  const terminalVisible = useSettingsStore((s) => s.terminalVisible)
  const accentColor = useSettingsStore((s) => s.accentColor)
  const theme = useSettingsStore((s) => s.theme)
  const moduleStatus = useModuleStore((s) => s.status)
  const activeManifest = useModuleStore((s) => s.activeManifest)
  const showModule = moduleStatus !== 'idle' && moduleStatus !== 'stopped'

  // Apply accent color and theme to CSS variables / data attribute
  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentColor)
  }, [accentColor])

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <>
      <div className="app">
        {/* ── Draggable title bar with integrated menu ── */}
        <div className="titlebar">
          <MenuBar onOpenSettings={() => setSettingsOpen(true)} onCreateModule={() => setBootstrapOpen(true)} />
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
                    <TerminalPane key={t.id} session={t} />
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
    </>
  )
}
