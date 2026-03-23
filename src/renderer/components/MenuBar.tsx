import { useEffect, useRef, useState, useCallback } from 'react'
import { useTerminalStore } from '../store/useTerminalStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useModuleStore } from '../stores/useModuleStore'
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
}

export default function MenuBar({ onOpenSettings, onCreateModule }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [moduleList, setModuleList] = useState<string[]>([])
  const menuBarRef = useRef<HTMLDivElement>(null)
  const addTerminal = useTerminalStore((s) => s.addTerminal)
  const terminals = useTerminalStore((s) => s.terminals)
  const { habitatVisible, terminalVisible, setSettings } = useSettingsStore()
  const moduleStatus = useModuleStore((s) => s.status)

  // Safe accessor — guards against moduleAPI not being ready yet
  const api = () => {
    if (!window.moduleAPI) throw new Error('Module API not ready')
    return window.moduleAPI
  }

  // Refresh module list when modules menu opens
  const handleModulesMenuOpen = useCallback(async () => {
    try {
      const list = await api().listModules()
      setModuleList(list)
    } catch {
      setModuleList([])
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

  const handleCreateModule = useCallback(() => {
    onCreateModule()
  }, [onCreateModule])

  const handleStopModule = useCallback(() => {
    api().stopModule()
    useModuleStore.getState().reset()
  }, [])

  const MODULES_ITEMS: MenuAction[] = moduleStatus !== 'idle' && moduleStatus !== 'stopped' ? [
    { label: `▶ ${moduleStatus === 'running' ? 'Running...' : moduleStatus === 'paused' ? 'Paused' : 'Loading...'}`, disabled: true },
    { separator: true },
    { label: 'Stop Module', onClick: handleStopModule },
  ] : moduleList.length === 0 ? [
    { label: 'No Modules', disabled: true },
    { separator: true },
    { label: 'Create Module…', onClick: handleCreateModule },
  ] : [
    ...moduleList.map((id) => ({
      label: id,
      onClick: () => handleLaunchModule(id),
    })),
    { separator: true },
    { label: 'Create Module…', onClick: handleCreateModule },
  ]

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
      id: 'modules',
      label: 'Modules',
      items: MODULES_ITEMS,
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
          )}
        </div>
      ))}
    </div>
  )
}
