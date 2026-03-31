import { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { useHabitatStore } from '../store/useHabitatStore'
import type { Habitat } from '../../shared/habitatTypes'
import './HabitatManagerDialog.css'

interface Props {
  onClose: () => void
}

export default function HabitatManagerDialog({ onClose }: Props) {
  const habitats = useHabitatStore((s) => s.habitats)
  const updateHabitat = useHabitatStore((s) => s.updateHabitat)
  const removeHabitat = useHabitatStore((s) => s.removeHabitat)
  const addHabitat = useHabitatStore((s) => s.addHabitat)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [importResult, setImportResult] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const handleRename = useCallback((h: Habitat) => {
    if (!editName.trim()) return
    updateHabitat(h.id, { name: editName.trim() })
    setEditingId(null)
    setEditName('')
  }, [editName, updateHabitat])

  const handleDelete = useCallback((h: Habitat) => {
    if (!confirm(`Delete habitat "${h.name}"? This cannot be undone.`)) return
    removeHabitat(h.id)
    // Sync updated habitat list to main process for DreamState tracking
    const remaining = useHabitatStore.getState().listHabitats()
    window.habitatAPI?.trackHabitats?.(remaining.map((hab) => hab.id))
  }, [removeHabitat])

  const handleExport = useCallback(async (h: Habitat) => {
    try {
      const result = await window.habitatAPI.export(h)
      if (result.canceled) return
      setImportResult(`Exported to ${result.path}`)
      setTimeout(() => setImportResult(null), 3000)
    } catch (err) {
      alert(`Export failed: ${err}`)
    }
  }, [])

  const handleImport = useCallback(async () => {
    try {
      const result = await window.habitatAPI.import()
      if (result.canceled || !result.habitat) return
      const habitat = result.habitat as Habitat
      // Give it a fresh ID and updated timestamp
      const imported: Habitat = {
        ...habitat,
        id: `habitat-${Date.now().toString(36)}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      addHabitat(imported)
      // Sync updated habitat list to main process for DreamState tracking
      const all = useHabitatStore.getState().listHabitats()
      window.habitatAPI?.trackHabitats?.(all.map((hab) => hab.id))
      setImportResult(`Imported "${imported.name}"`)
      setTimeout(() => setImportResult(null), 3000)
    } catch (err) {
      alert(`Import failed: ${err}`)
    }
  }, [addHabitat])

  const handleApply = useCallback(async (h: Habitat) => {
    try {
      await window.habitatAPI.apply(h)
      // Ensure this habitat is tracked for DreamState
      const all = useHabitatStore.getState().listHabitats()
      window.habitatAPI?.trackHabitats?.(all.map((hab) => hab.id))
    } catch (err) {
      alert(`Failed to apply habitat: ${err}`)
    }
    onClose()
  }, [onClose])

  const handleNewHabitat = useCallback(async () => {
    try {
      await window.habitatAPI.clear()
      useHabitatStore.getState().setActiveHabitatId(null)
      window.habitatAPI?.trackHabitats?.([])
    } catch (err) {
      alert(`Failed to clear habitat: ${err}`)
    }
    onClose()
  }, [onClose])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  // Escape
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
      prev?.focus()
    }
  }, [handleClose])

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  return ReactDOM.createPortal(
    <div className="hmgr-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="hmgr-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Manage Habitats">
        <div className="hmgr-header">
          <h2>Manage Habitats</h2>
          <button className="hmgr-close-btn" onClick={handleClose} aria-label="Close">✕</button>
        </div>

        <div className="hmgr-body">
          {habitats.length === 0 ? (
            <div className="hmgr-empty">
              <p>No habitats saved yet.</p>
              <p>Use <strong>Habitats &gt; Save Current Shells as Habitat…</strong> to create one.</p>
            </div>
          ) : (
            <table className="hmgr-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Shells</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {habitats.map((h) => (
                  <tr key={h.id} onDoubleClick={() => handleApply(h)}>
                    <td className="hmgr-name-cell">
                      {editingId === h.id ? (
                        <input
                          className="hmgr-edit-input"
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename(h)
                            if (e.key === 'Escape') { setEditingId(null); setEditName('') }
                          }}
                          onBlur={() => handleRename(h)}
                          autoFocus
                        />
                      ) : (
                        <span
                          className="hmgr-name"
                          onClick={() => { setEditingId(h.id); setEditName(h.name) }}
                          title="Click to rename"
                        >
                          {h.name}
                        </span>
                      )}
                      {h.description && (
                        <span className="hmgr-desc">{h.description}</span>
                      )}
                    </td>
                    <td className="hmgr-shells-cell">
                      {h.shells.length} shell{h.shells.length !== 1 ? 's' : ''}
                    </td>
                    <td className="hmgr-date-cell">
                      {formatDate(h.updatedAt)}
                    </td>
                    <td className="hmgr-actions-cell">
                      <button
                        className="hmgr-action-btn hmgr-apply-btn"
                        title="Apply this habitat"
                        onClick={() => handleApply(h)}
                      >
                        ▶
                      </button>
                      <button
                        className="hmgr-action-btn hmgr-export-btn"
                        title="Export to JSON"
                        onClick={() => handleExport(h)}
                      >
                        ↓
                      </button>
                      <button
                        className="hmgr-action-btn hmgr-rename-btn"
                        title="Rename"
                        onClick={() => { setEditingId(h.id); setEditName(h.name) }}
                      >
                        ✎
                      </button>
                      <button
                        className="hmgr-action-btn hmgr-delete-btn"
                        title="Delete"
                        onClick={() => handleDelete(h)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {importResult && (
            <div className="hmgr-import-result">{importResult}</div>
          )}
        </div>

        <div className="hmgr-footer">
          <div className="hmgr-footer-actions">
            <button
              className="hmgr-btn hmgr-btn-new-habitat"
              onClick={handleNewHabitat}
              title="Kill all shells and start fresh — no habitat loaded"
            >
              + New Empty Habitat
            </button>
            <button className="hmgr-btn" onClick={handleImport}>
              Import from File…
            </button>
          </div>
          <button className="hmgr-btn" onClick={handleClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
