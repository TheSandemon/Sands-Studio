import { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import './DreamStatePanel.css'

type TabId = 'log' | 'context' | 'skills' | 'hooks' | 'plugins'

interface Props {
  onClose: () => void
}

interface LogEntry {
  type: string
  timestamp: number
  sessionId?: string
  payload?: unknown
}

export default function DreamStatePanel({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('log')
  const dialogRef = useRef<HTMLDivElement>(null)

  // ── Log tab state ──────────────────────────────────────────────────────────
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)

  // ── Context tab state ─────────────────────────────────────────────────────
  const [creatures, setCreatures] = useState<Array<{ id: string; name: string; messageCount: number }>>([])
  const [contextLoading, setContextLoading] = useState(false)

  // ── Skills tab state ──────────────────────────────────────────────────────
  const [skills, setSkills] = useState<import('../../shared/habitatTypes').SkillManifest[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)

  // ── Hooks tab state ───────────────────────────────────────────────────────
  const [hooks, setHooks] = useState<import('../../shared/habitatTypes').Hook[]>([])
  const [hooksLoading, setHooksLoading] = useState(false)
  const [hookForm, setHookForm] = useState({ name: '', triggerType: 'event' as const, actionType: 'log' as const, pattern: '' })
  const [hookSubmitting, setHookSubmitting] = useState(false)

  // ── Plugins tab state ─────────────────────────────────────────────────────
  const [plugins, setPlugins] = useState<import('../../shared/habitatTypes').DiscoveredPlugin[]>([])
  const [pluginsLoading, setPluginsLoading] = useState(false)
  const [loadedPluginIds, setLoadedPluginIds] = useState<Set<string>>(new Set())

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // ── Load data per tab when tab changes ────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'log') {
      loadLog()
    } else if (activeTab === 'context') {
      loadContext()
    } else if (activeTab === 'skills') {
      loadSkills()
    } else if (activeTab === 'hooks') {
      loadHooks()
    } else if (activeTab === 'plugins') {
      loadPlugins()
    }
  }, [activeTab])

  // ── Log ────────────────────────────────────────────────────────────────────
  const loadLog = useCallback(async () => {
    setLogLoading(true)
    setLogError(null)
    try {
      const lastActive = await window.habitatlogAPI.getLastActive()
      if (!lastActive) {
        setLogEntries([])
        setLogLoading(false)
        return
      }
      const snapshot = await window.habitatlogAPI.getSnapshot(lastActive.habitatId)
      if (!snapshot) {
        setLogEntries([])
        setLogLoading(false)
        return
      }
      // Build synthetic log entries from snapshot metadata
      const entries: LogEntry[] = []
      // Capture terminal output events from terminalBuffers (most recent first)
      for (const [sessionId, buffer] of Object.entries(snapshot.terminalBuffers ?? {})) {
        if (buffer && buffer.length > 0) {
          entries.push({
            type: 'terminal:output',
            timestamp: snapshot.timestamp,
            sessionId,
            payload: { preview: buffer.slice(-200) },
          })
        }
      }
      entries.push({
        type: 'snapshot:restored',
        timestamp: snapshot.timestamp,
        payload: {
          habitatId: snapshot.habitatId,
          habitatName: snapshot.habitatName,
          eventCount: snapshot.eventCount,
          creatureCount: Object.keys(snapshot.creatureMemories ?? {}).length,
        },
      })
      // Sort by timestamp descending
      entries.sort((a, b) => b.timestamp - a.timestamp)
      setLogEntries(entries.slice(0, 50))
    } catch (err) {
      setLogError(String(err))
    } finally {
      setLogLoading(false)
    }
  }, [])

  // ── Context ─────────────────────────────────────────────────────────────────
  const loadContext = useCallback(async () => {
    setContextLoading(true)
    try {
      // Get creatures from terminal store (renderer-side)
      const terminals = window.__TERMINAL_STORE__
        ? window.__TERMINAL_STORE__.getState?.()?.terminals ?? []
        : []
      const results = await Promise.allSettled(
        terminals.map(async (t: { id: string; name?: string }) => {
          const count = await window.contextAPI.getMessageCount({ creatureId: t.id }).catch(() => 0)
          return { id: t.id, name: t.name ?? t.id, messageCount: count as number }
        })
      )
      setCreatures(results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<{ id: string; name: string; messageCount: number }>).value))
    } catch {
      setCreatures([])
    } finally {
      setContextLoading(false)
    }
  }, [])

  const handleCompact = useCallback(async (creatureId: string) => {
    try {
      const result = await window.contextAPI.compact({ creatureId })
      alert(`Compacted ${creatureId}: ${result.messageCountBefore} → ${result.messageCountAfter} messages (round ${result.round})`)
      loadContext()
    } catch (err) {
      alert(`Compact failed: ${err}`)
    }
  }, [loadContext])

  // ── Skills ─────────────────────────────────────────────────────────────────
  const loadSkills = useCallback(async () => {
    setSkillsLoading(true)
    try {
      const list = await window.skillAPI.list()
      setSkills(list)
    } catch {
      setSkills([])
    } finally {
      setSkillsLoading(false)
    }
  }, [])

  const handleDeleteSkill = useCallback(async (path: string) => {
    if (!confirm(`Delete skill at "${path}"?`)) return
    try {
      await window.skillAPI.delete({ path })
      loadSkills()
    } catch (err) {
      alert(`Delete failed: ${err}`)
    }
  }, [loadSkills])

  // ── Hooks ──────────────────────────────────────────────────────────────────
  const loadHooks = useCallback(async () => {
    setHooksLoading(true)
    try {
      const list = await window.hookAPI.list()
      setHooks(list)
    } catch {
      setHooks([])
    } finally {
      setHooksLoading(false)
    }
  }, [])

  const handleCreateHook = useCallback(async () => {
    if (!hookForm.name.trim()) {
      alert('Hook name is required')
      return
    }
    setHookSubmitting(true)
    try {
      const hook: import('../../shared/habitatTypes').Hook = {
        id: `hook-${Date.now().toString(36)}`,
        name: hookForm.name.trim(),
        trigger: hookForm.triggerType,
        condition: hookForm.triggerType === 'event'
          ? { type: 'event-type', eventType: 'terminal:output' }
          : hookForm.triggerType === 'pattern'
          ? { type: 'regex', pattern: hookForm.pattern || '.*', sourceField: 'chunk' }
          : { type: 'context-compacted' },
        action: { type: hookForm.actionType, message: `Hook "${hookForm.name}" fired` },
        enabled: true,
        createdAt: Date.now(),
      }
      await window.hookAPI.register(hook)
      setHookForm({ name: '', triggerType: 'event', actionType: 'log', pattern: '' })
      loadHooks()
    } catch (err) {
      alert(`Failed to create hook: ${err}`)
    } finally {
      setHookSubmitting(false)
    }
  }, [hookForm, loadHooks])

  const handleToggleHook = useCallback(async (hookId: string, enabled: boolean) => {
    try {
      if (enabled) {
        await window.hookAPI.disable({ hookId })
      } else {
        await window.hookAPI.enable({ hookId })
      }
      loadHooks()
    } catch (err) {
      alert(`Failed to toggle hook: ${err}`)
    }
  }, [loadHooks])

  const handleDeleteHook = useCallback(async (hookId: string) => {
    if (!confirm('Delete this hook?')) return
    try {
      await window.hookAPI.unregister({ hookId })
      loadHooks()
    } catch (err) {
      alert(`Failed to delete hook: ${err}`)
    }
  }, [loadHooks])

  // ── Plugins ────────────────────────────────────────────────────────────────
  const loadPlugins = useCallback(async () => {
    setPluginsLoading(true)
    try {
      const discovered = await window.pluginAPI.discover()
      setPlugins(discovered)
    } catch {
      setPlugins([])
    } finally {
      setPluginsLoading(false)
    }
  }, [])

  const handleLoadPlugin = useCallback(async (pluginId: string) => {
    try {
      await window.pluginAPI.load({ pluginId })
      setLoadedPluginIds(prev => new Set([...prev, pluginId]))
    } catch (err) {
      alert(`Failed to load plugin: ${err}`)
    }
  }, [])

  const handleUnloadPlugin = useCallback(async (pluginId: string) => {
    try {
      await window.pluginAPI.unload({ pluginId })
      setLoadedPluginIds(prev => {
        const next = new Set(prev)
        next.delete(pluginId)
        return next
      })
    } catch (err) {
      alert(`Failed to unload plugin: ${err}`)
    }
  }, [])

  const TABS: { id: TabId; label: string }[] = [
    { id: 'log', label: 'Log' },
    { id: 'context', label: 'Context' },
    { id: 'skills', label: 'Skills' },
    { id: 'hooks', label: 'Hooks' },
    { id: 'plugins', label: 'Plugins' },
  ]

  const renderTabContent = () => {
    switch (activeTab) {
      case 'log':
        return (
          <div className="dsp-section">
            {logLoading ? (
              <div className="dsp-loading">Loading...</div>
            ) : logError ? (
              <div className="dsp-error">Error: {logError}</div>
            ) : logEntries.length === 0 ? (
              <div className="dsp-empty">Connect Habitat to view logs</div>
            ) : (
              <div className="dsp-log-list">
                {logEntries.map((entry, i) => (
                  <div key={i} className="dsp-log-entry">
                    <span className="dsp-log-type">[{entry.type}]</span>
                    <span className="dsp-log-time">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                    {entry.sessionId && (
                      <span className="dsp-log-session">{entry.sessionId.slice(0, 8)}</span>
                    )}
                    {entry.payload && typeof entry.payload === 'object' && (
                      <span className="dsp-log-payload">
                        {JSON.stringify((entry.payload as { preview?: string }).preview ?? entry.payload).slice(0, 100)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )

      case 'context':
        return (
          <div className="dsp-section">
            {contextLoading ? (
              <div className="dsp-loading">Loading...</div>
            ) : creatures.length === 0 ? (
              <div className="dsp-empty">No creatures found</div>
            ) : (
              <table className="dsp-table">
                <thead>
                  <tr>
                    <th>Creature</th>
                    <th>Messages</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {creatures.map(c => (
                    <tr key={c.id}>
                      <td className="dsp-name-cell">{c.name}</td>
                      <td className="dsp-count-cell">{c.messageCount.toLocaleString()}</td>
                      <td>
                        <button
                          className="dsp-btn dsp-btn-small"
                          onClick={() => handleCompact(c.id)}
                        >
                          Compact
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )

      case 'skills':
        return (
          <div className="dsp-section">
            {skillsLoading ? (
              <div className="dsp-loading">Loading...</div>
            ) : skills.length === 0 ? (
              <div className="dsp-empty">No skills compiled yet</div>
            ) : (
              <table className="dsp-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Creature</th>
                    <th>Triggers</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map(s => (
                    <tr key={s.id}>
                      <td className="dsp-name-cell">{s.name}</td>
                      <td className="dsp-dim-cell">{s.creatureId}</td>
                      <td className="dsp-dim-cell">{s.triggers.join(', ')}</td>
                      <td>
                        <button
                          className="dsp-btn dsp-btn-small dsp-btn-danger"
                          onClick={() => handleDeleteSkill(s.path)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )

      case 'hooks':
        return (
          <div className="dsp-section">
            <div className="dsp-hooks-form">
              <h4>Create Hook</h4>
              <div className="dsp-form-row">
                <input
                  className="dsp-input"
                  type="text"
                  placeholder="Hook name"
                  value={hookForm.name}
                  onChange={e => setHookForm(f => ({ ...f, name: e.target.value }))}
                />
                <select
                  className="dsp-select"
                  value={hookForm.triggerType}
                  onChange={e => setHookForm(f => ({ ...f, triggerType: e.target.value as 'event' | 'pattern' | 'schedule' | 'context' }))}
                >
                  <option value="event">Event</option>
                  <option value="pattern">Pattern</option>
                  <option value="context">Context</option>
                </select>
                <select
                  className="dsp-select"
                  value={hookForm.actionType}
                  onChange={e => setHookForm(f => ({ ...f, actionType: e.target.value as 'log' | 'compact' | 'skill' | 'shell' | 'http' | 'plugin' }))}
                >
                  <option value="log">Log</option>
                  <option value="compact">Compact</option>
                  <option value="shell">Shell</option>
                </select>
                <button
                  className="dsp-btn"
                  onClick={handleCreateHook}
                  disabled={hookSubmitting}
                >
                  {hookSubmitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
            <hr className="dsp-sep" />
            {hooksLoading ? (
              <div className="dsp-loading">Loading...</div>
            ) : hooks.length === 0 ? (
              <div className="dsp-empty">No hooks registered</div>
            ) : (
              <div className="dsp-hooks-list">
                {hooks.map(h => (
                  <div key={h.id} className="dsp-hook-row">
                    <div className="dsp-hook-info">
                      <span className={`dsp-hook-enabled ${h.enabled ? 'on' : 'off'}`}>
                        {h.enabled ? 'ON' : 'OFF'}
                      </span>
                      <span className="dsp-hook-name">{h.name}</span>
                      <span className="dsp-hook-meta">
                        [{h.trigger}] {(h.condition as { type: string }).type}
                      </span>
                    </div>
                    <div className="dsp-hook-actions">
                      <button
                        className="dsp-btn dsp-btn-small"
                        onClick={() => handleToggleHook(h.id, h.enabled)}
                      >
                        {h.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="dsp-btn dsp-btn-small dsp-btn-danger"
                        onClick={() => handleDeleteHook(h.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )

      case 'plugins':
        return (
          <div className="dsp-section">
            {pluginsLoading ? (
              <div className="dsp-loading">Loading...</div>
            ) : plugins.length === 0 ? (
              <div className="dsp-empty">No plugins discovered</div>
            ) : (
              <table className="dsp-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Version</th>
                    <th>Hooks</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {plugins.map(p => (
                    <tr key={p.id}>
                      <td className="dsp-name-cell">
                        {p.manifest.name}
                        <span className="dsp-dim-cell"> — {p.id}</span>
                      </td>
                      <td className="dsp-dim-cell">{p.manifest.version}</td>
                      <td className="dsp-dim-cell">{p.manifest.hooks.join(', ')}</td>
                      <td className="dsp-status-cell">
                        {loadedPluginIds.has(p.id) ? (
                          <span className="dsp-status-badge loaded">Loaded</span>
                        ) : (
                          <span className="dsp-status-badge unloaded">Unloaded</span>
                        )}
                      </td>
                      <td>
                        {loadedPluginIds.has(p.id) ? (
                          <button
                            className="dsp-btn dsp-btn-small"
                            onClick={() => handleUnloadPlugin(p.id)}
                          >
                            Unload
                          </button>
                        ) : (
                          <button
                            className="dsp-btn dsp-btn-small"
                            onClick={() => handleLoadPlugin(p.id)}
                          >
                            Load
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
    }
  }

  return ReactDOM.createPortal(
    <div className="dsp-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dsp-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="DreamState Panel">
        <div className="dsp-header">
          <h2>DreamState</h2>
          <button className="dsp-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="dsp-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`dsp-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="dsp-body">
          {renderTabContent()}
        </div>
      </div>
    </div>,
    document.body
  )
}
