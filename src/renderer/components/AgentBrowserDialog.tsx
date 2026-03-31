import { useCallback, useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { useHabitatStore } from '../store/useHabitatStore'
import { useTerminalStore } from '../store/useTerminalStore'
import type { SavedAgent, CreatureConfig, ShellConfig } from '../../shared/habitatTypes'
import './AgentBrowserDialog.css'

interface AgentListItem extends Omit<SavedAgent, 'memory'> {
  // memory is stripped in list response
}

interface Props {
  /** Shell index into which a selected agent will be injected */
  targetShellIndex: number
  onClose: () => void
}

export default function AgentBrowserDialog({ targetShellIndex, onClose }: Props) {
  const { activeHabitatId, getHabitat, updateHabitat, listHabitats } = useHabitatStore((s) => ({
    activeHabitatId: s.activeHabitatId,
    getHabitat: s.getHabitat,
    updateHabitat: s.updateHabitat,
    listHabitats: s.listHabitats,
  }))

  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [recalling, setRecalling] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load agents list
  useEffect(() => {
    let cancelled = false
    window.agentAPI?.list().then((list: unknown) => {
      if (!cancelled) {
        setAgents((list as AgentListItem[]) ?? [])
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const filtered = agents.filter((a) =>
    !search ||
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    (a.description ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const selectedAgent = agents.find((a) => a.id === selectedId) ?? null

  const handleRecall = useCallback(async () => {
    if (!selectedAgent || !activeHabitatId) return
    setRecalling(true)
    setError(null)

    const result = await window.agentAPI?.load(selectedAgent.id, activeHabitatId, targetShellIndex)
    if (result?.ok === false) {
      setError(result.error ?? 'Failed to load agent.')
      setRecalling(false)
      return
    }

    // Update the habitat store: replace creature in the target shell
    // The Habitat component watches the store and will re-render shells reactively
    const habitat = getHabitat(activeHabitatId)
    if (habitat) {
      const updatedShells = [...habitat.shells]
      const targetShell = updatedShells[targetShellIndex]
      const newCreature: CreatureConfig = result.creature ?? selectedAgent.creature
      updatedShells[targetShellIndex] = {
        ...targetShell,
        creature: newCreature,
      }
      updateHabitat(activeHabitatId, { shells: updatedShells, updatedAt: Date.now() })
    }

    // Also sync the terminal store so the creature's spriteId is available to syncCreatures
    const { setShellConfig, hatchCreature } = useTerminalStore.getState()
    const terminals = useTerminalStore.getState().terminals
    const targetTerminal = terminals[targetShellIndex]
    if (targetTerminal) {
      const newCreature: CreatureConfig = result.creature ?? selectedAgent.creature
      const updatedShellConfig: ShellConfig = {
        ...targetTerminal.shellConfig,
        creature: newCreature,
      }
      setShellConfig(targetTerminal.id, updatedShellConfig)
      if (newCreature.hatched) {
        hatchCreature(targetTerminal.id, newCreature.name ?? targetTerminal.name, newCreature.specialty ?? '')
      }
    }

    setRecalling(false)
    onClose()
  }, [selectedAgent, activeHabitatId, targetShellIndex, getHabitat, updateHabitat, onClose])

  const handleDelete = useCallback(async (agentId: string) => {
    if (!confirm('Delete this saved agent? This cannot be undone.')) return
    setDeleting(agentId)
    await window.agentAPI?.delete(agentId)
    setAgents((prev) => prev.filter((a) => a.id !== agentId))
    if (selectedId === agentId) setSelectedId(null)
    setDeleting(null)
  }, [selectedId])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return ReactDOM.createPortal(
    <div className="abrowse-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="abrowse-dialog" role="dialog" aria-modal="true" aria-label="Agent Library">
        <div className="abrowse-header">
          <div className="abrowse-header-left">
            <h2>Agent Library</h2>
            <span className="abrowse-target">Will inject into Shell {targetShellIndex + 1}</span>
          </div>
          <button className="abrowse-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="abrowse-toolbar">
          <input
            className="abrowse-search"
            type="text"
            placeholder="Search agents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="abrowse-body">
          {loading ? (
            <div className="abrowse-loading">Loading agents…</div>
          ) : filtered.length === 0 ? (
            <div className="abrowse-empty">
              {search ? 'No agents match your search.' : 'No saved agents yet. Save a creature from a shell to build your library.'}
            </div>
          ) : (
            <div className="abrowse-list">
              {filtered.map((agent) => (
                <div
                  key={agent.id}
                  className={`abrowse-item ${selectedId === agent.id ? 'abrowse-item-selected' : ''}`}
                  onClick={() => setSelectedId(agent.id)}
                >
                  <div className="abrowse-item-main">
                    <div className="abrowse-item-name">{agent.name}</div>
                    {agent.description && (
                      <div className="abrowse-item-desc">{agent.description}</div>
                    )}
                    <div className="abrowse-item-meta">
                      {agent.creature.hatched ? '🟢 Hatched' : `🥚 Egg step ${agent.creature.eggStep ?? 1}`}
                      {agent.memory ? ' · Has memory' : ''}
                      · Created {new Date(agent.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="abrowse-item-actions">
                    <button
                      className="abrowse-btn-abrowse abrowse-btn-delete"
                      title="Delete agent"
                      disabled={deleting !== null}
                      onClick={(e) => { e.stopPropagation(); handleDelete(agent.id) }}
                    >
                      {deleting === agent.id ? '…' : '🗑'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="abrowse-footer">
          {error && <span className="abrowse-error">{error}</span>}
          <div className="abrowse-footer-actions">
            <button className="abrowse-btn" onClick={onClose}>Cancel</button>
            <button
              className="abrowse-btn abrowse-btn-primary"
              onClick={handleRecall}
              disabled={!selectedAgent || recalling || !activeHabitatId}
            >
              {recalling ? 'Recalling…' : 'Recall Agent'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
