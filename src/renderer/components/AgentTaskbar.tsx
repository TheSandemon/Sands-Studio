import React from 'react'
import { useTerminalStore } from '../store/useTerminalStore'
import './AgentTaskbar.css'

const STATE_COLOR: Record<string, string> = {
  idle:     '#5b90f0',
  busy:     '#ffdd55',
  sleep:    '#444488',
  error:    '#ff4455',
  talking:  '#bd93f9',
  egg:      '#fff5cc',
  hatching: '#ffff55',
}

export default function AgentTaskbar() {
  const terminals = useTerminalStore((s) => s.terminals)
  const setVisible = useTerminalStore((s) => s.setVisible)

  if (terminals.length === 0) return null

  return (
    <div className="agent-taskbar">
      {terminals.map((t) => {
        const name = t.creatureName ?? t.name
        const dotColor = STATE_COLOR[t.state] ?? '#444'
        const isActive = t.visible !== false

        return (
          <button
            key={t.id}
            className={`agent-taskbar-btn${isActive ? ' active' : ''}`}
            title={isActive ? `Hide ${name}` : `Show ${name}`}
            onClick={() => setVisible(t.id, !isActive)}
          >
            <span className="agent-taskbar-icon">🖥</span>
            <span
              className="agent-taskbar-dot"
              style={{ background: dotColor, boxShadow: `0 0 5px ${dotColor}` }}
            />
            <span className="agent-taskbar-name">{name}</span>
          </button>
        )
      })}
    </div>
  )
}
