import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { persistStorage } from '@/lib/storage'
import type { LauncherId } from './launcher'

/** The folder last picked for worktrees kept in the user's folder, for each app they are opened in. */
interface WorktreeFolderState {
  chosen: Partial<Record<LauncherId, string>>
  choose: (app: LauncherId, folder: string) => void
}

export const useWorktreeFolder = create<WorktreeFolderState>()(
  persist(
    (set) => ({
      chosen: {},
      choose: (app, folder) => set((s) => ({ chosen: { ...s.chosen, [app]: folder } })),
    }),
    {
      name: 'tracket-worktree-folder',
      storage: persistStorage,
      version: 1,
      partialize: (s) => ({ chosen: s.chosen }),
    },
  ),
)

/** `.vscode` is where VS Code keeps its extensions and settings: nothing else belongs in it. */
export const isVscodeFolder = (folder: string) =>
  folder.split(/[\\/]+/).some((part) => part.toLowerCase() === '.vscode')
