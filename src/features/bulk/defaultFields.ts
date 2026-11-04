import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { persistStorage } from '@/lib/storage'

/** A field the bulk edit dialog starts with; the name is kept so it can be listed before Jira is asked. */
export interface DefaultField {
  /** `priority`, `customfield_10000`… */
  key: string
  name: string
}

const FIELD_KEY = /^[A-Za-z0-9_]+$/

interface BulkDefaultsState {
  /** In the order the dialog shows them */
  fields: DefaultField[]
  add: (field: DefaultField) => void
  remove: (key: string) => void
  /** Moves the field up (-1) or down (+1) */
  move: (key: string, step: -1 | 1) => void
  set: (fields: DefaultField[]) => void
}

export const useBulkDefaults = create<BulkDefaultsState>()(
  persist(
    (set) => ({
      fields: [],
      add: (field) => set((s) => (s.fields.some((f) => f.key === field.key) ? s : { fields: [...s.fields, field] })),
      remove: (key) => set((s) => ({ fields: s.fields.filter((f) => f.key !== key) })),
      move: (key, step) =>
        set((s) => {
          const from = s.fields.findIndex((f) => f.key === key)
          const to = from + step
          if (from < 0 || to < 0 || to >= s.fields.length) return s
          const fields = [...s.fields]
          const [field] = fields.splice(from, 1)
          fields.splice(to, 0, field)
          return { fields }
        }),
      set: (fields) => set({ fields }),
    }),
    {
      name: 'tracket-bulk-fields',
      storage: persistStorage,
      version: 1,
      partialize: (s) => ({ fields: s.fields }),
      // Keep only well-formed, distinct entries, in case the stored data was edited by hand
      merge: (persisted, current) => {
        const stored = (persisted as { fields?: unknown } | undefined)?.fields
        const fields: DefaultField[] = []
        if (Array.isArray(stored)) {
          for (const entry of stored) {
            const { key, name } = (entry ?? {}) as Partial<DefaultField>
            if (typeof key === 'string' && FIELD_KEY.test(key) && typeof name === 'string' && !fields.some((f) => f.key === key)) {
              fields.push({ key, name: name || key })
            }
          }
        }
        return { ...current, fields }
      },
    },
  ),
)
