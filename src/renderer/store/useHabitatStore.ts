import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Habitat } from '../../shared/habitatTypes'

interface HabitatStore {
  habitats: Habitat[]
  activeHabitatId: string | null
  addHabitat: (h: Habitat) => void
  updateHabitat: (id: string, patch: Partial<Habitat>) => void
  removeHabitat: (id: string) => void
  getHabitat: (id: string) => Habitat | undefined
  listHabitats: () => Habitat[]
  setActiveHabitatId: (id: string | null) => void
}

export const useHabitatStore = create<HabitatStore>()(
  persist(
    (set, get) => ({
      habitats: [],
      activeHabitatId: null,

      addHabitat: (h) =>
        set((s) => ({ habitats: [...s.habitats, h] })),

      updateHabitat: (id, patch) =>
        set((s) => ({
          habitats: s.habitats.map((h) =>
            h.id === id ? { ...h, ...patch, updatedAt: Date.now() } : h
          ),
        })),

      removeHabitat: (id) =>
        set((s) => ({ habitats: s.habitats.filter((h) => h.id !== id) })),

      getHabitat: (id) => get().habitats.find((h) => h.id === id),

      listHabitats: () => get().habitats,

      setActiveHabitatId: (id) => set({ activeHabitatId: id }),
    }),
    { name: 'terminal-habitat-habitats' }
  )
)
