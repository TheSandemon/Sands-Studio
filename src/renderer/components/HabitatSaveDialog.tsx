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

async function buildShellConfigs(
  initialHabitat: Habitat | undefined,
  activeHabitatId: string | null,
  getTerminals: () => Array<{ id: string; name: string; shellConfig?: ShellConfig }>,
): Promise<ShellConfig[]> {
  if (initialHabitat) {
    // Merge: include all saved shells + any new terminals not yet in the habitat.
    // Match terminals to saved shells by ID first, then by name as a fallback
    // (habitat:apply regenerates terminal IDs from creature.id, breaking ID matching).
    const savedIds = new Set(initialHabitat.shells.map((s) => s.id))
    const savedNames = new Map(initialHabitat.shells.map((s) => [s.name.toLowerCase(), s]))
    const currentTerminals = getTerminals()

    // Exclude terminals that either match a saved shell by ID or by name.
    const newTerminals = currentTerminals.filter((t) => {
      if (savedIds.has(t.id)) return false
      const nameKey = (t.name || '').toLowerCase()
      if (savedNames.has(nameKey)) return false
      return true
    })

    const savedResults = await Promise.all(
      initialHabitat.shells.map(async (shell) => {
        const mem = shell.creature?.id && window.creatureAPI
          ? await window.creatureAPI.loadMemory(shell.creature.id, activeHabitatId ?? undefined).catch(() => null)
          : null
        // Try to find a matching terminal by name to update the shell's ID to the
        // current terminal ID (prevents duplicate entries in the shell list).
        const nameKey = (shell.name || '').toLowerCase()
        const matchedTerminal = savedNames.has(nameKey)
          ? currentTerminals.find((t) => (t.name || '').toLowerCase() === nameKey)
          : undefined
        const base: ShellConfig = {
          ...shell,
          ...(matchedTerminal ? { id: matchedTerminal.id } : {}),
        }
        if (mem) {
          base.creature = {
            id: mem.id,
            name: mem.name,
            specialty: mem.specialty,
            hatched: mem.hatched,
            eggStep: mem.eggStep,
            apiKey: mem.apiKey,
            baseURL: mem.baseURL,
            model: mem.model,
            mcpServers: mem.mcpServers,
            createdAt: mem.createdAt,
          }
        }
        return base
      })
    )

    const newResults = await Promise.all(
      newTerminals.map(async (t, i) => {
        const mem = t.id && window.creatureAPI
          ? await window.creatureAPI.loadMemory(t.id, activeHabitatId ?? undefined).catch(() => null)
          : null
        const base: ShellConfig = t.shellConfig
          ? { ...t.shellConfig, id: t.id, name: t.name }
          : defaultShellConfig(t.name || `Shell ${i + 1}`, i)
        if (mem) {
          base.creature = {
            id: mem.id,
            name: mem.name,
            specialty: mem.specialty,
            hatched: mem.hatched,
            eggStep: mem.eggStep,
            apiKey: mem.apiKey,
            baseURL: mem.baseURL,
            model: mem.model,
            mcpServers: mem.mcpServers,
            createdAt: mem.createdAt,
          }
        }
        return base
      })
    )

    return [...savedResults, ...newResults]
  }

  const terminals = getTerminals()
  if (terminals.length === 0) {
    return [defaultShellConfig('Shell 1', 0)]
  }

  const results = await Promise.all(
    terminals.map(async (t, i) => {
      const mem = t.id && window.creatureAPI
        ? await window.creatureAPI.loadMemory(t.id, activeHabitatId ?? undefined).catch(() => null)
        : null
      const base: ShellConfig = t.shellConfig
        ? { ...t.shellConfig, id: t.id, name: t.name }
        : defaultShellConfig(t.name || `Shell ${i + 1}`, i)
      if (mem) {
        base.creature = {
          id: mem.id,
          name: mem.name,
          specialty: mem.specialty,
          hatched: mem.hatched,
          eggStep: mem.eggStep,
          apiKey: mem.apiKey,
          baseURL: mem.baseURL,
          model: mem.model,
          mcpServers: mem.mcpServers,
          createdAt: mem.createdAt,
        }
      }
      return base
    })
  )
  return results
}

export default function HabitatSaveDialog({ onClose, initialHabitat }: Props) {
  const addHabitat = useHabitatStore((s) => s.addHabitat)
  const updateHabitat = useHabitatStore((s) => s.updateHabitat)
  const listHabitats = useHabitatStore((s) => s.listHabitats)
  const activeHabitatId = useHabitatStore((s) => s.activeHabitatId)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [shells, setShells] = useState<ShellConfig[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const dialogRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)

  // Load shell configs on mount
  useEffect(() => {
    mounted.current = true
    setIsLoading(true)

    buildShellConfigs(
      initialHabitat,
      activeHabitatId ?? null,
      () => useTerminalStore.getState().terminals,
    )
      .then((built) => {
        if (!mounted.current) return
        setShells(built)
        if (initialHabitat) {
          setName(initialHabitat.name)
          setDescription(initialHabitat.description ?? '')
        }
        setIsLoading(false)
      })
      .catch(() => {
        if (!mounted.current) return
        const terminals = useTerminalStore.getState().terminals
        setShells(
          terminals.length === 0
            ? [defaultShellConfig('Shell 1', 0)]
            : terminals.map((t, i) =>
                t.shellConfig
                  ? { ...t.shellConfig, id: t.id, name: t.name }
                  : defaultShellConfig(t.name || `Shell ${i + 1}`, i)
              )
        )
        setIsLoading(false)
      })

    return () => { mounted.current = false }
  }, []) // intentionally empty — run once on mount

  const updateShell = useCallback((index: number, patch: Partial<ShellConfig>) => {
    setShells((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], ...patch }
      return next
    })
    setDirty(true)
  }, [])

  const handleSave = useCallback(async () => {
    console.log('[HabitatSaveDialog] handleSave: shells=', shells.length, 'habitats=', listHabitats().length)
    try {
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

    // Sync habitat IDs to main process for DreamState migration tracking
    const allIds = listHabitats().map((h) => h.id)
    if (!allIds.includes(habitatId)) allIds.push(habitatId)
    window.habitatAPI?.trackHabitats?.(allIds).catch(() => {})

    setSaving(false)
    onClose()
    } catch (err) {
      console.error('[HabitatSaveDialog] handleSave failed:', err)
      setSaving(false)
    }
  }, [name, description, shells, initialHabitat, addHabitat, updateHabitat, listHabitats, onClose, activeHabitatId])

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
