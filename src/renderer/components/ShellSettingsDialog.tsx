import { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { useTerminalStore } from '../store/useTerminalStore'
import { useSettingsStore } from '../store/useSettingsStore'
import type { ShellConfig, ColorScheme } from '../../shared/habitatTypes'
import './ShellSettingsDialog.css'

interface Props {
  sessionId: string
  onClose: () => void
}

type Tab = 'shell' | 'display' | 'environment' | 'creature'

const TABS: { id: Tab; label: string }[] = [
  { id: 'shell', label: 'Shell' },
  { id: 'display', label: 'Display' },
  { id: 'environment', label: 'Environment' },
  { id: 'creature', label: 'Creature' },
]

const SPRITE_OPTIONS: { id: string; label: string; emoji: string }[] = [
  { id: 'bat', label: 'Bat', emoji: '🦇' },
  { id: 'crab', label: 'Crab', emoji: '🦀' },
  { id: 'fish', label: 'Fish', emoji: '🐟' },
  { id: 'frog', label: 'Frog', emoji: '🐸' },
  { id: 'ghost', label: 'Ghost', emoji: '👻' },
  { id: 'goblin', label: 'Goblin', emoji: '👺' },
  { id: 'heart', label: 'Heart', emoji: '❤️' },
  { id: 'mushroom', label: 'Mushroom', emoji: '🍄' },
  { id: 'skeleton', label: 'Skeleton', emoji: '💀' },
  { id: 'slime', label: 'Slime', emoji: '🟢' },
  { id: 'spider', label: 'Spider', emoji: '🕷️' },
]

const COLOR_SCHEMES: { id: string; name: string; scheme: Partial<ColorScheme> }[] = [
  { id: 'default-dark', name: 'Default Dark', scheme: {} },
  { id: 'default-light', name: 'Default Light', scheme: { background: '#f5f5ff', foreground: '#1a1a3a' } },
  { id: 'dracula', name: 'Dracula', scheme: { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2' } },
  { id: 'nord', name: 'Nord', scheme: { background: '#2e3440', foreground: '#eceff4', cursor: '#d8dee9' } },
  { id: 'solarized-dark', name: 'Solarized Dark', scheme: { background: '#002b36', foreground: '#839496', cursor: '#839496' } },
  { id: 'solarized-light', name: 'Solarized Light', scheme: { background: '#fdf6e3', foreground: '#657b83', cursor: '#657b83' } },
]

const FONT_FAMILIES = [
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Consolas',
  'Monaco',
  'Courier New',
  'monospace',
]


export default function ShellSettingsDialog({ sessionId, onClose }: Props) {
  const session = useTerminalStore((s) => s.terminals.find((t) => t.id === sessionId))
  const setShellConfig = useTerminalStore((s) => s.setShellConfig)
  const globalFontSize = useSettingsStore((s) => s.fontSize)
  const globalFontFamily = useSettingsStore((s) => s.fontFamily)
  const globalScrollback = useSettingsStore((s) => s.scrollback)
  const globalCursorStyle = useSettingsStore((s) => s.cursorStyle)
  const globalBellSound = useSettingsStore((s) => s.bellSound)

  const existing = session?.shellConfig

  const [activeTab, setActiveTab] = useState<Tab>('shell')
  const [shell, setShell] = useState(existing?.shell ?? (navigator.userAgent.includes('Windows') ? 'powershell.exe' : '/bin/bash'))
  const [args, setArgs] = useState(existing?.args?.join(' ') ?? '')
  const [cwd, setCwd] = useState(existing?.cwd ?? '')
  const [env, setEnv] = useState<[string, string][]>(Object.entries(existing?.env ?? {}))
  const [fontSize, setFontSize] = useState<number | null>(existing?.fontSize ?? null)
  const [fontFamily, setFontFamily] = useState(existing?.fontFamily ?? null)
  const [scrollback, setScrollback] = useState<number | null>(existing?.scrollback ?? null)
  const [cursorStyle, setCursorStyle] = useState<'block' | 'underline' | 'bar' | null>(existing?.cursorStyle ?? null)
  const [colorSchemeId, setColorSchemeId] = useState<string>('default-dark')
  const [customColorScheme, setCustomColorScheme] = useState<Partial<ColorScheme>>(existing?.colorScheme ?? {})
  const [bellSound, setBellSound] = useState<boolean | null>(existing?.bellSound ?? null)
  const [spriteId, setSpriteId] = useState<string | null>(existing?.creature?.spriteId ?? null)
  const [useGlobalFontSize, setUseGlobalFontSize] = useState(existing?.fontSize === undefined)
  const [useGlobalFontFamily, setUseGlobalFontFamily] = useState(existing?.fontFamily === undefined)
  const [useGlobalScrollback, setUseGlobalScrollback] = useState(existing?.scrollback === undefined)
  const [useGlobalCursorStyle, setUseGlobalCursorStyle] = useState(existing?.cursorStyle === undefined)
  const [useGlobalBellSound, setUseGlobalBellSound] = useState(existing?.bellSound === undefined)
  const [dirty, setDirty] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  const markDirty = useCallback(() => setDirty(true), [])

  const buildConfig = useCallback((): ShellConfig => {
    const id = sessionId
    const name = session?.name ?? 'Shell'
    const resolvedColorScheme: ColorScheme | undefined =
      colorSchemeId === 'custom'
        ? (Object.keys(customColorScheme).length > 0 ? customColorScheme as ColorScheme : undefined)
        : (COLOR_SCHEMES.find((c) => c.id === colorSchemeId)?.scheme as ColorScheme | undefined)

    return {
      id,
      name,
      shell,
      args: args ? args.split(/\s+/) : undefined,
      cwd,
      env: Object.fromEntries(env.filter(([k]) => k.trim())),
      fontSize: useGlobalFontSize ? undefined : (fontSize ?? undefined),
      fontFamily: useGlobalFontFamily ? undefined : (fontFamily ?? undefined),
      scrollback: useGlobalScrollback ? undefined : (scrollback ?? undefined),
      cursorStyle: useGlobalCursorStyle ? undefined : (cursorStyle ?? undefined),
      colorScheme: resolvedColorScheme,
      bellSound: useGlobalBellSound ? undefined : (bellSound ?? undefined),
      creature: existing?.creature ? {
        ...existing.creature,
        // Match old SpriteManagerDialog behavior: explicitly hatching agent on sprite apply
        hatched: spriteId ? true : (existing.creature.hatched ?? false),
        spriteId: spriteId ?? undefined,
      } : {
        id: sessionId,
        hatched: spriteId ? true : (session?.hatched ?? false),
        spriteId: spriteId ?? undefined,
      },
    }
  }, [sessionId, session, shell, args, cwd, env, fontSize, fontFamily, scrollback, cursorStyle, colorSchemeId, customColorScheme, bellSound, spriteId, useGlobalFontSize, useGlobalFontFamily, useGlobalScrollback, useGlobalCursorStyle, useGlobalBellSound, existing])

  const handleApply = useCallback(() => {
    const config = buildConfig()
    setShellConfig(sessionId, config)
    setDirty(false)
    
    // Also persist sprite directly into creature memory so it survives app reloads before full Habitat saves
    const creatureId = existing?.creature?.id ?? sessionId;
    if (creatureId && window.creatureAPI) {
      window.creatureAPI.loadMemory(creatureId).then(mem => {
        if (mem) {
          mem.spriteId = spriteId ?? undefined;
          window.creatureAPI.saveMemory(mem.id, mem).catch(e => console.error("Failed to persist sprite:", e));
        } else {
          window.creatureAPI.saveMemory(creatureId, {
            id: creatureId,
            spriteId: spriteId ?? undefined,
            hatched: spriteId ? true : false,
            createdAt: new Date().toISOString(),
            messages: []
          }).catch(e => console.error("Failed to persist sprite (new memory):", e));
        }
      }).catch(e => console.error("Failed to load memory for sprite persist:", e));
    }
  }, [buildConfig, sessionId, existing?.creature?.id, spriteId, setShellConfig])

  const handleClose = useCallback(() => {
    if (dirty && !confirm('Discard unsaved changes?')) return
    onClose()
  }, [dirty, onClose])

  // Escape / Ctrl+S
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { handleClose(); return }
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleApply() }
    }
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
      prev?.focus()
    }
  }, [handleClose, handleApply])

  return ReactDOM.createPortal(
    <div className="shsett-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="shsett-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Shell Settings">
        <div className="shsett-header">
          <h2>Shell Settings</h2>
          <span className="shsett-session-name">{session?.name ?? sessionId}</span>
          <button className="shsett-close-btn" onClick={handleClose} aria-label="Close">✕</button>
        </div>

        <div className="shsett-body">
          <div className="shsett-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`shsett-tab${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="shsett-panel">
            {activeTab === 'shell' && (
              <div className="shsett-tab-content">
                <div className="shsett-row">
                  <label className="shsett-label">Shell Executable</label>
                  <input
                    className="shsett-input"
                    type="text"
                    value={shell}
                    placeholder="powershell.exe"
                    onChange={(e) => { setShell(e.target.value); markDirty() }}
                  />
                </div>

                <div className="shsett-row">
                  <label className="shsett-label">Arguments</label>
                  <input
                    className="shsett-input"
                    type="text"
                    value={args}
                    placeholder="(none)"
                    onChange={(e) => { setArgs(e.target.value); markDirty() }}
                  />
                </div>

                <div className="shsett-row">
                  <label className="shsett-label">Working Directory</label>
                  <input
                    className="shsett-input"
                    type="text"
                    value={cwd}
                    placeholder="(home directory)"
                    onChange={(e) => { setCwd(e.target.value); markDirty() }}
                  />
                </div>

                <p className="shsett-hint">Shell path and directory changes require a PTY restart to take effect.</p>
              </div>
            )}

            {activeTab === 'display' && (
              <div className="shsett-tab-content">
                <div className="shsett-row">
                  <label className="shsett-label">Font Size</label>
                  <div className="shsett-toggle-row">
                    <label className="shsett-toggle-label">
                      <input
                        type="checkbox"
                        checked={useGlobalFontSize}
                        onChange={(e) => { setUseGlobalFontSize(e.target.checked); markDirty() }}
                      />
                      Use Global ({globalFontSize}px)
                    </label>
                  </div>
                  {!useGlobalFontSize && (
                    <input
                      className="shsett-input shsett-input-number"
                      type="number"
                      min={6}
                      max={72}
                      value={fontSize ?? globalFontSize}
                      onChange={(e) => { setFontSize(Number(e.target.value)); markDirty() }}
                    />
                  )}
                </div>

                <div className="shsett-row">
                  <label className="shsett-label">Font Family</label>
                  <div className="shsett-toggle-row">
                    <label className="shsett-toggle-label">
                      <input
                        type="checkbox"
                        checked={useGlobalFontFamily}
                        onChange={(e) => { setUseGlobalFontFamily(e.target.checked); markDirty() }}
                      />
                      Use Global
                    </label>
                  </div>
                  {!useGlobalFontFamily && (
                    <select
                      className="shsett-select"
                      value={fontFamily ?? globalFontFamily}
                      onChange={(e) => { setFontFamily(e.target.value); markDirty() }}
                    >
                      {FONT_FAMILIES.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="shsett-row">
                  <label className="shsett-label">Scrollback Lines</label>
                  <div className="shsett-toggle-row">
                    <label className="shsett-toggle-label">
                      <input
                        type="checkbox"
                        checked={useGlobalScrollback}
                        onChange={(e) => { setUseGlobalScrollback(e.target.checked); markDirty() }}
                      />
                      Use Global ({globalScrollback})
                    </label>
                  </div>
                  {!useGlobalScrollback && (
                    <input
                      className="shsett-input shsett-input-number"
                      type="number"
                      min={100}
                      max={100000}
                      value={scrollback ?? globalScrollback}
                      onChange={(e) => { setScrollback(Number(e.target.value)); markDirty() }}
                    />
                  )}
                </div>

                <div className="shsett-row">
                  <label className="shsett-label">Cursor Style</label>
                  <div className="shsett-toggle-row">
                    <label className="shsett-toggle-label">
                      <input
                        type="checkbox"
                        checked={useGlobalCursorStyle}
                        onChange={(e) => { setUseGlobalCursorStyle(e.target.checked); markDirty() }}
                      />
                      Use Global
                    </label>
                  </div>
                  {!useGlobalCursorStyle && (
                    <div className="shsett-radio-group">
                      {(['block', 'underline', 'bar'] as const).map((s) => (
                        <label key={s} className="shsett-radio-label">
                          <input
                            type="radio"
                            name="cursorStyle"
                            checked={cursorStyle === s}
                            onChange={() => { setCursorStyle(s); markDirty() }}
                          />
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="shsett-row">
                  <label className="shsett-label">Color Scheme</label>
                  <select
                    className="shsett-select"
                    value={colorSchemeId}
                    onChange={(e) => { setColorSchemeId(e.target.value); markDirty() }}
                  >
                    {COLOR_SCHEMES.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    <option value="custom">Custom…</option>
                  </select>
                  {colorSchemeId === 'custom' && (
                    <div className="shsett-color-custom">
                      <input
                        className="shsett-input"
                        type="text"
                        placeholder='{ "background": "#000", "foreground": "#fff" }'
                        value={JSON.stringify(customColorScheme)}
                        onChange={(e) => {
                          try {
                            setCustomColorScheme(JSON.parse(e.target.value))
                            markDirty()
                          } catch {}
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className="shsett-row">
                  <label className="shsett-label">Bell Sound</label>
                  <div className="shsett-toggle-row">
                    <label className="shsett-toggle-label">
                      <input
                        type="checkbox"
                        checked={useGlobalBellSound}
                        onChange={(e) => { setUseGlobalBellSound(e.target.checked); markDirty() }}
                      />
                      Use Global
                    </label>
                  </div>
                  {!useGlobalBellSound && (
                    <label className="shsett-checkbox-label">
                      <input
                        type="checkbox"
                        checked={bellSound ?? true}
                        onChange={(e) => { setBellSound(e.target.checked); markDirty() }}
                      />
                      Enable bell sound
                    </label>
                  )}
                </div>

                <p className="shsett-hint">Display changes apply immediately to the running terminal.</p>
              </div>
            )}

            {activeTab === 'environment' && (
              <div className="shsett-tab-content">
                <div className="shsett-env-list">
                  {env.map(([key, value], i) => (
                    <div key={i} className="shsett-env-row">
                      <input
                        className="shsett-input shsett-env-key"
                        type="text"
                        value={key}
                        placeholder="VAR_NAME"
                        onChange={(e) => {
                          const next = [...env] as [string, string][]
                          next[i] = [e.target.value, value]
                          setEnv(next)
                          markDirty()
                        }}
                      />
                      <span className="shsett-env-eq">=</span>
                      <input
                        className="shsett-input shsett-env-value"
                        type="text"
                        value={value}
                        placeholder="value"
                        onChange={(e) => {
                          const next = [...env] as [string, string][]
                          next[i] = [key, e.target.value]
                          setEnv(next)
                          markDirty()
                        }}
                      />
                      <button
                        className="shsett-env-remove"
                        onClick={() => {
                          setEnv((prev) => prev.filter((_, j) => j !== i))
                          markDirty()
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="shsett-add-env"
                  onClick={() => {
                    setEnv((prev) => [...prev, ['', '']])
                    markDirty()
                  }}
                >
                  + Add Variable
                </button>
                <p className="shsett-hint">These variables are merged with process.env when the PTY starts.</p>
              </div>
            )}
            {activeTab === 'creature' && (
              <div className="shsett-tab-content">
                <div className="shsett-row">
                  <label className="shsett-label">Agent Sprite</label>
                  <div className="shsett-sprite-grid">
                    <button
                      className={`shsett-sprite-btn${spriteId === null ? ' shsett-sprite-btn-selected' : ''}`}
                      onClick={() => { setSpriteId(null); markDirty() }}
                      title="Random"
                    >
                      <span className="shsett-sprite-icon">🎲</span>
                      <span className="shsett-sprite-name">Random</span>
                    </button>
                    {SPRITE_OPTIONS.map((s) => (
                      <button
                        key={s.id}
                        className={`shsett-sprite-btn${spriteId === s.id ? ' shsett-sprite-btn-selected' : ''}`}
                        onClick={() => { setSpriteId(s.id); markDirty() }}
                        title={s.label}
                      >
                        <span className="shsett-sprite-icon">{s.emoji}</span>
                        <span className="shsett-sprite-name">{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <p className="shsett-hint">This sprite will appear in the Habitat for this agent.</p>
              </div>
            )}
          </div>
        </div>

        <div className="shsett-footer">
          <span className="shsett-dirty-indicator">{dirty ? 'Unsaved changes' : ''}</span>
          <div className="shsett-footer-actions">
            <button className="shsett-btn" onClick={handleClose}>Cancel</button>
            <button
              className="shsett-btn shsett-btn-primary"
              onClick={handleApply}
              disabled={!dirty}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
