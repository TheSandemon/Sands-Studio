import { useCallback, useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { useHabitatStore } from '../store/useHabitatStore'
import type { SavedAgent, CreatureConfig } from '../../shared/habitatTypes'
import './AgentSaveDialog.css'

interface Props {
  shellIndex: number
  creatureId: string
  creature: CreatureConfig
  onClose: () => void
}

export default function AgentSaveDialog({ shellIndex, creatureId, creature, onClose }: Props) {
  const { activeHabitatId, getHabitat } = useHabitatStore((s) => ({
    activeHabitatId: s.activeHabitatId,
    getHabitat: s.getHabitat,
  }))

  const [name, setName] = useState(creature.name ?? '')
  const [description, setDescription] = useState(creature.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load creature memory on mount
  const [memory, setMemory] = useState<object | null>(null)
  useEffect(() => {
    if (!creatureId) return
    window.creatureAPI?.loadMemory(creatureId, activeHabitatId ?? undefined)
      .then((m: unknown) => setMemory(m as object | null))
      .catch(() => setMemory(null))
  }, [creatureId, activeHabitatId])

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('Please enter a name for this agent.')
      return
    }
    setSaving(true)
    setError(null)

    const agent: SavedAgent = {
      id: `agent-${Date.now().toString(36)}`,
      name: name.trim(),
      description: description.trim() || undefined,
      creature: {
        ...creature,
        name: name.trim(),
        description: description.trim() || undefined,
      },
      memory: memory ?? undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const result = await window.agentAPI?.save(agent)
    if (result?.ok === false) {
      setError(result.error ?? 'Failed to save agent.')
      setSaving(false)
      return
    }

    setSaving(false)
    onClose()
  }, [name, description, creature, memory, onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return ReactDOM.createPortal(
    <div className="asave-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="asave-dialog" role="dialog" aria-modal="true" aria-label="Save Agent">
        <div className="asave-header">
          <h2>Save Agent</h2>
          <button className="asave-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="asave-body">
          <div className="asave-preview">
            <span className="asave-preview-label">Saving creature</span>
            <span className="asave-preview-name">{creature.name ?? creatureId}</span>
            <span className="asave-preview-shell">Shell {shellIndex + 1}</span>
          </div>

          <div className="asave-row">
            <label className="asave-label" htmlFor="asave-name">Agent Name</label>
            <input
              id="asave-name"
              className="asave-input"
              type="text"
              value={name}
              placeholder="e.g. Atlas Dev Agent"
              onChange={(e) => { setName(e.target.value); setError(null) }}
              autoFocus
            />
          </div>

          <div className="asave-row">
            <label className="asave-label" htmlFor="asave-desc">Description <span className="asave-optional">(optional)</span></label>
            <input
              id="asave-desc"
              className="asave-input"
              type="text"
              value={description}
              placeholder="Brief description of this agent's role"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {memory && (
            <div className="asave-memory-indicator">
              Memory included ({Object.keys(memory).length} fields)
            </div>
          )}

          {error && <div className="asave-error">{error}</div>}
        </div>

        <div className="asave-footer">
          <button className="asave-btn" onClick={onClose}>Cancel</button>
          <button
            className="asave-btn asave-btn-primary"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {saving ? 'Saving…' : 'Save Agent'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
