// =============================================================================
// BootstrapTerminal — Interactive module creation via an in-app xterm.js pane
//
// Replaces BootstrapModal. Presents a full-screen overlay containing an xterm
// terminal that drives the bootstrap flow conversationally:
//   1. Ask for module ID (slug)
//   2. Ask for scenario description
//   3. Call AI to generate clarifying questions
//   4. Present each question one at a time, collect answers
//   5. Generate the module config via AI
//   6. Save to disk and report success
//
// No real PTY is spawned — xterm is driven directly from JS.
// =============================================================================

import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useSettingsStore } from '../store/useSettingsStore'

interface BootstrapTerminalProps {
  onClose: () => void
}

// ── ANSI helpers ────────────────────────────────────────────────────────────

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  blue:    '\x1b[38;5;75m',
  cyan:    '\x1b[38;5;51m',
  green:   '\x1b[38;5;84m',
  yellow:  '\x1b[38;5;227m',
  magenta: '\x1b[38;5;183m',
  red:     '\x1b[38;5;203m',
  grey:    '\x1b[38;5;240m',
  white:   '\x1b[38;5;255m',
}

const THEME: ITheme = {
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
  brightWhite:   '#ffffff',
  cursor:        '#44aaff',
}

// ── Component ────────────────────────────────────────────────────────────────

