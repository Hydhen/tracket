import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { persistStorage } from '@/lib/storage'

interface WhatsNewState {
  /** Whether the notes are showing */
  open: boolean
  show: () => void
  hide: () => void
  /** The version whose notes were last shown on their own after an update: they aren't shown twice */
  lastSeen: string | null
  setLastSeen: (version: string) => void
}

export const useWhatsNew = create<WhatsNewState>()(
  persist(
    (set) => ({
      open: false,
      show: () => set({ open: true }),
      hide: () => set({ open: false }),
      lastSeen: null,
      setLastSeen: (lastSeen) => set({ lastSeen }),
    }),
    {
      name: 'tracket-whats-new',
      storage: persistStorage,
      version: 1,
      partialize: (s) => ({ lastSeen: s.lastSeen }),
      merge: (persisted, current) => {
        const seen = (persisted as { lastSeen?: unknown } | undefined)?.lastSeen
        return { ...current, lastSeen: typeof seen === 'string' ? seen : null }
      },
    },
  ),
)
