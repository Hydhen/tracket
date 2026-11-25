import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api, type ApiError, type SprocketRun, type SprocketSession, type SprocketWorkflow } from '@/lib/api'
import { persistStorage } from '@/lib/storage'

/** The connection to Sprocket, checked with it every minute (it may be closed, or opened since). */
export function useSprocketSession() {
  return useQuery<SprocketSession | null, ApiError>({
    queryKey: ['sprocket-session'],
    queryFn: api.sprocketSession,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

interface SprocketPrefs {
  /** The run, its stages and approvals, under the ticket's fields */
  section: boolean
  /** The Agents button next to Start working */
  button: boolean
  set: (prefs: Partial<Pick<SprocketPrefs, 'section' | 'button'>>) => void
}

export const useSprocketPrefs = create<SprocketPrefs>()(
  persist(
    (set) => ({
      section: true,
      button: true,
      set: (prefs) => set(prefs),
    }),
    {
      name: 'tracket-sprocket',
      storage: persistStorage,
      version: 1,
      partialize: ({ section, button }) => ({ section, button }),
    },
  ),
)

/** Signed in, and Sprocket answers: only then do the ticket's Agents parts show. */
export function useSprocketReady() {
  const session = useSprocketSession().data
  return !!session?.reachable
}

export function useSprocketWorkflows(enabled: boolean) {
  return useQuery<SprocketWorkflow[], ApiError>({
    queryKey: ['sprocket-workflows'],
    queryFn: api.sprocketWorkflows,
    enabled,
    staleTime: 60_000,
  })
}

const active = (run: SprocketRun) => run.state === 'running' || run.state === 'waiting'

/** The ticket's runs: every few seconds while one is going, rarely otherwise. */
export function useTicketRuns(key: string, enabled: boolean) {
  return useQuery<SprocketRun[], ApiError>({
    queryKey: ['sprocket-runs', key],
    queryFn: () => api.sprocketRuns(key),
    enabled,
    refetchInterval: (query) => ((query.state.data ?? []).some(active) ? 4_000 : 60_000),
  })
}
