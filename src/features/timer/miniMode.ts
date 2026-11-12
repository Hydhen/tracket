import { create } from 'zustand'
import { api } from '@/lib/api'

interface MiniModeState {
  /** The window is a small pill on top of the other windows, showing only the timer */
  mini: boolean
  setMini: (on: boolean) => Promise<void>
}

/**
 * Not saved: the app always starts as a normal window. The app stays mounted (hidden) while mini, so
 * what the person was doing is still there when it comes back.
 */
export const useMiniMode = create<MiniModeState>((set) => ({
  mini: false,
  setMini: async (on) => {
    // Going mini, the pill is up before the window is small; coming back, the window is big first
    if (on) set({ mini: true })
    try {
      await api.setMini(on)
      if (!on) set({ mini: false })
    } catch (error) {
      console.error('Could not change the window', error)
      set({ mini: !on })
    }
  },
}))
