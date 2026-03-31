import { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { useTerminalStore } from '../store/useTerminalStore'
import './ShellSettingsDialog.css'

interface Props {
  open: boolean
  onClose: () => void
}

/** Available sprites — all come from assets/sprites/ */
const SPRITE_OPTIONS: { id: string; label: string; emoji: string }[] = [
  { id: 'bat', label: 'Bat', emoji: '🦇' },
  { id: 'crab', label: 'Crab', emoji: '🦀' },
  { id: 'fish', label: 'Fish', emoji: '🐟' },
  { id: 'frog', label: 'Frog', emoji: '🐸' },
  { id: 'ghost', label: 'Ghost', emoji: '👻' },
  { id: 'goblin', label: 'Goblin', emoji: '👺' },
  { id: 'heart', label: 'Heart', emoji: '❤️' },
  { id: 'mushroom', label: 'Mushroom', emoji: '🍄' },
  { id: 'skeleton', label: 'Skeleton', emoji: '💀' },
  { id: 'slime', label: 'Slime', emoji: '🟢' },
  { id: 'spider', label: 'Spider', emoji: '🕷️' },
]

export default function SpriteManagerDialog({ open, onClose }: Props) {
  const terminals = useTerminalStore((s) => s.terminals)
  const setShellConfig = useTerminalStore((s) => s.setShellConfig)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Per-terminal sprite selections: terminalId → spriteId | null (null = no sprite assigned)
  const [selected, setSelected] = useState<Record<string, string | null>>({})

  // Sync selections when dialog opens or terminals change
  useEffect(() => {
    if (!open) return
    const initial: Record<string, string | null> = {}
    for (const t of terminals) {
      initial[t.id] = t.shellConfig?.creature?.spriteId ?? null
    }
    setSelected(initial)
  }, [open, terminals])

  const handleSelect = useCallback((terminalId: string, spriteId: string) => {
    setSelected((prev) => ({
      ...prev,
      [terminalId]: prev[terminalId] === spriteId ? null : spriteId,
    }))
  }, [])

  const handleApply = useCallback(() => {
    for (const t of terminals) {
      const newSpriteId = selected[t.id]
      const oldSpriteId = t.shellConfig?.creature?.spriteId ?? null
      if (newSpriteId === oldSpriteId) continue

      const existing = t.shellConfig ?? {}
      setShellConfig(t.id, {
        ...existing,
        creature: {
          ...existing.creature,
          hatched: true,
          spriteId: newSpriteId ?? undefined,
        },
      })
    }
    onClose()
  }, [terminals, selected, setShellConfig, onClose])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  // Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, handleClose])

  if (!open) return null

  return ReactDOM.createPortal(
    <div className="shsett-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="shsett-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Sprites" style={{ width: 520 }}>
        <div className="shsett-header">
          <h2>Sprites</h2>
          <span className="shsett-session-name">{terminals.length} shell{terminals.length !== 1 ? 's' : ''}</span>
          <button className="shsett-close-btn" onClick={handleClose} aria-label="Close">✕</button>
        </div>

        <div className="shsett-body" style={{ overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {terminals.length === 0 ? (
            <p className="shsett-hint">No shells open. Create a shell first.</p>
          ) : (
            terminals.map((t) => (
              <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text, #c8cce4)', fontWeight: 500, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name ?? t.id}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim, #8888aa)' }}>
                    {selected[t.id] ? SPRITE_OPTIONS.find(s => s.id === selected[t.id])?.label ?? selected[t.id] : '—'}
                  </span>
                </div>
                <div className="shsett-sprite-grid">
                  {SPRITE_OPTIONS.map((s) => (
                    <button
                      key={s.id}
                      className={`shsett-sprite-btn${selected[t.id] === s.id ? ' shsett-sprite-btn-selected' : ''}`}
                      onClick={() => handleSelect(t.id, s.id)}
                      title={s.label}
                    >
                      <span className="shsett-sprite-icon">{s.emoji}</span>
                      <span className="shsett-sprite-name">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="shsett-footer">
          <span className="shsett-dirty-indicator" />
          <div className="shsett-footer-actions">
            <button className="shsett-btn" onClick={handleClose}>Cancel</button>
            <button className="shsett-btn shsett-btn-primary" onClick={handleApply}>
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
