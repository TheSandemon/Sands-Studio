import { create } from 'zustand'
import type { ShellConfig, CreatureConfig } from '../../shared/habitatTypes'

export type TerminalState = 'idle' | 'busy' | 'sleep' | 'error' | 'talking' | 'egg' | 'hatching'

export interface TerminalSession {
  id: string
  name: string
  state: TerminalState
  lastActivity: number
  agentLog: string[]
  agentRunning: boolean
  hatched: boolean
  creatureName?: string
  specialty?: string
  shellConfig?: ShellConfig
  messageCount: number
}

interface TerminalStore {
  terminals: TerminalSession[]
  addTerminal: (name?: string) => TerminalSession
  addTerminalWithConfig: (config?: ShellConfig, id?: string) => TerminalSession
  addTerminalBatch: (sessions: Array<{ id: string; name: string; shellConfig: ShellConfig; creature?: CreatureConfig }>) => void
  removeTerminal: (id: string) => void
  setState: (id: string, state: TerminalState) => void
  recordActivity: (id: string) => void
  appendAgentLog: (id: string, text: string) => void
  setAgentRunning: (id: string, running: boolean) => void
  hatchCreature: (id: string, creatureName: string, specialty: string) => void
  setShellConfig: (id: string, config: ShellConfig) => void
  clearAll: () => void
  incrementMessageCount: (sessionId: string) => void
  setMessageCount: (sessionId: string, count: number) => void
}

let counter = 0

export const useTerminalStore = create<TerminalStore>((set) => ({
  terminals: [],

  addTerminal(name) {
    counter++
    const id = `t${Date.now().toString(36)}${counter}`
    const session: TerminalSession = {
      id,
      name: name ?? `Shell ${counter}`,
      state: 'egg',
      lastActivity: Date.now(),
      agentLog: [],
      agentRunning: false,
      hatched: false,
      messageCount: 0
    }
    set((s) => ({ terminals: [...s.terminals, session] }))
    return session
  },

  addTerminalWithConfig(config, forcedId) {
    counter++
    const id = forcedId ?? `t${Date.now().toString(36)}${counter}`
    const session: TerminalSession = {
      id,
      name: config?.name ?? `Shell ${counter}`,
      state: 'egg',
      lastActivity: Date.now(),
      agentLog: [],
      agentRunning: false,
      hatched: false,
      shellConfig: config,
      messageCount: 0
    }
    set((s) => ({ terminals: [...s.terminals, session] }))
    return session
  },

  addTerminalBatch(sessions) {
    set((s) => ({
      terminals: sessions.map((r) => {
        const existing = s.terminals.find((t) => t.id === r.id)
        return {
          id: r.id,
          name: r.name,
          state: (r.creature?.hatched ? 'idle' : 'egg') as TerminalState,
          lastActivity: Date.now(),
          agentLog: [],
          agentRunning: false,
          hatched: r.creature?.hatched ?? false,
          creatureName: r.creature?.name,
          specialty: r.creature?.specialty,
          shellConfig: { ...r.shellConfig, preCreated: true },
          messageCount: existing?.messageCount ?? 0,
        }
      }),
    }))
  },

  removeTerminal(id) {
    set((s) => ({ terminals: s.terminals.filter((t) => t.id !== id) }))
  },

  setState(id, state) {
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, state } : t))
    }))
  },

  recordActivity(id) {
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === id ? { ...t, lastActivity: Date.now(), state: 'busy' } : t
      )
    }))
  },

  appendAgentLog(id, text) {
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === id ? { ...t, agentLog: [...t.agentLog, text] } : t
      )
    }))
  },

  setAgentRunning(id, running) {
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, agentRunning: running } : t))
    }))
  },

  hatchCreature(id, creatureName, specialty) {
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === id
          ? { ...t, hatched: true, creatureName, specialty, state: 'idle', agentRunning: false }
          : t
      )
    }))
  },

  setShellConfig(id, config) {
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === id ? { ...t, shellConfig: config } : t
      )
    }))
  },

  incrementMessageCount(sessionId) {
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === sessionId ? { ...t, messageCount: (t.messageCount ?? 0) + 1 } : t
      )
    }))
  },

  setMessageCount(sessionId, count) {
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === sessionId ? { ...t, messageCount: count } : t
      )
    }))
  },

  clearAll() {
    set({ terminals: [] })
  },
}))

// Idle decay — only decay hatched creatures
setInterval(() => {
  const now = Date.now()
  useTerminalStore.setState((s) => ({
    terminals: s.terminals.map((t) => {
      if (!t.hatched || t.agentRunning) return t
      const elapsed = now - t.lastActivity
      if (elapsed > 5 * 60_000 && t.state !== 'sleep') return { ...t, state: 'sleep' }
      if (elapsed > 30_000 && t.state === 'busy') return { ...t, state: 'idle' }
      return t
    })
  }))
}, 5_000)
