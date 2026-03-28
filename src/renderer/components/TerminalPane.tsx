/**
 * TerminalPane.tsx
 *
 * Renders one real PTY terminal using xterm.js.
 * Wires PTY data ↔ xterm and reports output activity back to the store.
 * Visual settings (font, cursor, theme) are driven by useSettingsStore with
 * per-shell overrides from session.shellConfig.
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useTerminalStore, type TerminalSession } from '../store/useTerminalStore'
import { useSettingsStore } from '../store/useSettingsStore'
import AgentChat from './AgentChat'
import ResizeHandle from './ResizeHandle'
import './TerminalPane.css'
import type { ColorScheme } from '../../shared/habitatTypes'

interface Props {
  session: TerminalSession
  onOpenShellSettings?: (sessionId: string) => void
}

export interface TerminalPaneRef {
  serializeBuffer: () => string
}

const STATE_COLOR: Record<string, string> = {
  idle:     '#5b90f0',
  busy:     '#ffdd55',
  sleep:    '#444488',
  error:    '#ff4455',
  talking:  '#bd93f9',
  egg:      '#fff5cc',
  hatching: '#ffff55'
}

// ── xterm theme presets ───────────────────────────────────────────────────────

const DARK_BASE: ITheme = {
  background:    '#09091a',
  foreground:    '#c8cce4',
  black:         '#1a1a2e',
  brightBlack:   '#44445a',
  red:           '#ff5555',
  brightRed:     '#ff6e6e',
  green:         '#50fa7b',
  brightGreen:   '#69ff94',
  yellow:        '#f1fa8c',
  brightYellow:  '#ffffa5',
  blue:          '#5b90f0',
  brightBlue:    '#8be9fd',
  magenta:       '#bd93f9',
  brightMagenta: '#ff79c6',
  cyan:          '#8be9fd',
  brightCyan:    '#a4ffff',
  white:         '#c8cce4',
  brightWhite:   '#ffffff'
}

const LIGHT_BASE: ITheme = {
  background:    '#f5f5ff',
  foreground:    '#1a1a3a',
  black:         '#1a1a2e',
  brightBlack:   '#555577',
  red:           '#cc3344',
  brightRed:     '#dd4455',
  green:         '#226633',
  brightGreen:   '#2d7a44',
  yellow:        '#886600',
  brightYellow:  '#aa8800',
  blue:          '#3355bb',
  brightBlue:    '#4466cc',
  magenta:       '#663399',
  brightMagenta: '#7744aa',
  cyan:          '#0077aa',
  brightCyan:    '#0088bb',
  white:         '#888899',
  brightWhite:   '#333355'
}

function buildTheme(isDark: boolean, accentColor: string, colorScheme?: ColorScheme): ITheme {
  const base = isDark ? DARK_BASE : LIGHT_BASE
  return {
    ...base,
    ...colorScheme,
    cursor: colorScheme?.cursor ?? accentColor,
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

const TerminalPane = forwardRef<TerminalPaneRef, Props>(({ session, onOpenShellSettings }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  // Track whether THIS RENDERER INSTANCE created the PTY (vs. pre-created by main process)
  const rendererCreatedPty = useRef(false)

  useImperativeHandle(ref, () => ({
    serializeBuffer: () => {
      if (!xtermRef.current) return ''
      try {
        if (typeof xtermRef.current.serialize === 'function') {
          return xtermRef.current.serialize({ scrollback: 1000 }) ?? ''
        }
        return xtermRef.current.getSelection?.() ?? ''
      } catch {
        return ''
      }
    }
  }), [xtermRef])

  const [paneWidth,  setPaneWidth]  = useState<number | undefined>(undefined)
  const [paneHeight, setPaneHeight] = useState<number | undefined>(undefined)

  const removeTerminal = useTerminalStore((s) => s.removeTerminal)
  const recordActivity = useTerminalStore((s) => s.recordActivity)
  const setState = useTerminalStore((s) => s.setState)
  const creatureName = useTerminalStore((s) => s.terminals.find((t) => t.id === session.id)?.creatureName)

  // ── Settings (global + per-shell merge) ──────────────────────────────────
  const shellConfig = session.shellConfig

  const globalFontSize   = useSettingsStore((s) => s.fontSize)
  const globalFontFamily = useSettingsStore((s) => s.fontFamily)
  const globalScrollback = useSettingsStore((s) => s.scrollback)
  const globalCursorStyle = useSettingsStore((s) => s.cursorStyle)
  const globalBellSound  = useSettingsStore((s) => s.bellSound)

  const fontSize    = shellConfig?.fontSize    ?? globalFontSize
  const fontFamily  = shellConfig?.fontFamily ?? globalFontFamily
  const scrollback  = shellConfig?.scrollback  ?? globalScrollback
  const cursorStyle = shellConfig?.cursorStyle ?? globalCursorStyle
  const bellSound   = shellConfig?.bellSound   ?? globalBellSound
  const colorScheme = shellConfig?.colorScheme

  const showTerminalHeaders = useSettingsStore((s) => s.showTerminalHeaders)
  const confirmBeforeClose  = useSettingsStore((s) => s.confirmBeforeClosing)
  const theme               = useSettingsStore((s) => s.theme)
  const accentColor         = useSettingsStore((s) => s.accentColor)

  const handleWidthResize = useCallback((dx: number) => {
    setPaneWidth((w) => {
      const current = w ?? (paneRef.current?.offsetWidth ?? 400)
      return Math.max(200, Math.min(1200, current + dx))
    })
  }, [])

  const handleHeightResize = useCallback((dy: number) => {
    setPaneHeight((h) => {
      const current = h ?? (paneRef.current?.offsetHeight ?? 400)
      return Math.max(150, current + dy)
    })
  }, [])

  // ── Mount xterm, create PTY, wire everything together ─────────────────────
  // Uses merged global + per-shell settings at mount time; reactive effects handle later changes.
  useEffect(() => {
    if (!containerRef.current) return

    const s = useSettingsStore.getState()
    const sc = session.shellConfig
    const term = new Terminal({
      cursorBlink: true,
      fontFamily:  sc?.fontFamily ?? s.fontFamily,
      fontSize:    sc?.fontSize   ?? s.fontSize,
      scrollback:  sc?.scrollback ?? s.scrollback,
      cursorStyle: sc?.cursorStyle ?? s.cursorStyle,
      theme: buildTheme(s.theme === 'dark', s.accentColor, sc?.colorScheme),
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    term.focus()
    fitAddon.fit()
    xtermRef.current = term
    fitRef.current = fitAddon

    if (sc?.preCreated) {
      // PTY already created by main process (e.g. habitat:apply) — just wire up listeners
    } else if (sc) {
      rendererCreatedPty.current = true
      window.terminalAPI.createWithConfig(session.id, sc)
    } else {
      rendererCreatedPty.current = true
      window.terminalAPI.create(session.id)
    }

    const offData = window.terminalAPI.onData((id, data) => {
      if (id !== session.id) return
      term.write(data)
      recordActivity(session.id)
    })

    const offExit = window.terminalAPI.onExit((id, code) => {
      if (id !== session.id) return
      term.writeln(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m`)
      setState(session.id, code === 0 ? 'idle' : 'error')
    })

    term.onData((data) => {
      window.terminalAPI.write(session.id, data)
    })

    const ro = new ResizeObserver(() => {
      fitAddon.fit()
      window.terminalAPI.resize(session.id, term.cols, term.rows)
    })
    ro.observe(containerRef.current)

    return () => {
      offData()
      offExit()
      ro.disconnect()
      term.dispose()
      // Only kill PTY if THIS renderer instance created it (not pre-created by main process)
      if (rendererCreatedPty.current) {
        window.terminalAPI.kill(session.id)
        rendererCreatedPty.current = false
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // ── Reactive settings updates ─────────────────────────────────────────────

  useEffect(() => {
    if (!xtermRef.current) return
    xtermRef.current.options.fontSize = fontSize
    fitRef.current?.fit()
  }, [fontSize])

  useEffect(() => {
    if (!xtermRef.current) return
    xtermRef.current.options.fontFamily = fontFamily
    fitRef.current?.fit()
  }, [fontFamily])

  useEffect(() => {
    if (!xtermRef.current) return
    xtermRef.current.options.scrollback = scrollback
  }, [scrollback])

  useEffect(() => {
    if (!xtermRef.current) return
    xtermRef.current.options.cursorStyle = cursorStyle
  }, [cursorStyle])

  useEffect(() => {
    if (!xtermRef.current) return
    xtermRef.current.options.theme = buildTheme(theme === 'dark', accentColor, colorScheme)
  }, [theme, accentColor, colorScheme])

  useEffect(() => {
    if (!xtermRef.current) return
    xtermRef.current.options.bellSoundEnabled = bellSound
  }, [bellSound])

  // ── Close handler ─────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    const name = creatureName ?? session.name
    if (confirmBeforeClose && !confirm(`Close ${name}?`)) return
    window.terminalAPI.kill(session.id)
    removeTerminal(session.id)
  }, [session.id, session.name, creatureName, confirmBeforeClose, removeTerminal])

  // ── Render ────────────────────────────────────────────────────────────────

  const displayName = creatureName ?? session.name
  const paneStyle: React.CSSProperties = {}
  if (paneWidth  !== undefined) { paneStyle.width = paneWidth;   paneStyle.flex = 'none' }
  if (paneHeight !== undefined) { paneStyle.height = paneHeight; paneStyle.alignSelf = 'flex-start' }

  return (
    <div className="terminal-pane" ref={paneRef} style={paneStyle}>
      <div className="terminal-pane-row">
        <div className="terminal-pane-inner">
          {showTerminalHeaders && (
            <div className="terminal-header">
              <span
                className="terminal-state-dot"
                style={{ background: STATE_COLOR[session.state] ?? '#444' }}
              />
              <span className="terminal-name">{displayName}</span>
              {onOpenShellSettings && (
                <button
                  className="terminal-cog"
                  title="Shell Settings"
                  onClick={() => onOpenShellSettings(session.id)}
                >
                  ⚙
                </button>
              )}
              <button className="terminal-close" onClick={handleClose}>×</button>
            </div>
          )}

          <div className="terminal-xterm" ref={containerRef} />

          <AgentChat session={session} />
        </div>

        <ResizeHandle direction="vertical" onResize={handleWidthResize} />
      </div>

      <ResizeHandle direction="horizontal" onResize={handleHeightResize} />
    </div>
  )
})

export default TerminalPane
