import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { persistStorage } from '@/lib/storage'
import herdrLogo from '@/assets/launchers/herdr.svg'
import vscodeLogo from '@/assets/launchers/vscode.svg'

/** The apps "Start working" can open the worktree in. */
export const LAUNCHERS = [
  {
    id: 'vscode',
    name: 'VS Code',
    logo: vscodeLogo,
    detail: 'Opens the worktree. The prompt for Claude Code is copied to the clipboard, to paste there.',
  },
  {
    id: 'herdr',
    name: 'herdr',
    logo: herdrLogo,
    detail:
      'Opens a space in the worktree that runs Claude Code, with the prompt as its first message. If a space is already open there, it is shown, and Claude Code is started in a first tab when it isn\'t running in it yet. The herdr window has to be open.',
  },
] as const

export type LauncherId = (typeof LAUNCHERS)[number]['id']

export const launcherName = (id: LauncherId) => LAUNCHERS.find((l) => l.id === id)?.name ?? id

/** The app's logo, as an image URL. */
export const launcherLogo = (id: LauncherId) => LAUNCHERS.find((l) => l.id === id)?.logo


interface LauncherState {
  app: LauncherId
  setApp: (app: LauncherId) => void
}

export const useLauncher = create<LauncherState>()(
  persist(
    (set) => ({
      app: 'vscode',
      setApp: (app) => set({ app }),
    }),
    {
      name: 'tracket-launcher',
      storage: persistStorage,
      version: 1,
      partialize: (s) => ({ app: s.app }),
      // An app that isn't offered (stored data edited by hand, or removed later) falls back to the default
      merge: (persisted, current) => {
        const app = (persisted as { app?: string } | undefined)?.app
        return { ...current, app: LAUNCHERS.some((l) => l.id === app) ? (app as LauncherId) : current.app }
      },
    },
  ),
)
