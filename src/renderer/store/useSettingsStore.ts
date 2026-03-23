import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsData {
  // General
  showTerminalHeaders: boolean
  confirmBeforeClosing: boolean

  // Appearance
  theme: 'dark' | 'light'
  accentColor: string

  // Terminal
  fontSize: number
  fontFamily: string
  scrollback: number
  cursorStyle: 'block' | 'underline' | 'bar'

  // Habitat / Layout
  terminalPanelHeight: number
  habitatVisible: boolean
  terminalVisible: boolean
  showCreatureNames: boolean
  creatureSpeed: 'slow' | 'normal' | 'fast'

  // Agent Defaults
  defaultApiKey: string
  defaultModel: string
  defaultBaseURL: string
}

interface SettingsStore extends SettingsData {
  setSettings: (patch: Partial<SettingsData>) => void
  resetSettings: () => void
}

const DEFAULTS: SettingsData = {
  showTerminalHeaders: true,
  confirmBeforeClosing: false,
  theme: 'dark',
  accentColor: '#5b90f0',
  fontSize: 14,
  fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
  scrollback: 1000,
  cursorStyle: 'block',
  terminalPanelHeight: 220,
  habitatVisible: true,
  terminalVisible: true,
  showCreatureNames: false,
  creatureSpeed: 'normal',
  defaultApiKey: '',
  defaultModel: '',
  defaultBaseURL: '',
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setSettings: (patch) => set((s) => ({ ...s, ...patch })),
      resetSettings: () => set(DEFAULTS),
    }),
    { name: 'terminal-habitat-settings' }
  )
)
