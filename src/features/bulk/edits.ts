import { parseDuration } from '@/features/timer/duration'
import type { EditField, FieldChange, IssueSummary } from '@/lib/api'

/** A ticket key as Jira writes it, e.g. ABC-123 */
export const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/

/** Who to assign to; `accountId: null` is nobody */
export interface Person {
  accountId: string | null
  name: string
}

/** What the user filled in for one field. Which parts matter depends on the field's kind. */
export interface Draft {
  /** The chosen option's id, text, number, date or parent key */
  value: string
  /** Text, number and date fields: whether the user touched it. An empty touched field clears it */
  touched: boolean
  user: Person | null
  /** Option ids, account ids or labels to add and to remove */
  add: string[]
  remove: string[]
  /** Labels typed but not turned into chips yet */
  addText: string
  removeText: string
  /** Display names of the account ids in `add` and `remove` */
  names: Record<string, string>
}

export const emptyDraft: Draft = {
  value: '',
  touched: false,
  user: null,
  add: [],
  remove: [],
  addText: '',
  removeText: '',
  names: {},
}

const unique = (list: string[]) => [...new Set(list)]

/** Splits what was typed into labels: Jira labels are single words, so spaces and commas separate them. */
export function parseLabels(text: string): string[] {
  return unique(text.split(/[\s,]+/).filter(Boolean))
}

/** What to add and remove: labels typed but not turned into chips yet count too, so nothing is lost on Apply. */
export function listsOf(field: EditField, draft: Draft): { add: string[]; remove: string[] } {
  if (field.kind !== 'labels') return { add: draft.add, remove: draft.remove }
  return {
    add: unique([...draft.add, ...parseLabels(draft.addText)]),
    remove: unique([...draft.remove, ...parseLabels(draft.removeText)]),
  }
}

/** What is wrong with what was filled in, if anything. */
export function fieldProblem(field: EditField, draft: Draft, issues: IssueSummary[]): string | null {
  const value = draft.value.trim()
  switch (field.kind) {
    case 'parent':
      if (!value) return null
      if (!ISSUE_KEY.test(value)) return 'A ticket key looks like ABC-123.'
      return issues.some((i) => i.key === value) ? "A ticket can't be its own parent." : null
    case 'number':
      return value && !Number.isFinite(Number(value.replace(',', '.'))) ? 'Enter a number.' : null
    case 'timeSpent': {
      if (!value) return null
      const seconds = parseDuration(value)
      if (seconds === null) return 'Use a duration like 1h 30m or 2d.'
      return seconds < 60 ? 'Jira logs at least a minute.' : null
    }
    case 'labels': {
      const { add, remove } = listsOf(field, draft)
      const both = add.find((label) => remove.includes(label))
      return both ? `“${both}” is in both lists.` : null
    }
    default:
      return null
  }
}

/** The change a filled-in field stands for; null while there is nothing to apply (or it's wrong). */
export function toChange(field: EditField, draft: Draft, issues: IssueSummary[]): FieldChange | null {
  if (fieldProblem(field, draft, issues)) return null
  const { key } = field
  const value = draft.value.trim()

  switch (field.kind) {
    case 'choice':
      return draft.value ? { key, op: 'setChoice', id: draft.value } : null
    case 'text':
      return draft.touched ? { key, op: 'setText', text: value } : null
    case 'timeSpent': {
      const seconds = value ? parseDuration(value) : null
      return seconds ? { key, op: 'addWorklog', seconds } : null
    }
    case 'longText':
      if (!value) return null
      return field.key === 'comment' ? { key, op: 'addComment', text: value } : { key, op: 'setText', text: value }
    case 'number':
      return draft.touched ? { key, op: 'setNumber', number: value ? Number(value.replace(',', '.')) : null } : null
    case 'date':
      return draft.touched ? { key, op: 'setDate', day: draft.value || null } : null
    case 'user':
      return draft.user ? { key, op: 'setUser', accountId: draft.user.accountId } : null
    case 'parent':
      return value ? { key, op: 'setParent', issueKey: value } : null
    case 'labels':
    case 'choices':
    case 'users': {
      const { add, remove } = listsOf(field, draft)
      if (add.length === 0 && remove.length === 0) return null
      const items = field.kind === 'labels' ? 'labels' : field.kind === 'choices' ? 'choices' : 'users'
      return { key, op: 'modify', items, add, remove }
    }
  }
}
