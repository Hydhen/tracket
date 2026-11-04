import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const FIELD_KEY = /^[A-Za-z0-9_]+$/

/**
 * Fields a transition turned out to insist on although Jira's screen for it says they are optional
 * (a workflow validator): once a move went through with them filled in, they are asked for upfront.
 */
interface LearnedFieldsState {
  /** `PROJECT:transition id` → field keys */
  fields: Record<string, string[]>
  learn: (transition: string, keys: string[]) => void
  forget: (transition: string) => void
}

/** The workflow's transitions are numbered per workflow, so the project says which one is meant. */
export const transitionId = (project: string, transition: string) => `${project}:${transition}`

export const useLearnedFields = create<LearnedFieldsState>()(
  persist(
    (set) => ({
      fields: {},
      learn: (transition, keys) =>
        set((s) => ({ fields: { ...s.fields, [transition]: [...new Set([...(s.fields[transition] ?? []), ...keys])] } })),
      forget: (transition) =>
        set((s) => {
          const { [transition]: _gone, ...rest } = s.fields
          return { fields: rest }
        }),
    }),
    {
      name: 'tracket-learned-fields',
      version: 1,
      partialize: (s) => ({ fields: s.fields }),
      // Keep only well-formed entries, in case the stored data was edited by hand
      merge: (persisted, current) => {
        const stored = (persisted as { fields?: Record<string, unknown> } | undefined)?.fields ?? {}
        const fields: Record<string, string[]> = {}
        for (const [id, keys] of Object.entries(stored)) {
          if (Array.isArray(keys)) fields[id] = keys.filter((k): k is string => typeof k === 'string' && FIELD_KEY.test(k))
        }
        return { ...current, fields }
      },
    },
  ),
)
