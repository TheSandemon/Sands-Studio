/**
 * useSimulatorStore — Zustand store for HabitatSimulator state.
 *
 * Tracks: active interrupts (human-in-the-loop dialogs), checkpoint timeline,
 * and simulation enable/disable state.
 *
 * Lives in the renderer alongside HabitatSimulator.
 */
import { create } from 'zustand'
import type { Interrupt, Checkpoint } from '../../shared/simulation/types'
import type { HabitatSimState } from '../../shared/simulation/habitat/HabitatSimulator'

interface SimulatorStore {
  // Simulation enabled (can be toggled off for pure manual mode)
  enabled: boolean

  // Active interrupt awaiting user choice
  activeInterrupt: Interrupt | null

  // Checkpoint timeline (kept in sync from HabitatSimulator callbacks)
  timeline: Checkpoint<HabitatSimState>[]

  // Current simulation tick
  currentTick: number

  // Simulation paused (global freeze)
  paused: boolean

  // Actions
  setEnabled: (v: boolean) => void
  pushInterrupt: (intr: Interrupt) => void
  clearInterrupt: () => void
  pushCheckpoint: (cp: Checkpoint<HabitatSimState>) => void
  setTick: (tick: number) => void
  setPaused: (v: boolean) => void
}

export const useSimulatorStore = create<SimulatorStore>((set) => ({
  enabled: true,
  activeInterrupt: null,
  timeline: [],
  currentTick: 0,
  paused: false,

  setEnabled: (v) => set({ enabled: v }),

  pushInterrupt: (intr) => set({ activeInterrupt: intr }),

  clearInterrupt: () => set({ activeInterrupt: null }),

  pushCheckpoint: (cp) =>
    set((s) => ({
      timeline: [...s.timeline.slice(-49), cp], // keep last 50
    })),

  setTick: (tick) => set({ currentTick: tick }),

  setPaused: (paused) => set({ paused }),
}))
