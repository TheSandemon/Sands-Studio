import { useEffect } from 'react'
import { useHabitatCommsStore } from '../store/useHabitatCommsStore'
import './AgentStatusPanel.css'

function StatusIcon({ status }: { status: string }) {
  const icons: Record<string, string> = {
    active: '▶',
    listening: '◉',
    blocked: '■',
    inactive: '○',
  }
  return (
    <span className={`agent-status-icon ${status}`}>
      {icons[status] ?? '○'}
    </span>
  )
}

export default function AgentStatusPanel() {
  const { agentStatuses, unreadCounts, init, statusBarStatuses } = useHabitatCommsStore()

  useEffect(() => {
    return init()
  }, [])

  const statuses = Object.values(agentStatuses)

  return (
    <div className="agent-status-panel">
      <span className="agent-status-panel-label">Habitat</span>
      {statuses.length === 0 ? (
        <span className="agent-status-empty">No creatures connected</span>
      ) : (
        statuses.map((info) => {
          const unread = unreadCounts[info.id] ?? 0
          return (
            <div key={info.id} className="agent-status-item" title={`${info.name}: ${info.status}${info.currentIntent ? ` — claiming ${info.currentIntent.target}` : ''}`}>
              <StatusIcon status={info.status} />
              <span className="agent-status-name">{info.name}</span>
              {info.currentIntent && (
                <span className="agent-status-intent">
                  → {info.currentIntent.target.split('/').pop()}
                </span>
              )}
              {unread > 0 && (
                <span className="agent-status-unread">{unread > 99 ? '99+' : unread}</span>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
