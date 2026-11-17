import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { persistStorage } from '@/lib/storage'
import { emptyDraft, isEmptyDraft, type Draft } from './edits'

/** A field the bulk edit dialog starts with; the name is kept so it can be listed before Jira is asked. */
export interface DefaultField {
  /** `priority`, `customfield_10000`… */
  key: string
  name: string
  /** What the field is filled in with when the dialog opens, as the dialog holds it; none leaves it empty */
  value?: Draft
}

const FIELD_KEY = /^[A-Za-z0-9_]+$/

const strings = (list: unknown): string[] =>
  Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
const text = (v: unknown) => (typeof v === 'string' ? v : '')

/** A stored default value, or nothing when it is damaged or holds nothing: the data may have been edited by hand. */
function readValue(stored: unknown): Draft | undefined {
  if (!stored || typeof stored !== 'object') return undefined
  const raw = stored as Record<string, unknown>
  const user = raw.user as { accountId?: unknown; name?: unknown } | null | undefined
  const names = Object.entries((raw.names ?? {}) as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
  const draft: Draft = {
    ...emptyDraft,
    value: text(raw.value),
    touched: raw.touched === true,
    user:
      user && typeof user === 'object' && (typeof user.accountId === 'string' || user.accountId === null)
        ? { accountId: user.accountId, name: text(user.name) }
        : null,
    add: strings(raw.add),
    remove: strings(raw.remove),
    addText: text(raw.addText),
    removeText: text(raw.removeText),
    names: Object.fromEntries(names),
  }
  return isEmptyDraft(draft) ? undefined : draft
}

interface DefaultsState {
  /** In the order the dialog shows them */
  fields: DefaultField[]
  add: (field: DefaultField) => void
  remove: (key: string) => void
  /** Puts the field at position `to` (0-based), shifting the ones in between */
  moveTo: (key: string, to: number) => void
  /** Sets what the field is filled in with by default; nothing, or an empty draft, takes it away */
  setValue: (key: string, value: Draft | undefined) => void
  set: (fields: DefaultField[]) => void
}

/** A list of default fields kept under `name`; the bulk edit dialog and the move to "resolved" each have theirs. */
function createDefaults(name: string) {
  return create<DefaultsState>()(
    persist(
      (set) => ({
        fields: [],
        add: (field) => set((s) => (s.fields.some((f) => f.key === field.key) ? s : { fields: [...s.fields, field] })),
        remove: (key) => set((s) => ({ fields: s.fields.filter((f) => f.key !== key) })),
        moveTo: (key, to) =>
          set((s) => {
            const from = s.fields.findIndex((f) => f.key === key)
            if (from < 0 || from === to || to < 0 || to >= s.fields.length) return s
            const fields = [...s.fields]
            const [field] = fields.splice(from, 1)
            fields.splice(to, 0, field)
            return { fields }
          }),
        setValue: (key, value) =>
          set((s) => ({
            fields: s.fields.map((f) => {
              if (f.key !== key) return f
              const { key: k, name } = f
              return value && !isEmptyDraft(value) ? { key: k, name, value } : { key: k, name }
            }),
          })),
        set: (fields) => set({ fields }),
      }),
      {
        name,
        storage: persistStorage,
        version: 1,
        partialize: (s) => ({ fields: s.fields }),
        // Keep only well-formed, distinct entries, in case the stored data was edited by hand
        merge: (persisted, current) => {
          const stored = (persisted as { fields?: unknown } | undefined)?.fields
          const fields: DefaultField[] = []
          if (Array.isArray(stored)) {
            for (const entry of stored) {
              const { key, name, value } = (entry ?? {}) as Partial<Record<keyof DefaultField, unknown>>
              if (typeof key === 'string' && FIELD_KEY.test(key) && typeof name === 'string' && !fields.some((f) => f.key === key)) {
                const draft = readValue(value)
                fields.push(draft ? { key, name: name || key, value: draft } : { key, name: name || key })
              }
            }
          }
          return { ...current, fields }
        },
      },
    ),
  )
}

/** The fields the bulk edit dialog starts with */
export const useBulkDefaults = createDefaults('tracket-bulk-fields')

/** The fields filled in when a ticket is moved to a done status ("resolved"), with the values they get */
export const useResolveDefaults = createDefaults('tracket-resolve-defaults')

export type DefaultsStore = typeof useBulkDefaults
