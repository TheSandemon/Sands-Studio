import { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { useTerminalStore } from '../store/useTerminalStore'
import { useHabitatStore } from '../store/useHabitatStore'
import type { Habitat, ShellConfig, CreatureConfig } from '../../shared/habitatTypes'
import './HabitatSaveDialog.css'

interface Props {
  onClose: () => void
  /** Pre-fill with this habitat's data — for self-save (update) mode */
  initialHabitat?: Habitat
}

// platform detection — safe for browser context
const IS_WINDOWS = typeof process !== 'undefined' ? process.platform === 'win32' : navigator.userAgent.includes('Windows')
const DEFAULT_SHELL = IS_WINDOWS ? 'powershell.exe' : '/bin/bash'

function defaultShellConfig(name: string, index: number): ShellConfig {
  return {
    id: `hsave-${Date.now().toString(36)}${index}`,
    name,
    shell: DEFAULT_SHELL,
    cwd: '',
    env: {},
  }
}

export default function HabitatSaveDialog({ onClose, initialHabitat }: Props) {
  const terminals = useTerminalStore((s) => s.terminals)
  const { addHabitat, updateHabitat, listHabitats } = useHabitatStore((s) => ({
    addHabitat: s.addHabitat,
    updateHabitat: s.updateHabitat,
    listHabitats: s.listHabitats,
  }))

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [shells, setShells] = useState<ShellConfig[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Build shell configs on mount — load creature memory for each shell
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)

    const buildShells = async () => {
      let built: ShellConfig[]

      if (initialHabitat) {
        // Self-save mode: pre-fill name/description from stored habitat,
        // but reload creature memory for each shell so hatching state is current
        const withMemory = await Promise.all(
          initialHabitat.shells.map(async (shell) => {
            const memory: CreatureConfig | null =
              shell.creature?.id && window.creatureAPI
                ? await window.creatureAPI.loadMemory(shell.creature.id).catch(() => null)
                : null
            const base: ShellConfig = { ...shell }
            if (memory) {
              base.creature = {
                id: memory.id,
                name: memory.name,
                specialty: memory.specialty,
                hatched: memory.hatched,
                eggStep: memory.eggStep,
                apiKey: memory.apiKey,
                baseURL: memory.baseURL,
                model: memory.model,
                mcpServers: memory.mcpServers,
                createdAt: memory.createdAt,
              }
            }
            return base
          })
        )
        built = withMemory
      } else if (terminals.length === 0) {
        built = [defaultShellConfig('Shell 1', 0)]
      } else {
        // New save mode: build from live terminals, reload creature memory for each
        const withMemory = await Promise.all(
          terminals.map(async (t, i) => {
            const memory: CreatureConfig | null =
              t.id && window.creatureAPI
                ? await window.creatureAPI.loadMemory(t.id).catch(() => null)
                : null
            const base: ShellConfig = t.shellConfig
              ? { ...t.shellConfig, id: t.id, name: t.name }
              : defaultShellConfig(t.name || `Shell ${i + 1}`, i)
            if (memory) {
              base.creature = {
                id: memory.id,
                name: memory.name,
                specialty: memory.specialty,
                hatched: memory.hatched,
                eggStep: memory.eggStep,
                apiKey: memory.apiKey,
                baseURL: memory.baseURL,
                model: memory.model,
                mcpServers: memory.mcpServers,
                createdAt: memory.createdAt,
              }
            }
            return base
          })
        )
        built = withMemory
      }

      if (!cancelled) {
        setShells(built)
        if (initialHabitat) {
          setName(initialHabitat.name)
          setDescription(initialHabitat.description ?? '')
        }
        setIsLoading(false)
      }
    }

    buildShells().catch((err) => {
      console.error('[HabitatSaveDialog] buildShells failed:', err)
      if (!cancelled) {
        setShells(terminals.length === 0
          ? [defaultShellConfig('Shell 1', 0)]
          : terminals.map((t, i) => t.shellConfig
              ? { ...t.shellConfig, id: t.id, name: t.name }
              : defaultShellConfig(t.name || `Shell ${i + 1}`, i)))
        setIsLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [terminals, initialHabitat])

  const updateShell = useCallback((index: number, patch: Partial<ShellConfig>) => {
    setShells((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], ...patch }
      return next
    })
    setDirty(true)
  }, [])

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      alert('Please enter a habitat name.')
      return
    }
    if (shells.length === 0) {
      alert('A habitat needs at least one shell.')
      return
    }
    setSaving(true)

    const trimmedName = name.trim()
    const existingHabitats = listHabitats()

    // Check for name collision (excluding self if updating)
    const collision = existingHabitats.find(
      (h) => h.name === trimmedName && h.id !== initialHabitat?.id
    )

    if (collision) {
      const confirmed = confirm(
        `A habitat named "${trimmedName}" already exists. Overwrite it?`
      )
      if (!confirmed) {
        setSaving(false)
        return
      }
      // Update the colliding habitat with the new data
      updateHabitat(collision.id, {
        name: trimmedName,
        description: description.trim(),
        shells: shells.map((s) => ({ ...s, cwd: s.cwd || '' })),
        updatedAt: Date.now(),
      })
      setSaving(false)
      onClose()
      return
    }

    // No collision — create or update
    const habitatId = initialHabitat?.id ?? `habitat-${Date.now().toString(36)}`

    if (initialHabitat?.id) {
      // Self-save / update existing
      updateHabitat(initialHabitat.id, {
        name: trimmedName,
        description: description.trim(),
        shells: shells.map((s) => ({ ...s, cwd: s.cwd || '' })),
        updatedAt: Date.now(),
      })
    } else {
      // Brand new habitat
      addHabitat({
        id: habitatId,
        name: trimmedName,
        description: description.trim(),
        shells: shells.map((s) => ({ ...s, cwd: s.cwd || '' })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }

    // Emit habitat:applied event after successful save
    window.habitatlogAPI?.writeEvent({
      type: 'habitat:applied',
      timestamp: Date.now(),
      payload: {
        habitatId,
        habitatName: trimmedName,
      },
    }).catch(() => {})

    setSaving(false)
    onClose()
  }, [name, description, shells, initialHabitat, addHabitat, updateHabitat, listHabitats, onClose])

  const handleClose = useCallback(() => {
    if (dirty && !confirm('Discard unsaved changes?')) return
    onClose()
  }, [dirty, onClose])

  // Escape / Ctrl+S
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { handleClose(); return }
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSave() }
    }
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
      prev?.focus()
    }
  }, [handleClose, handleSave])

  return ReactDOM.createPortal(
    <div className="hsave-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="hsave-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Save Habitat">
        <div className="hsave-header">
          <h2>{initialHabitat ? 'Update Habitat' : 'Save Habitat'}</h2>
          <button className="hsave-close-btn" onClick={handleClose} aria-label="Close">✕</button>
        </div>

        <div className="hsave-body">
          <div className="hsave-row">
            <label className="hsave-label" htmlFor="hsave-name">Name</label>
            <input
              id="hsave-name"
              className="hsave-input"
              type="text"
              value={name}
              placeholder="My Dev Setup"
              onChange={(e) => { setName(e.target.value); setDirty(true) }}
              autoFocus
            />
          </div>

          <div className="hsave-row">
            <label className="hsave-label" htmlFor="hsave-desc">Description</label>
            <input
              id="hsave-desc"
              className="hsave-input"
              type="text"
              value={description}
              placeholder="Optional description"
              onChange={(e) => { setDescription(e.target.value); setDirty(true) }}
            />
          </div>

          <div className="hsave-section-title">
            Shells
            <span className="hsave-shell-count">{shells.length} shell{shells.length !== 1 ? 's' : ''}</span>
          </div>

          {isLoading ? (
            <div className="hsave-loading">Loading creature data…</div>
          ) : (
            <div className="hsave-shells-list">
              {shells.map((shell, i) => (
                <div key={shell.id || i} className="hsave-shell-row">
                  <div className="hsave-shell-index">{i + 1}</div>
                  <div className="hsave-shell-fields">
                    <input
                      className="hsave-input hsave-shell-name"
                      type="text"
                      value={shell.name}
                      placeholder="Shell name"
                      onChange={(e) => updateShell(i, { name: e.target.value })}
                    />
                    <input
                      className="hsave-input hsave-shell-shell"
                      type="text"
                      value={shell.shell}
                      placeholder="Shell path (e.g. powershell.exe)"
                      onChange={(e) => updateShell(i, { shell: e.target.value })}
                    />
                    <input
                      className="hsave-input hsave-shell-cwd"
                      type="text"
                      value={shell.cwd}
                      placeholder="Working directory"
                      onChange={(e) => updateShell(i, { cwd: e.target.value })}
                    />
                    {shell.creature && (
                      <div className="hsave-creature-info">
                        {shell.creature.hatched
                          ? `Hatched: ${shell.creature.name ?? '?'}${shell.creature.specialty ? ` — ${shell.creature.specialty}` : ''}`
                          : `Egg (step ${shell.creature.eggStep ?? 1}/4)`}
                      </div>
                    )}
                  </div>
                  <button
                    className="hsave-shell-remove"
                    title="Remove shell"
                    onClick={() => {
                      if (shells.length <= 1) return
                      setShells((prev) => prev.filter((_, j) => j !== i))
                      setDirty(true)
                    }}
                    disabled={shells.length <= 1}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="hsave-footer">
          <span className="hsave-dirty-indicator">{dirty ? 'Unsaved changes' : ''}</span>
          <div className="hsave-footer-actions">
            <button className="hsave-btn" onClick={handleClose}>Cancel</button>
            <button
              className="hsave-btn hsave-btn-primary"
              onClick={handleSave}
              disabled={saving || isLoading || !name.trim()}
            >
              {saving ? 'Saving...' : initialHabitat ? 'Update Habitat' : 'Save Habitat'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
