import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { persistStorage } from '@/lib/storage'
import type { User } from '@/lib/api'

/** The "Assign to…" view lists them all, in a few rows of cards: more would push the search below the fold */
export const MAX_FAVORITE_ASSIGNEES = 12

interface FavoriteAssigneesState {
  /** In the order the "Assign to…" view shows them */
  people: User[]
  /** Does nothing once there are `MAX_FAVORITE_ASSIGNEES`, or when the person is already there */
  add: (person: User) => void
  remove: (accountId: string) => void
}

export const useFavoriteAssignees = create<FavoriteAssigneesState>()(
  persist(
    (set) => ({
      people: [],
      add: (person) =>
        set((s) =>
          s.people.length >= MAX_FAVORITE_ASSIGNEES || s.people.some((p) => p.accountId === person.accountId)
            ? s
            : { people: [...s.people, person] },
        ),
      remove: (accountId) => set((s) => ({ people: s.people.filter((p) => p.accountId !== accountId) })),
    }),
    {
      name: 'tracket-favorite-assignees',
      storage: persistStorage,
      version: 1,
      partialize: (s) => ({ people: s.people }),
      // Keep only well-formed, distinct people, in case the stored data was edited by hand
      merge: (persisted, current) => {
        const stored = (persisted as { people?: unknown } | undefined)?.people
        const people: User[] = []
        if (Array.isArray(stored)) {
          for (const entry of stored) {
            const { accountId, displayName, avatarUrl } = (entry ?? {}) as Partial<Record<keyof User, unknown>>
            if (
              typeof accountId === 'string' &&
              accountId &&
              typeof displayName === 'string' &&
              !people.some((p) => p.accountId === accountId) &&
              people.length < MAX_FAVORITE_ASSIGNEES
            ) {
              people.push({ accountId, displayName, avatarUrl: typeof avatarUrl === 'string' ? avatarUrl : null })
            }
          }
        }
        return { ...current, people }
      },
    },
  ),
)