export default function BootstrapTerminal({ onClose }: BootstrapTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef      = useRef<Terminal | null>(null)
  const fitRef       = useRef<FitAddon | null>(null)

  // Mutable controller held in a ref so the async flow can be cancelled.
  const abortRef = useRef(false)

  // ── Read a single line from the terminal ──────────────────────────────────
  // Handles: printable chars, backspace, enter, Ctrl+C (abort).
  const readLine = useCallback((term: Terminal, prompt: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      term.write(prompt)
      let line = ''

      const disp = term.onData((data) => {
        if (abortRef.current) {
          disp.dispose()
          reject(new Error('aborted'))
          return
        }

        for (const ch of data) {
          const code = ch.charCodeAt(0)

          if (ch === '\r') {
            // Enter — submit the line
            term.write('\r\n')
            disp.dispose()
            resolve(line)
            return
          }

          if (code === 3) {
            // Ctrl+C — abort
            term.write('^C\r\n')
            disp.dispose()
            abortRef.current = true
            reject(new Error('aborted'))
            return
          }

          if (code === 27) {
            // Escape — ignore / treat as cancel signal on empty line
            if (line === '') {
              term.write('\r\n')
              disp.dispose()
              abortRef.current = true
              reject(new Error('aborted'))
              return
            }
            continue
          }

          if (code === 127 || code === 8) {
            // Backspace
            if (line.length > 0) {
              line = line.slice(0, -1)
              term.write('\b \b')
            }
            continue
          }

          if (code >= 32) {
            // Printable
            line += ch
            term.write(ch)
          }
        }
      })
    })
  }, [])

  // ── Read a secret (masks input with *) ────────────────────────────────────
  const readSecret = useCallback((term: Terminal, prompt: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      term.write(prompt)
      let line = ''

      const disp = term.onData((data) => {
        if (abortRef.current) { disp.dispose(); reject(new Error('aborted')); return }

        for (const ch of data) {
          const code = ch.charCodeAt(0)

          if (ch === '\r') {
            term.write('\r\n')
            disp.dispose()
            resolve(line)
            return
          }

          if (code === 3) {
            term.write('^C\r\n')
            disp.dispose()
            abortRef.current = true
            reject(new Error('aborted'))
            return
          }

          if (code === 127 || code === 8) {
            if (line.length > 0) { line = line.slice(0, -1); term.write('\b \b') }
            continue
          }

          if (code >= 32) { line += ch; term.write('*') }
        }
      })
    })
  }, [])

  // ── Multi-line input (textarea-style): Enter submits, Shift+Enter newline ─
  const readMultiLine = useCallback((term: Terminal, prompt: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      term.write(prompt)
      let buffer = ''

      const disp = term.onData((data) => {
        if (abortRef.current) { disp.dispose(); reject(new Error('aborted')); return }

        for (let i = 0; i < data.length; i++) {
          const ch   = data[i]
          const code = ch.charCodeAt(0)

          if (ch === '\r') {
            // Check if next char is \n (Windows CRLF)
            if (data[i + 1] === '\n') i++
            // Submit
            term.write('\r\n')
            disp.dispose()
            resolve(buffer)
            return
          }

          if (code === 3) {
            term.write('^C\r\n')
            disp.dispose()
            abortRef.current = true
            reject(new Error('aborted'))
            return
          }

          if (code === 27) {
            if (buffer === '') {
              term.write('\r\n')
              disp.dispose()
              abortRef.current = true
              reject(new Error('aborted'))
              return
            }
            continue
          }

          if (code === 127 || code === 8) {
            if (buffer.length > 0) {
              // Handle newline boundary
              if (buffer[buffer.length - 1] === '\n') {
                buffer = buffer.slice(0, -1)
                term.write('\x1b[A\x1b[999C') // up + end-of-line
              } else {
                buffer = buffer.slice(0, -1)
                term.write('\b \b')
              }
            }
            continue
          }

          if (code >= 32 || ch === '\n') {
            buffer += ch
            term.write(ch === '\n' ? '\r\n' : ch)
          }
        }
      })
    })
  }, [])

  // ── Typewriter effect ─────────────────────────────────────────────────────
  const typewrite = useCallback(async (term: Terminal, text: string, delayMs = 12) => {
    for (const ch of text) {
      if (abortRef.current) return
      term.write(ch === '\n' ? '\r\n' : ch)
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
    }
  }, [])

  // ── Spinner ───────────────────────────────────────────────────────────────
  const spinner = useCallback((term: Terminal, label: string): (() => void) => {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    let i = 0
    term.write(`\r${C.cyan}${frames[0]}${C.reset} ${C.dim}${label}${C.reset}`)
    const iv = setInterval(() => {
      if (abortRef.current) { clearInterval(iv); return }
      i = (i + 1) % frames.length
      term.write(`\r${C.cyan}${frames[i]}${C.reset} ${C.dim}${label}${C.reset}`)
    }, 80)
    return () => {
      clearInterval(iv)
      // Erase the spinner line
      term.write('\r\x1b[2K')
    }
  }, [])

  // ── Main bootstrap flow ───────────────────────────────────────────────────
  const runFlow = useCallback(async (term: Terminal) => {
    const w = (s: string) => term.write(s)
    const nl = () => term.write('\r\n')

    // Read user-configured settings
    const { defaultModel, defaultBaseURL, defaultApiKey } = useSettingsStore.getState()
    let apiKey = defaultApiKey || undefined

    if (!apiKey) {
      nl()
      w(`${C.yellow}  No API key found in Settings.${C.reset}\r\n`)
      w(`${C.grey}  Enter your Anthropic (or compatible) API key:${C.reset}\r\n\r\n`)
      try {
        const entered = await readSecret(term, `${C.blue}  api-key > ${C.reset}`)
        if (entered.trim().length < 10) {
          w(`${C.red}  Key too short — aborting.${C.reset}\r\n`)
          return
        }
        apiKey = entered.trim()
        nl()
        const save = await readLine(term, `${C.grey}  Save to Settings? [y/N] ${C.reset}`)
        nl()
        if (save.trim().toLowerCase() === 'y') {
          useSettingsStore.getState().setSettings({ defaultApiKey: apiKey })
          w(`${C.green}  Saved to Settings.${C.reset}\r\n`)
          nl()
        }
      } catch {
        return // aborted
      }
    }

    const modelOpts = {
      model: defaultModel || undefined,
      baseURL: defaultBaseURL || undefined,
      apiKey,
    }

    // ── Banner ──────────────────────────────────────────────────────────────
    nl()
    await typewrite(term,
      `${C.blue}${C.bold}  Terminal Habitat — Module Creator${C.reset}\r\n`, 8)
    await typewrite(term,
      `${C.grey}  AI-guided module bootstrap  ${C.dim}(Ctrl+C or Escape to cancel)${C.reset}\r\n\r\n`, 6)

    const box = `${C.grey}  ─────────────────────────────────────────────────${C.reset}\r\n`
    w(box)

    // ── Step 1: Module ID ────────────────────────────────────────────────────
    await typewrite(term,
      `${C.yellow}  Step 1 of 4${C.reset}  ${C.white}Name your module${C.reset}\r\n`, 8)
    w(`${C.grey}  Enter a slug (lowercase, hyphens ok). Example: dungeon-crawl${C.reset}\r\n\r\n`)

    let moduleId = ''
    while (true) {
      try {
        const raw = await readLine(term, `${C.blue}  module-id > ${C.reset}`)
        const slug = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
        if (slug.length < 2) {
          w(`${C.red}  Too short — try again.${C.reset}\r\n`)
          continue
        }
        moduleId = slug
        break
      } catch {
        return // aborted
      }
    }

    nl()
    w(box)

    // ── Step 2: Scenario ─────────────────────────────────────────────────────
    await typewrite(term,
      `${C.yellow}  Step 2 of 4${C.reset}  ${C.white}Describe your scenario${C.reset}\r\n`, 8)
    w(`${C.grey}  Describe the world, agents, and vibe. Press Enter to submit.\r\n`)
    w(`  Tip: the more detail you give, the better the AI result.${C.reset}\r\n\r\n`)
    w(`${C.grey}  Example: "A cozy farming village where AI villagers tend crops,\r\n`)
    w(`  trade at the market, and chat about their days."${C.reset}\r\n\r\n`)

    let scenario = ''
    while (true) {
      try {
        const raw = await readMultiLine(term, `${C.blue}  scenario > ${C.reset}`)
        if (raw.trim().length < 10) {
          w(`${C.red}  Please write at least a sentence.${C.reset}\r\n`)
          continue
        }
        scenario = raw.trim()
        break
      } catch {
        return // aborted
      }
    }

    nl()
    w(box)

    // ── Step 3: AI clarifying questions ──────────────────────────────────────
    await typewrite(term,
      `${C.yellow}  Step 3 of 4${C.reset}  ${C.white}Clarifying questions${C.reset}\r\n`, 8)
    nl()

    let questions: Array<{ id: string; question: string; placeholder?: string }> = []
    {
      const stop = spinner(term, 'Analyzing your scenario…')
      try {
        const result = await window.moduleAPI.getBootstrapQuestions(scenario, modelOpts)
        stop()
        questions = result.questions ?? []
      } catch (err) {
        stop()
        nl()
        w(`${C.red}  Error generating questions: ${String(err)}${C.reset}\r\n`)
        w(`${C.grey}  Check your API key in Settings. Press Enter to exit.${C.reset}\r\n`)
        try { await readLine(term, '') } catch {}
        return
      }
    }

    if (questions.length === 0) {
      w(`${C.yellow}  No questions generated — proceeding with scenario as-is.${C.reset}\r\n\r\n`)
    } else {
      w(`${C.green}  Got ${questions.length} questions. Answer each one (or press Enter to skip).${C.reset}\r\n\r\n`)
    }

    const answers: Record<string, string> = {}

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      if (abortRef.current) return

      w(`${C.blue}  [${i + 1}/${questions.length}]${C.reset} ${C.white}${q.question}${C.reset}\r\n`)
      if (q.placeholder) {
        w(`${C.grey}  e.g. ${q.placeholder}${C.reset}\r\n`)
      }

      try {
        const ans = await readLine(term, `${C.magenta}  > ${C.reset}`)
        answers[q.id] = ans.trim()
        nl()
      } catch {
        return // aborted
      }
    }

    w(box)

    // ── Step 4: Generate ─────────────────────────────────────────────────────
    await typewrite(term,
      `${C.yellow}  Step 4 of 4${C.reset}  ${C.white}Generating module config${C.reset}\r\n`, 8)
    nl()

    // Build full prompt with answers
    const enriched = questions.length > 0
      ? questions
          .map((q) => `${q.question}\n-> ${answers[q.id] || '(no preference)'}`)
          .join('\n\n')
      : ''

    const fullPrompt = enriched
      ? `Create a module named "${moduleId}" for the following scenario:\n${scenario}\n\nDesign decisions from the creator:\n${enriched}`
      : `Create a module named "${moduleId}" for the following scenario:\n${scenario}`

    let generated: { manifest: unknown; world: unknown; agents: unknown[] } | null = null
    {
      const stop = spinner(term, 'Calling AI — this may take 20-40 seconds…')
      try {
        generated = await window.moduleAPI.generateModuleConfig(moduleId, fullPrompt, modelOpts) as typeof generated
        stop()
        w(`${C.green}  Module config generated.${C.reset}\r\n`)
      } catch (err) {
        stop()
        nl()
        w(`${C.red}  Error generating config: ${String(err)}${C.reset}\r\n`)
        w(`${C.grey}  Check your API key in Settings. Press Enter to exit.${C.reset}\r\n`)
        try { await readLine(term, '') } catch {}
        return
      }
    }

    if (!generated) return

    // Save
    nl()
    {
      const stop = spinner(term, 'Saving module files…')
      try {
        await window.moduleAPI.saveModule(moduleId, generated)
        stop()
        w(`${C.green}  Saved to modules/${moduleId}/${C.reset}\r\n`)
      } catch (err) {
        stop()
        w(`${C.red}  Error saving: ${String(err)}${C.reset}\r\n`)
        w(`${C.grey}  Press Enter to exit.${C.reset}\r\n`)
        try { await readLine(term, '') } catch {}
        return
      }
    }

    // ── Done ─────────────────────────────────────────────────────────────────
    nl()
    w(box)
    await typewrite(term,
      `${C.green}${C.bold}  Module "${moduleId}" created successfully!${C.reset}\r\n`, 8)
    await typewrite(term,
      `${C.grey}  Launch it from Modules > ${moduleId}${C.reset}\r\n\r\n`, 6)
    w(`${C.dim}  Press Enter to close.${C.reset}\r\n`)

    try { await readLine(term, '') } catch {}
    onClose()
  }, [readLine, readSecret, readMultiLine, typewrite, spinner, onClose])

  // ── Mount ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    abortRef.current = false

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 1000,
      cursorStyle: 'bar',
      theme: THEME,
      convertEol: false,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()
    termRef.current = term
    fitRef.current = fitAddon

    const ro = new ResizeObserver(() => fitAddon.fit())
    ro.observe(containerRef.current)

    // Forward clipboard paste into the terminal (Ctrl+V / right-click paste)
    const el = containerRef.current
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') ?? ''
      if (text) term.paste(text)
      e.preventDefault()
    }
    el.addEventListener('paste', onPaste)

    // Run the conversational flow
    runFlow(term).catch((err: unknown) => {
      const isAbort = err instanceof Error && err.message === 'aborted'
      if (isAbort) {
        onClose()
      } else {
        // Unexpected error — show it in the terminal so the user can see what went wrong
        try {
          term.write(`\r\n\x1b[38;5;203m  Error: ${String(err)}\x1b[0m\r\n`)
          term.write(`\x1b[38;5;240m  Press any key to close.\x1b[0m\r\n`)
          term.onData(() => onClose())
        } catch {
          onClose()
        }
      }
    })

    return () => {
      abortRef.current = true
      el.removeEventListener('paste', onPaste)
      ro.disconnect()
      term.dispose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9000,
      }}
      onClick={(e) => {
        // Close on backdrop click only if the flow isn't actively reading
        if (e.target === e.currentTarget) {
          abortRef.current = true
          onClose()
        }
      }}
    >
      <div
        style={{
          width: '700px',
          height: '540px',
          background: '#09091a',
          border: '1px solid #1a1a3e',
          borderRadius: '8px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 12px',
            background: '#0d0d24',
            borderBottom: '1px solid #1a1a3e',
            flexShrink: 0,
            userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#44aaff',
                boxShadow: '0 0 6px #44aaff',
              }}
            />
            <span
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
                color: '#8888aa',
              }}
            >
              module-creator
            </span>
          </div>
          <button
            style={{
              background: 'none',
              border: 'none',
              color: '#44445a',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: '0 2px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => ((e.target as HTMLButtonElement).style.color = '#ff4455')}
            onMouseLeave={(e) => ((e.target as HTMLButtonElement).style.color = '#44445a')}
            onClick={() => {
              abortRef.current = true
              onClose()
            }}
          >
            x
          </button>
        </div>

        {/* xterm container */}
        <div
          ref={containerRef}
          style={{ flex: 1, minHeight: 0, padding: '4px' }}
        />
      </div>
    </div>
  )
}
