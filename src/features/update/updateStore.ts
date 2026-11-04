import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { persistStorage } from '@/lib/storage'

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  | { kind: 'available'; update: Update }
  /** `percent` is null until the size of the download is known */
  | { kind: 'installing'; percent: number | null }
  | { kind: 'error'; message: string }

interface UpdateState {
  /** Whether to look for a new version each time the app starts */
  auto: boolean
  setAuto: (auto: boolean) => void
  status: UpdateStatus
  /** Version whose notice was closed: only a newer one brings it back */
  dismissed: string | null
  dismiss: () => void
  /** `manual` checks report what they found, even nothing or a failure; automatic ones stay quiet */
  check: (manual: boolean) => Promise<void>
  install: () => Promise<void>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const useUpdates = create<UpdateState>()(
  persist(
    (set, get) => ({
      auto: true,
      setAuto: (auto) => set({ auto }),
      status: { kind: 'idle' },
      dismissed: null,
      dismiss: () => {
        const { status } = get()
        if (status.kind === 'available') set({ dismissed: status.update.version })
      },

      check: async (manual) => {
        const { kind } = get().status
        if (kind === 'checking' || kind === 'installing') return
        if (manual) set({ status: { kind: 'checking' } })
        try {
          const update = await check()
          set({ status: update ? { kind: 'available', update } : { kind: manual ? 'upToDate' : 'idle' } })
        } catch (error) {
          set({ status: manual ? { kind: 'error', message: messageOf(error) } : { kind: 'idle' } })
        }
      },

      install: async () => {
        const { status } = get()
        if (status.kind !== 'available') return
        let total = 0
        let received = 0
        set({ status: { kind: 'installing', percent: null } })
        try {
          // The download is checked against the public key in the app's configuration before it runs
          await status.update.downloadAndInstall((event) => {
            if (event.event === 'Started') total = event.data.contentLength ?? 0
            if (event.event === 'Progress') {
              received += event.data.chunkLength
              set({ status: { kind: 'installing', percent: total ? Math.min(100, Math.round((received / total) * 100)) : null } })
            }
          })
          await relaunch()
        } catch (error) {
          set({ status: { kind: 'error', message: messageOf(error) } })
        }
      },
    }),
    {
      name: 'tracket-updates',
      storage: persistStorage,
      version: 1,
      partialize: (s) => ({ auto: s.auto }),
      merge: (persisted, current) => ({
        ...current,
        auto: (persisted as { auto?: unknown } | undefined)?.auto !== false,
      }),
    },
  ),
)
