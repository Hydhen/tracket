import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Metadata the app knows how to show under a ticket's title, in the order of this list by default. */
export const TICKET_FIELDS = [
  { id: 'status', label: 'Status' },
  { id: 'priority', label: 'Priority' },
  { id: 'due', label: 'Due date' },
  { id: 'assignee', label: 'Assignee' },
  { id: 'reporter', label: 'Reporter' },
  { id: 'updated', label: 'Updated' },
  { id: 'labels', label: 'Labels' },
  { id: 'project', label: 'Project' },
  { id: 'created', label: 'Created' },
] as const

export type BuiltinFieldId = (typeof TICKET_FIELDS)[number]['id']

/**
 * A field of a ticket's details: one of the built-in ones, or any field of the user's Jira
 * (custom ones included), whose id is `jira:` followed by the Jira field key.
 */
export type TicketFieldId = string

const JIRA_PREFIX = 'jira:'
const JIRA_KEY = /^[A-Za-z0-9_]+$/

export const jiraFieldId = (key: string): TicketFieldId => `${JIRA_PREFIX}${key}`
export const isJiraField = (id: TicketFieldId) => id.startsWith(JIRA_PREFIX)
/** The Jira field key of a `jira:` id */
export const jiraKeyOf = (id: TicketFieldId) => id.slice(JIRA_PREFIX.length)

export interface FieldSetting {
  id: TicketFieldId
  visible: boolean
  /** Jira fields only: their name, kept so they can be listed without asking Jira */
  name?: string
}

const BUILTIN_LABELS: Record<string, string> = Object.fromEntries(TICKET_FIELDS.map((f) => [f.id, f.label]))

export const isBuiltin = (id: TicketFieldId): id is BuiltinFieldId => id in BUILTIN_LABELS

export const fieldLabel = (field: FieldSetting) => BUILTIN_LABELS[field.id] ?? field.name ?? jiraKeyOf(field.id)

// Everything that used to be shown stays shown; fields added since are opt-in
const OPT_IN: TicketFieldId[] = ['created']
const DEFAULTS: FieldSetting[] = TICKET_FIELDS.map(({ id }) => ({ id, visible: !OPT_IN.includes(id) }))

/**
 * Makes stored settings match the current field list: unknown or duplicate entries are dropped
 * (a built-in field was removed, or the data is damaged) and built-in fields the user has never
 * seen are appended. Jira fields are kept as long as they are well-formed.
 */
function reconcile(stored: unknown): FieldSetting[] {
  const kept: FieldSetting[] = []
  if (Array.isArray(stored)) {
    for (const entry of stored) {
      const { id, visible, name } = (entry ?? {}) as Partial<FieldSetting>
      if (typeof id !== 'string' || kept.some((f) => f.id === id)) continue
      if (isBuiltin(id)) kept.push({ id, visible: visible !== false })
      else if (isJiraField(id) && JIRA_KEY.test(jiraKeyOf(id)) && typeof name === 'string') {
        kept.push({ id, visible: visible !== false, name: name || jiraKeyOf(id) })
      }
    }
  }
  return [...kept, ...DEFAULTS.filter((d) => !kept.some((f) => f.id === d.id))]
}

interface TicketFieldsState {
  /** In display order */
  fields: FieldSetting[]
  setVisible: (id: TicketFieldId, visible: boolean) => void
  /** Shows a hidden field after the last visible one */
  show: (id: TicketFieldId) => void
  /** Adds a field of the user's Jira, shown after the last visible one (shows it if it is there already) */
  addJira: (key: string, name: string) => void
  /** Puts the field at position `to` (0-based), shifting the ones in between */
  moveTo: (id: TicketFieldId, to: number) => void
  reset: () => void
}

/** Puts `field` after the last visible one in `fields`, replacing it if it was there. */
function showLast(fields: FieldSetting[], field: FieldSetting): FieldSetting[] {
  const rest = fields.filter((f) => f.id !== field.id)
  const lastVisible = rest.reduce((last, f, i) => (f.visible ? i : last), -1)
  rest.splice(lastVisible + 1, 0, field)
  return rest
}

export const useTicketFields = create<TicketFieldsState>()(
  persist(
    (set) => ({
      fields: DEFAULTS,
      setVisible: (id, visible) =>
        set((s) => ({ fields: s.fields.map((f) => (f.id === id ? { ...f, visible } : f)) })),
      show: (id) =>
        set((s) => {
          const field = s.fields.find((f) => f.id === id)
          return { fields: showLast(s.fields, { ...(field ?? { id }), visible: true }) }
        }),
      addJira: (key, name) =>
        set((s) => ({ fields: showLast(s.fields, { id: jiraFieldId(key), visible: true, name }) })),
      moveTo: (id, to) =>
        set((s) => {
          const from = s.fields.findIndex((f) => f.id === id)
          if (from < 0 || from === to || to < 0 || to >= s.fields.length) return s
          const fields = [...s.fields]
          const [field] = fields.splice(from, 1)
          fields.splice(to, 0, field)
          return { fields }
        }),
      // Back to the built-in fields: the Jira ones added since are dropped
      reset: () => set({ fields: DEFAULTS }),
    }),
    {
      name: 'tracket-ticket-fields',
      version: 1,
      partialize: (s) => ({ fields: s.fields }),
      merge: (persisted, current) => ({
        ...current,
        fields: reconcile((persisted as { fields?: unknown } | undefined)?.fields),
      }),
    },
  ),
)
