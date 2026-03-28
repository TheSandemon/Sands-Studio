import { useEffect, useRef, useState, useCallback } from 'react'
import { useTerminalStore } from '../store/useTerminalStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useModuleStore } from '../stores/useModuleStore'
import { useHabitatStore } from '../store/useHabitatStore'
import type { Habitat } from '../../shared/habitatTypes'
import './MenuBar.css'

interface MenuAction {
  label: string
  shortcut?: string
  disabled?: boolean
  separator?: true
  onClick?: () => void
}

interface MenuDef {
  id: string
  label: string
  items: MenuAction[]
}

interface MenuBarProps {
  onOpenSettings: () => void
  onCreateModule: () => void
  onCreateModuleV2: () => void
  onOpenModuleSettings: (moduleId: string) => void
  onSaveHabitat: () => void
  onManageHabitats: () => void
  onOpenShellSettings: (sessionId: string) => void
  onOpenDreamState: () => void
}

export default function MenuBar({ onOpenSettings, onCreateModule, onCreateModuleV2, onOpenModuleSettings, onSaveHabitat, onManageHabitats, onOpenShellSettings, onOpenDreamState }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [moduleList, setModuleList] = useState<string[]>([])
  const [snapshotIds, setSnapshotIds] = useState<string[]>([])
  const menuBarRef = useRef<HTMLDivElement>(null)
  const addTerminal = useTerminalStore((s) => s.addTerminal)
  const terminals = useTerminalStore((s) => s.terminals)
  const habitats = useHabitatStore((s) => s.habitats)
  const { habitatVisible, terminalVisible, setSettings } = useSettingsStore()
  const moduleStatus = useModuleStore((s) => s.status)
  const savedSnapshotIds = useModuleStore((s) => s.savedSnapshotIds)

  // Safe accessor — guards against moduleAPI not being ready yet
  const api = () => {
    if (!window.moduleAPI) throw new Error('Module API not ready')
    return window.moduleAPI
  }

  // Refresh module list AND snapshot checks when modules menu opens
  const handleModulesMenuOpen = useCallback(async () => {
    try {
      const list = await api().listModules()
      setModuleList(list)
      // Check which modules have saved snapshots
      const snapshotChecks = await Promise.all(
        list.map(async (id) => {
          try {
            return await api().hasSnapshot(id) ? id : null
          } catch {
            return null
          }
        })
      )
      setSnapshotIds(snapshotChecks.filter(Boolean) as string[])
      useModuleStore.getState().setSavedSnapshotIds(snapshotChecks.filter(Boolean) as string[])
    } catch {
      setModuleList([])
      setSnapshotIds([])
    }
  }, [])

  const handleLaunchModule = useCallback(async (id: string) => {
    try {
      const result = await api().loadModule(id) as {
        manifest: import('../module-engine/types').ModuleManifest
        assetPaths: Record<string, string>
      }
      useModuleStore.getState().loadModule(result.manifest, result.assetPaths ?? {})
    } catch (err) {
      alert(`Failed to load module: ${err}`)
    }
  }, [])

  const handleResumeModule = useCallback(async (id: string) => {
    try {
      await api().resumeFromSnapshot(id)
    } catch (err) {
      alert(`Failed to resume module: ${err}`)
    }
  }, [])

  const handleCreateModule = useCallback(() => {
    onCreateModule()
  }, [onCreateModule])

  const handleCreateModuleV2 = useCallback(() => {
    onCreateModuleV2()
  }, [onCreateModuleV2])

  const handleStopModule = useCallback(() => {
    api().stopModule()
    // Don't reset store here — let the orchestrator's module:status:'stopped' IPC message
    // flow naturally to the App's onStatus listener which calls reset().
  }, [])

  const MODULES_ITEMS: MenuAction[] = moduleStatus !== 'idle' && moduleStatus !== 'stopped' ? [
    { label: `▶ ${moduleStatus === 'running' ? 'Running...' : moduleStatus === 'paused' ? 'Paused' : 'Loading...'}`, disabled: true },
    { separator: true },
    { label: 'Stop Module', onClick: handleStopModule },
  ] : moduleList.length === 0 ? [
    { label: 'No Modules', disabled: true },
    { separator: true },
    { label: 'Create Module…', onClick: handleCreateModule },
    { label: 'Create Module (V2 — cards)', onClick: handleCreateModuleV2 },
  ] : [
    // Module entries with settings cog are rendered via custom renderModulesDropdown below
    // This array only contains the trailing create actions
    { separator: true },
    { label: 'Create Module…', onClick: handleCreateModule },
    { label: 'Create Module (V2 — cards)', onClick: handleCreateModuleV2 },
  ]

  // Habitats — static items (list rendered via custom dropdown)
  const HABITATS_ITEMS: MenuAction[] = [
    { label: 'Save Current Shells as Habitat…', onClick: () => { onSaveHabitat(); setOpenMenu(null) } },
    { separator: true },
    { label: 'Manage Habitats…', onClick: () => { onManageHabitats(); setOpenMenu(null) } },
  ]

  // Apply a habitat — kills all current PTYs and recreates them via main process
  const handleApplyHabitat = useCallback(async (habitat: Habitat) => {
    try {
      await window.habitatAPI.apply(habitat)
    } catch (err) {
      alert(`Failed to apply habitat: ${err}`)
    }
    setOpenMenu(null)
  }, [])

  // Custom renderer for habitats dropdown
  const renderHabitatsDropdown = () => {
    return (
      <div className="menubar-dropdown">
        <button
          className="menubar-dropdown-item"
          onClick={() => { onSaveHabitat(); setOpenMenu(null) }}
        >
          <span className="menubar-item-label">Save Current Shells as Habitat…</span>
        </button>
        <hr className="menubar-sep" />
        {habitats.length === 0 ? (
          <button className="menubar-dropdown-item" disabled>
            <span className="menubar-item-label">No Habitats</span>
          </button>
        ) : (
          habitats.map((h) => (
            <div key={h.id} className="menubar-module-row">
              <button
                className="menubar-dropdown-item menubar-module-item"
                onClick={() => handleApplyHabitat(h)}
              >
                <span className="menubar-item-label">{h.name}</span>
                <span className="menubar-item-hint">{h.shells.length} shell{h.shells.length !== 1 ? 's' : ''}</span>
              </button>
              <button
                className="menubar-module-cog"
                title={`Shell settings for ${h.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  // Open shell settings for the first shell in this habitat
                  if (h.shells.length > 0) {
                    onOpenShellSettings(h.shells[0].id)
                  }
                  setOpenMenu(null)
                }}
              >
                ⚙
              </button>
            </div>
          ))
        )}
        <hr className="menubar-sep" />
        <button
          className="menubar-dropdown-item"
          onClick={() => { onManageHabitats(); setOpenMenu(null) }}
        >
          <span className="menubar-item-label">Manage Habitats…</span>
        </button>
      </div>
    )
  }

  // Custom renderer for modules dropdown to support settings cog buttons
  const renderModulesDropdown = () => {
    const isActive = moduleStatus !== 'idle' && moduleStatus !== 'stopped'
    return (
      <div className="menubar-dropdown">
        {isActive ? (
          // Running state — show status + stop
          <>
            <button className="menubar-dropdown-item" disabled>
              <span className="menubar-item-label">
                ▶ {moduleStatus === 'running' ? 'Running...' : moduleStatus === 'paused' ? 'Paused' : 'Loading...'}
              </span>
            </button>
            <hr className="menubar-sep" />
            <button className="menubar-dropdown-item" onClick={() => { handleStopModule(); setOpenMenu(null) }}>
              <span className="menubar-item-label">Stop Module</span>
            </button>
          </>
        ) : moduleList.length === 0 ? (
          // No modules
          <>
            <button className="menubar-dropdown-item" disabled>
              <span className="menubar-item-label">No Modules</span>
            </button>
            <hr className="menubar-sep" />
            <button className="menubar-dropdown-item" onClick={() => { handleCreateModule(); setOpenMenu(null) }}>
              <span className="menubar-item-label">Create Module…</span>
            </button>
            <button className="menubar-dropdown-item" onClick={() => { handleCreateModuleV2(); setOpenMenu(null) }}>
              <span className="menubar-item-label">Create Module (V2 — cards)</span>
            </button>
          </>
        ) : (
          // Module list with settings cog
          <>
            {moduleList.map((id) => {
              const hasSnapshot = snapshotIds.includes(id)
              return (
                <div key={id} className="menubar-module-row">
                  {hasSnapshot ? (
                    <>
                      <button
                        className="menubar-dropdown-item menubar-module-item"
                        onClick={() => { handleResumeModule(id); setOpenMenu(null) }}
                      >
                        <span className="menubar-item-label">{id} ▶ Resume</span>
                      </button>
                      <button
                        className="menubar-dropdown-item menubar-module-fresh"
                        onClick={() => { handleLaunchModule(id); setOpenMenu(null) }}
                      >
                        <span className="menubar-item-label">(fresh)</span>
                      </button>
                    </>
                  ) : (
                    <button
                      className="menubar-dropdown-item menubar-module-item"
                      onClick={() => { handleLaunchModule(id); setOpenMenu(null) }}
                    >
                      <span className="menubar-item-label">{id}</span>
                    </button>
                  )}
                  <button
                    className="menubar-module-cog"
                    title={`Settings for ${id}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenModuleSettings(id)
                      setOpenMenu(null)
                    }}
                  >
                    ⚙
                  </button>
                </div>
              )
            })}
            <hr className="menubar-sep" />
            <button className="menubar-dropdown-item" onClick={() => { handleCreateModule(); setOpenMenu(null) }}>
              <span className="menubar-item-label">Create Module…</span>
            </button>
            <button className="menubar-dropdown-item" onClick={() => { handleCreateModuleV2(); setOpenMenu(null) }}>
              <span className="menubar-item-label">Create Module (V2 — cards)</span>
            </button>
          </>
        )}
      </div>
    )
  }

  // Build menus dynamically so they capture current store state
  const MENUS: MenuDef[] = [
    {
      id: 'file',
      label: 'File',
      items: [
        {
          label: 'New Shell',
          shortcut: 'Ctrl+Shift+T',
          onClick: () => addTerminal(),
        },
        { separator: true },
        {
          label: 'Quit',
          shortcut: 'Alt+F4',
          onClick: () => window.windowAPI.close(),
        },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        {
          label: 'Copy',
          shortcut: 'Ctrl+C',
          onClick: () => document.execCommand('copy'),
        },
        {
          label: 'Paste',
          shortcut: 'Ctrl+V',
          onClick: async () => {
            const text = await navigator.clipboard.readText().catch(() => '')
            if (!text) return
            const first = terminals[0]
            if (first) window.terminalAPI.write(first.id, text)
          },
        },
        { separator: true },
        {
          label: 'Clear Terminal',
          onClick: () => {
            const first = terminals[0]
            if (first) window.terminalAPI.write(first.id, '\x1b[2J\x1b[H')
          },
        },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        {
          label: habitatVisible ? 'Hide Habitat' : 'Show Habitat',
          onClick: () => setSettings({ habitatVisible: !habitatVisible }),
        },
        {
          label: terminalVisible ? 'Hide Terminal Panel' : 'Show Terminal Panel',
          onClick: () => setSettings({ terminalVisible: !terminalVisible }),
        },
        { separator: true },
        {
          label: 'Zoom In',
          shortcut: 'Ctrl++',
          onClick: () => {
            const cur = parseFloat(document.documentElement.style.zoom || '1')
            document.documentElement.style.zoom = String(Math.min(cur + 0.1, 2))
          },
        },
        {
          label: 'Zoom Out',
          shortcut: 'Ctrl+-',
          onClick: () => {
            const cur = parseFloat(document.documentElement.style.zoom || '1')
            document.documentElement.style.zoom = String(Math.max(cur - 0.1, 0.5))
          },
        },
        {
          label: 'Reset Zoom',
          shortcut: 'Ctrl+0',
          onClick: () => {
            document.documentElement.style.zoom = '1'
          },
        },
        { separator: true },
        {
          label: 'Toggle Fullscreen',
          shortcut: 'F11',
          onClick: () => window.windowAPI.maximize(),
        },
      ],
    },
    {
      id: 'settings',
      label: 'Settings',
      items: [
        {
          label: 'Open Settings…',
          onClick: onOpenSettings,
        },
      ],
    },
    {
      id: 'habitats',
      label: 'Habitats',
      items: HABITATS_ITEMS,
    },
    {
      id: 'modules',
      label: 'Modules',
      items: MODULES_ITEMS,
    },
    {
      id: 'dreamstate',
      label: 'DreamState',
      items: [
        {
          label: 'Open DreamState Panel',
          onClick: onOpenDreamState,
        },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        {
          label: 'About Terminal Habitat',
          onClick: () =>
            alert(
              'Terminal Habitat\n\nAn Electron pixel art creature terminal multiplexer.\nPowered by Pixi.js, xterm.js, and Claude.\n\n© Sands Studio'
            ),
        },
        { separator: true },
        {
          label: 'Report Issue',
          onClick: () => window.open('https://github.com/sandsstudio/terminal-habitat/issues', '_blank'),
        },
      ],
    },
  ]

  const toggle = (id: string) => setOpenMenu((cur) => (cur === id ? null : id))

  // Close on click outside
  useEffect(() => {
    if (!openMenu) return
    const handler = (e: MouseEvent) => {
      if (!menuBarRef.current?.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openMenu])

  // Refresh module list when modules menu opens
  useEffect(() => {
    if (openMenu === 'modules') {
      handleModulesMenuOpen()
    }
  }, [openMenu, handleModulesMenuOpen])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="menubar" ref={menuBarRef}>
      {MENUS.map((menu) => (
        <div className="menubar-item" key={menu.id}>
          <button
            className={`menubar-trigger${openMenu === menu.id ? ' active' : ''}`}
            onClick={() => toggle(menu.id)}
            onMouseEnter={() => {
              if (openMenu !== null && openMenu !== menu.id) setOpenMenu(menu.id)
            }}
          >
            {menu.label}
          </button>

          {openMenu === menu.id && (
            menu.id === 'modules' ? renderModulesDropdown() :
            menu.id === 'habitats' ? renderHabitatsDropdown() : (
              <div className="menubar-dropdown">
                {menu.items.map((item, idx) =>
                  item.separator ? (
                    <hr key={idx} className="menubar-sep" />
                  ) : (
                    <button
                      key={idx}
                      className="menubar-dropdown-item"
                      disabled={item.disabled}
                      onClick={() => {
                        item.onClick?.()
                        setOpenMenu(null)
                      }}
                    >
                      <span className="menubar-item-label">{item.label}</span>
                      {item.shortcut && (
                        <span className="menubar-item-shortcut">{item.shortcut}</span>
                      )}
                    </button>
                  )
                )}
              </div>
            )
          )}
        </div>
      ))}
    </div>
  )
}
