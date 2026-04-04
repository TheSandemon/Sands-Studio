import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { useSettingsStore } from '../store/useSettingsStore'
import './SettingsDialog.css'

type Tab = 'general' | 'appearance' | 'terminal' | 'habitat' | 'agent'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'habitat', label: 'Habitat' },
]

const ACCENT_PRESETS = [
  '#5b90f0',
  '#bd93f9',
  '#50fa7b',
  '#ffdd55',
  '#ff4455',
  '#ff79c6',
  '#8be9fd',
  '#ff6e6e',
]

// ── Panel components ─────────────────────────────────────────────────────────

function GeneralPanel() {
  const { showTerminalHeaders, confirmBeforeClosing, setSettings } = useSettingsStore()
  return (
    <>
      <div className="settings-row">
        <span className="settings-label">Show terminal headers</span>
        <input
          type="checkbox"
          className="settings-checkbox"
          checked={showTerminalHeaders}
          onChange={(e) => setSettings({ showTerminalHeaders: e.target.checked })}
        />
      </div>
      <div className="settings-row">
        <span className="settings-label">Confirm before closing shell</span>
        <input
          type="checkbox"
          className="settings-checkbox"
          checked={confirmBeforeClosing}
          onChange={(e) => setSettings({ confirmBeforeClosing: e.target.checked })}
        />
      </div>
    </>
  )
}

function AppearancePanel() {
  const { theme, accentColor, setSettings } = useSettingsStore()
  return (
    <>
      <div className="settings-section-title">Theme</div>
      <div className="settings-row">
        <span className="settings-label">Color theme</span>
        <div className="settings-radio-group">
          {(['dark', 'light'] as const).map((t) => (
            <label key={t} className="settings-radio-label">
              <input
                type="radio"
                name="theme"
                value={t}
                checked={theme === t}
                onChange={() => setSettings({ theme: t })}
              />
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </label>
          ))}
        </div>
      </div>
      <div className="settings-section-title">Accent Color</div>
      <div className="settings-row">
        <span className="settings-label">Accent color</span>
        <div className="accent-swatches">
          {ACCENT_PRESETS.map((color) => (
            <button
              key={color}
              className={`accent-swatch${accentColor === color ? ' selected' : ''}`}
              style={{ background: color }}
              title={color}
              onClick={() => setSettings({ accentColor: color })}
            />
          ))}
        </div>
      </div>
    </>
  )
}

function TerminalPanel() {
  const { fontSize, fontFamily, scrollback, cursorStyle, setSettings } = useSettingsStore()
  return (
    <>
      <div className="settings-section-title">Display</div>
      <div className="settings-row">
        <span className="settings-label">
          Font size
          <span className="settings-label-sub">Size of terminal text (px)</span>
        </span>
        <div className="settings-slider-row">
          <input
            type="range"
            className="settings-slider"
            min={10}
            max={24}
            step={1}
            value={fontSize}
            onChange={(e) => setSettings({ fontSize: Number(e.target.value) })}
          />
          <span className="settings-slider-value">{fontSize}px</span>
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-label">Font family</span>
        <input
          type="text"
          className="settings-input settings-input-wide"
          value={fontFamily}
          onChange={(e) => setSettings({ fontFamily: e.target.value })}
        />
      </div>
      <div className="settings-section-title">Behavior</div>
      <div className="settings-row">
        <span className="settings-label">
          Scrollback lines
          <span className="settings-label-sub">History kept per terminal</span>
        </span>
        <input
          type="number"
          className="settings-input settings-number"
          min={100}
          max={50000}
          step={100}
          value={scrollback}
          onChange={(e) => setSettings({ scrollback: Number(e.target.value) })}
        />
      </div>
      <div className="settings-row">
        <span className="settings-label">Cursor style</span>
        <div className="settings-radio-group">
          {(['block', 'underline', 'bar'] as const).map((style) => (
            <label key={style} className="settings-radio-label">
              <input
                type="radio"
                name="cursorStyle"
                value={style}
                checked={cursorStyle === style}
                onChange={() => setSettings({ cursorStyle: style })}
              />
              {style.charAt(0).toUpperCase() + style.slice(1)}
            </label>
          ))}
        </div>
      </div>
    </>
  )
}

function HabitatPanel() {
  const { terminalPanelHeight, showCreatureNames, creatureSpeed, habitatBackground, setSettings } = useSettingsStore()
  return (
    <>
      <div className="settings-section-title">Layout</div>
      <div className="settings-row">
        <span className="settings-label">
          Terminal panel height
          <span className="settings-label-sub">Height of the terminal strip at the bottom</span>
        </span>
        <div className="settings-slider-row">
          <input
            type="range"
            className="settings-slider"
            min={150}
            max={500}
            step={10}
            value={terminalPanelHeight}
            onChange={(e) => setSettings({ terminalPanelHeight: Number(e.target.value) })}
          />
          <span className="settings-slider-value">{terminalPanelHeight}px</span>
        </div>
      </div>
      <div className="settings-section-title">Creatures</div>
      <div className="settings-row">
        <span className="settings-label">Show creature names</span>
        <input
          type="checkbox"
          className="settings-checkbox"
          checked={showCreatureNames}
          onChange={(e) => setSettings({ showCreatureNames: e.target.checked })}
        />
      </div>
      <div className="settings-row">
        <span className="settings-label">Creature animation speed</span>
        <div className="settings-radio-group">
          {(['slow', 'normal', 'fast'] as const).map((speed) => (
            <label key={speed} className="settings-radio-label">
              <input
                type="radio"
                name="creatureSpeed"
                value={speed}
                checked={creatureSpeed === speed}
                onChange={() => setSettings({ creatureSpeed: speed })}
              />
              {speed.charAt(0).toUpperCase() + speed.slice(1)}
            </label>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-label">Habitat background</span>
        <select
          className="settings-select"
          value={habitatBackground}
          onChange={(e) => setSettings({ habitatBackground: e.target.value as any })}
        >
          <option value="default">Default Dark</option>
          <option value="space">Deep Space</option>
          <option value="grid">Cyber Grid</option>
          <option value="blueprint">Blueprint Matrix</option>
        </select>
      </div>
    </>
  )
}

// ── Main dialog ──────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
}

export default function SettingsDialog({ open, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const dialogRef = useRef<HTMLDivElement>(null)
  const resetSettings = useSettingsStore((s) => s.resetSettings)

  // Focus trap
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const focusFirst = () => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'button, input, select, [tabindex]'
      )
      first?.focus()
    }
    focusFirst()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, [tabindex]'
        ) ?? []
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      prev?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  const panel = ReactDOM.createPortal(
    <div className="settings-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <div className="settings-body">
          <div className="settings-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`settings-tab${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="settings-panel">
            {activeTab === 'general'    && <GeneralPanel />}
            {activeTab === 'appearance' && <AppearancePanel />}
            {activeTab === 'terminal'   && <TerminalPanel />}
            {activeTab === 'habitat'    && <HabitatPanel />}
          </div>
        </div>

        <div className="settings-footer">
          <button
            className="settings-btn"
            onClick={() => { if (confirm('Reset all settings to defaults?')) resetSettings() }}
          >
            Reset to Defaults
          </button>
          <button className="settings-btn settings-btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )

  return panel
}
