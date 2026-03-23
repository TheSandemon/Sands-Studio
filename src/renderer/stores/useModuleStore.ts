// =============================================================================
// Module Engine — Zustand Store for Module Lifecycle
// =============================================================================

import { create } from 'zustand'
import type {
  ModuleStatus,
  ModuleManifest,
  WorldState,
  AgentStatus,
  AgentContext,
  ModuleRendererEvent,
  SerializedWorldState,
} from '../module-engine/types'

interface ModuleStore {
  // ── Lifecycle ─────────────────────────────────────────────────────────
  status: ModuleStatus
  activeModuleId: string | null

  // ── Module info ────────────────────────────────────────────────────────
  activeManifest: ModuleManifest | null
  assetPaths: Record<string, string>

  // ── Running state ─────────────────────────────────────────────────────
  worldState: SerializedWorldState | null
  agentStatuses: Record<string, AgentStatus>

  // ── Renderer events (drained by ModuleView) ───────────────────────────
  pendingEvents: ModuleRendererEvent[]

  // ── Bootstrap state ──────────────────────────────────────────────────
  bootstrapStatus: 'idle' | 'scanning' | 'generating' | 'done' | 'error'
  bootstrapError: string | null

  // ── Actions ──────────────────────────────────────────────────────────
  setStatus: (status: ModuleStatus) => void
  loadModule: (manifest: ModuleManifest, assetPaths?: Record<string, string>) => void
  setWorldState: (state: SerializedWorldState) => void
  setAgentStatus: (roleId: string, status: AgentStatus) => void
  pushRendererEvent: (event: ModuleRendererEvent) => void
  drainRendererEvents: () => ModuleRendererEvent[]
  setBootstrapStatus: (status: ModuleStore['bootstrapStatus'], error?: string) => void
  reset: () => void
}

const INITIAL_STATE = {
  status: 'idle' as ModuleStatus,
  activeModuleId: null,
  activeManifest: null,
  assetPaths: {} as Record<string, string>,
  worldState: null,
  agentStatuses: {} as Record<string, AgentStatus>,
  pendingEvents: [] as ModuleRendererEvent[],
  bootstrapStatus: 'idle' as const,
  bootstrapError: null,
}

export const useModuleStore = create<ModuleStore>((set, get) => ({
  ...INITIAL_STATE,

  setStatus: (status) => set({ status }),

  loadModule: (manifest, assetPaths) =>
    set({
      status: 'loading',
      activeModuleId: manifest.id,
      activeManifest: manifest,
      assetPaths: assetPaths ?? {},
      worldState: null,
      agentStatuses: {},
      pendingEvents: [],
    }),

  setWorldState: (worldState) => set({ worldState }),

  setAgentStatus: (roleId, agentStatus) =>
    set((s) => ({
      agentStatuses: { ...s.agentStatuses, [roleId]: agentStatus },
    })),

  pushRendererEvent: (event) =>
    set((s) => ({
      pendingEvents: [...s.pendingEvents, event],
    })),

  drainRendererEvents: () => {
    const events = get().pendingEvents
    set({ pendingEvents: [] })
    return events
  },

  setBootstrapStatus: (bootstrapStatus, bootstrapError) =>
    set({ bootstrapStatus, bootstrapError: bootstrapError ?? null }),

  reset: () => set(INITIAL_STATE),
}))
