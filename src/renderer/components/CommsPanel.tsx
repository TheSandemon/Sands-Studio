import { useEffect, useRef, useState } from 'react'
import { useHabitatCommsStore } from '../store/useHabitatCommsStore'
import { useTerminalStore } from '../store/useTerminalStore'
import type { HabitatMessage, AgentStatusInfo } from '../../shared/habitatCommsTypes'
import './CommsPanel.css'

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function MessageRow({ msg }: { msg: HabitatMessage }) {
  const icon = msg.type === 'direct' ? '✉' : msg.type === 'thread' ? '💬' : msg.type === 'broadcast' ? '📢' : msg.type === 'intent' ? '⚡' : msg.type === 'handoff' ? '📦' : '•'
  return (
    <div className={`comms-msg comms-msg-${msg.type}`}>
      <span className="comms-msg-icon">{icon}</span>
      <span className="comms-msg-sender">{msg.senderName}</span>
      <span className="comms-msg-content">{msg.content}</span>
      <span className="comms-msg-time">{formatTime(msg.timestamp)}</span>
    </div>
  )
}

function ThreadView({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const { threads } = useHabitatCommsStore()
  const thread = threads[threadId]
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [thread?.messages.length])

  if (!thread) return (
    <div className="comms-panel">
      <div className="comms-header">
        <button className="comms-back" onClick={onBack}>← Back</button>
        <span className="comms-header-title">Thread not found</span>
      </div>
    </div>
  )

  return (
    <div className="comms-panel">
      <div className="comms-header">
        <button className="comms-back" onClick={onBack}>← Back</button>
        <span className="comms-header-title">💬 {thread.topic}</span>
        <span className="comms-header-count">{thread.messages.length} msgs</span>
      </div>
      <div className="comms-messages" ref={scrollRef}>
        {thread.messages.map((msg) => (
          <MessageRow key={msg.id} msg={msg} />
        ))}
      </div>
    </div>
  )
}

export default function CommsPanel() {
  const { recentMessages, threads, addMessage } = useHabitatCommsStore()
  const terminals = useTerminalStore((s) => s.terminals)
  const [activeThread, setActiveThread] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'direct' | 'broadcast' | 'thread'>('all')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Register all hatched terminals with the comms bus on mount
  useEffect(() => {
    if (!window.habitatCommsAPI) return
    for (const t of terminals) {
      if (t.hatched && t.creatureName) {
        window.habitatCommsAPI.registerAgent(t.id, t.creatureName).catch(() => {})
      }
    }
  }, [terminals])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!activeThread && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [recentMessages.length, activeThread])

  if (activeThread) {
    return <ThreadView threadId={activeThread} onBack={() => setActiveThread(null)} />
  }

  const threadList = Object.values(threads).sort((a, b) => b.lastActivity - a.lastActivity)
  const filtered = recentMessages.filter((m) => filter === 'all' || m.type === filter)

  return (
    <div className="comms-panel">
      <div className="comms-header">
        <span className="comms-header-title">Habitat Comms</span>
        <div className="comms-filter-tabs">
          {(['all', 'direct', 'broadcast', 'thread'] as const).map((f) => (
            <button
              key={f}
              className={`comms-filter-tab${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {threadList.length > 0 && (
        <div className="comms-threads-section">
          <div className="comms-section-label">Active Threads</div>
          {threadList.slice(0, 5).map((t) => (
            <button key={t.id} className="comms-thread-row" onClick={() => setActiveThread(t.id)}>
              <span className="comms-thread-icon">💬</span>
              <span className="comms-thread-topic">{t.topic}</span>
              <span className="comms-thread-count">{t.messages.length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="comms-messages" ref={scrollRef}>
        {filtered.length === 0 ? (
          <div className="comms-empty">No messages yet. Creatures can communicate using send_habitat_message or send_direct_message.</div>
        ) : (
          filtered.map((msg) => (
            <div key={msg.id}>
              {msg.type === 'thread' && !activeThread && (
                <button className="comms-thread-preview" onClick={() => setActiveThread(msg.threadId ?? msg.id)}>
                  <MessageRow msg={msg} />
                  <span className="comms-thread-cta">→ View thread</span>
                </button>
              )}
              {msg.type !== 'thread' && <MessageRow msg={msg} />}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
