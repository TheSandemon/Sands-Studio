/**
 * AgentChat.tsx
 *
 * Chat panel for every terminal — doubles as the egg conversation UI
 * before hatching and as the agent chat UI after hatching.
 */

import { useEffect, useRef, useState } from 'react'
import { useTerminalStore, type TerminalSession } from '../store/useTerminalStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useFlowchartStore } from '../store/useFlowchartStore'
import './AgentChat.css'

interface Props {
  session: TerminalSession
}

export default function AgentChat({ session }: Props) {
  const [input, setInput] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const eggStarted = useRef(false)

  const appendAgentLog = useTerminalStore((s) => s.appendAgentLog)
  const setAgentRunning = useTerminalStore((s) => s.setAgentRunning)
  const setTermState    = useTerminalStore((s) => s.setState)
  const hatchCreature   = useTerminalStore((s) => s.hatchCreature)
  const defaultModel   = useSettingsStore((s) => s.defaultModel)
  const defaultBaseURL = useSettingsStore((s) => s.defaultBaseURL)

  const agentLog = useTerminalStore(
    (s) => s.terminals.find((t) => t.id === session.id)?.agentLog ?? []
  )
  const agentRunning = useTerminalStore(
    (s) => s.terminals.find((t) => t.id === session.id)?.agentRunning ?? false
  )
  const hatched = useTerminalStore(
    (s) => s.terminals.find((t) => t.id === session.id)?.hatched ?? false
  )

  // Auto-start egg conversation on first mount for unhatched creatures
  useEffect(() => {
    if (!hatched && !eggStarted.current) {
      eggStarted.current = true
      setAgentRunning(session.id, true)
      setTermState(session.id, 'egg')
      window.agentAPI?.start(session.id, '__egg_init__')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Subscribe to agent events from main process
  useEffect(() => {
    const off = window.agentAPI.onEvent((terminalId, type, payload) => {
      // Accept events addressed to this terminal OR habitat-wide broadcasts ('*')
      if (terminalId !== session.id && terminalId !== '*') return

      switch (type) {
        case 'text':
          appendAgentLog(session.id, String(payload))
          if (!hatched) {
            setTermState(session.id, 'egg')
          } else {
            setTermState(session.id, 'talking')
          }
          break

        case 'command':
          appendAgentLog(session.id, `$ ${payload}`)
          setTermState(session.id, 'busy')
          break

        case 'error':
          appendAgentLog(session.id, `[error] ${payload}`)
          setTermState(session.id, 'error')
          break

        case 'habitat_message': {
          // Only show messages FROM other creatures (not echoed back to sender)
          const hdata = payload as { from: string; fromName: string; content: string }
          if (hdata.from !== session.id) {
            appendAgentLog(session.id, `📡 [${hdata.fromName}]: ${hdata.content}`)
          }
          break
        }

        case 'hatch': {
          const data = payload as { name: string; specialty: string }
          hatchCreature(session.id, data.name, data.specialty)
          appendAgentLog(session.id, `✨ ${data.name} has hatched! (${data.specialty})`)
          setTermState(session.id, 'hatching')
          // Brief hatching animation, then settle to idle
          setTimeout(() => setTermState(session.id, 'idle'), 2000)
          break
        }

        case 'done':
          setAgentRunning(session.id, false)
          if (hatched) setTermState(session.id, 'idle')
          break

        case 'visual_status': {
          const vs = payload as { status: string; icon: string; nodeId: string | null }
          const flowStore = useFlowchartStore.getState()

          if (vs.nodeId && vs.status) {
            // Only claim+branch for real file path nodes (not TerminalHub home base)
            const isFileNode = vs.nodeId !== 'TerminalHub' && vs.nodeId.includes('__')
            if (isFileNode) {
              flowStore.claimNode(vs.nodeId, session.id)
              flowStore.setTaskBranch({
                agentId: session.id,
                agentName: session.name,
                nodeId: vs.nodeId,
                task: vs.status,
                icon: vs.icon,
              })
              appendAgentLog(session.id, `${vs.icon} Moving to ${vs.nodeId.split('__').pop()}: ${vs.status}`)
            } else {
              // Home base / Initializing — no diagram change, just log
              appendAgentLog(session.id, `${vs.icon} ${vs.status}`)
            }
          } else {
            // Release all claims — sprite walks back to desk
            flowStore.releaseAllByCreature(session.id)
            flowStore.clearTaskBranch(session.id)
          }
          break
        }
      }
    })
    return off
  }, [session.id, hatched, appendAgentLog, setAgentRunning, setTermState, hatchCreature])

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [agentLog])

  const send = () => {
    const msg = input.trim()
    if (!msg || agentRunning) return
    setInput('')
    appendAgentLog(session.id, `> ${msg}`)
    setAgentRunning(session.id, true)
    if (!hatched) {
      setTermState(session.id, 'egg')
    } else {
      setTermState(session.id, 'talking')
    }
    window.agentAPI?.start(session.id, msg, {
      model: defaultModel || undefined,
      baseURL: defaultBaseURL || undefined,
    })
  }

  const placeholder = agentRunning
    ? (hatched ? 'Agent is running…' : 'Egg is responding…')
    : (hatched ? 'Ask the agent…' : 'Talk to your egg…')

  return (
    <div className="agent-chat">
      {agentLog.length > 0 && (
        <div className="agent-log" ref={logRef}>
          {agentLog.map((entry, i) => (
            <div
              key={i}
              className={
                'agent-log-entry' +
                (entry.startsWith('$ ')      ? ' cmd'  : '') +
                (entry.startsWith('> ')      ? ' user' : '') +
                (entry.startsWith('[error]') ? ' err'  : '') +
                (entry.startsWith('✨')      ? ' hatch'  : '') +
                (entry.startsWith('📡')      ? ' habitat': '')
              }
            >
              {entry}
            </div>
          ))}
          {agentRunning && <div className="agent-log-entry thinking">thinking…</div>}
        </div>
      )}

      <div className="agent-input-row">
        <input
          className="agent-input"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button
          className="agent-send"
          disabled={agentRunning || !input.trim()}
          onClick={send}
        >
          {agentRunning ? '…' : '▶'}
        </button>
        {agentRunning && (
          <button
            className="agent-stop"
            onClick={() => window.agentAPI?.stop(session.id)}
          >
            ■
          </button>
        )}
      </div>
    </div>
  )
}
