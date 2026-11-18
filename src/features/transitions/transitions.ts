import { fitDraft, toChange, type Draft } from '@/features/bulk/edits'
import type { DefaultField } from '@/features/bulk/defaultFields'
import { api, type EditField, type FieldChange, type IssueSummary, type Transition } from '@/lib/api'

type Status = IssueSummary['status']

/** What an issue can move to from where it is now. Short-lived: the answer changes with its status. */
export const transitionsQuery = (key: string) => ({
  queryKey: ['transitions', key],
  queryFn: () => api.getTransitions(key),
  staleTime: 15_000,
})

/** What moving tickets to a status needs, and what else its screen in Jira offers. */
export interface MoveInput {
  /** Fields to fill in before moving, the same for every ticket */
  fields: EditField[]
  /** The other fields of the screen, which can be added: the workflow may insist on them silently */
  optional: EditField[]
  /** Required fields that can't be filled in here: the move has to be made in Jira */
  unsupported: string[]
  /** When Jira refused the move: what it said */
  reason?: string
}

/** Every field a transition's screen has, wherever it is listed. */
export const screenKeys = (transition: Transition) =>
  [...transition.required, ...transition.optional].map((f) => f.key)

const picksFromList = (field: EditField) => field.kind === 'choice' || field.kind === 'choices'

/** Keeps the options both fields accept. */
function narrowed(known: EditField | undefined, field: EditField): EditField {
  if (!known) return field
  return { ...known, choices: known.choices.filter((c) => field.choices.some((o) => o.id === c.id)) }
}

/**
 * What moving the tickets to `target` needs (one list of transitions per ticket): the required
 * fields, plus the ones `learned` says this transition insisted on before. The rest of the screen is
 * offered as optional. A field that picks from a list is limited to the options every ticket accepts.
 */
export function moveInput(
  issues: IssueSummary[],
  transitions: Transition[][],
  target: Status,
  learned: (issue: IssueSummary, transition: Transition) => string[],
): MoveInput {
  const asked = new Map<string, EditField>()
  const optional = new Map<string, EditField>()
  const unsupported = new Set<string>()

  transitions.forEach((list, i) => {
    const transition = list.find((t) => t.to.id === target.id)
    if (!transition) return
    const insisted = learned(issues[i], transition)
    transition.unsupported.forEach((name) => unsupported.add(name))
    transition.required.forEach((f) => asked.set(f.key, narrowed(asked.get(f.key), f)))
    for (const f of transition.optional) {
      const into = insisted.includes(f.key) ? asked : optional
      into.set(f.key, narrowed(into.get(f.key), f))
    }
  })

  for (const key of asked.keys()) optional.delete(key)
  // A list the tickets have no option in common in can't be filled in for all of them at once
  for (const [key, field] of asked) {
    if (picksFromList(field) && field.choices.length === 0) {
      asked.delete(key)
      unsupported.add(field.name)
    }
  }
  for (const [key, field] of optional) if (picksFromList(field) && field.choices.length === 0) optional.delete(key)

  return { fields: [...asked.values()], optional: [...optional.values()], unsupported: [...unsupported] }
}

/** Fields the tickets don't hold as a value of their own: a comment to write, work to log */
const NOT_ON_TICKET = ['comment', 'worklog']

/** The required fields whose current value on the tickets tells whether they are already filled in. */
export const filledCheckKeys = (input: MoveInput) =>
  input.fields.filter((f) => !NOT_ON_TICKET.includes(f.key)).map((f) => f.key)

/**
 * Jira's screen marks a field as required whether or not the ticket already has it (a component, a category…), and
 * the move goes through with the value that is there. So a required field every ticket already holds isn't asked for:
 * it moves to the optional ones (still there to change), and `filled` says which. `values` is what each ticket
 * holds now, in the order of the tickets; a ticket whose values are unknown counts as empty.
 */
export function withoutFilled(
  input: MoveInput,
  values: (Record<string, string[]> | undefined)[],
): { input: MoveInput; filled: string[] } {
  const holds = (key: string) => values.every((v) => (v?.[key]?.length ?? 0) > 0)
  const checkable = filledCheckKeys(input)
  const filled = input.fields.filter((f) => checkable.includes(f.key) && holds(f.key))
  if (filled.length === 0) return { input, filled: [] }
  return {
    input: {
      ...input,
      fields: input.fields.filter((f) => !filled.includes(f)),
      optional: [...input.optional, ...filled],
    },
    filled: filled.map((f) => f.key),
  }
}

/** Whether the move has to wait for the user to fill something in. */
export const needsInput = (input: MoveInput) => input.fields.length > 0 || input.unsupported.length > 0

/** A field is filled in when there is a real value for it, not just a clearing. */
export function filledChange(field: EditField, draft: Draft, issues: IssueSummary[]): FieldChange | null {
  const change = toChange(field, draft, issues)
  if (!change) return null
  const needsText = ['text', 'number', 'date', 'longText', 'timeSpent'].includes(field.kind)
  if (needsText && !draft.value.trim()) return null
  if (field.kind === 'user' && !draft.user?.accountId) return null
  return change
}

/** What the defaults of a move fill in on its screen. */
export interface MoveSeed {
  /** The values, as the move's dialog holds them */
  drafts: Record<string, Draft>
  /** The optional fields of the screen that have a value, which the dialog shows as added */
  added: string[]
  /** What the values come to, ready to be applied */
  changes: FieldChange[]
  /** Nothing is left to ask: every required field has its value and Jira needs no more than Tracket can give */
  complete: boolean
}

/**
 * The defaults that fit the move's screen: a field that isn't on it, or whose value its options no longer include, is
 * skipped. Choices are those every ticket accepts, as `moveInput` narrowed them.
 */
export function seedFromDefaults(screen: MoveInput, defaults: DefaultField[], issues: IssueSummary[]): MoveSeed {
  const drafts: Record<string, Draft> = {}
  const added: string[] = []
  const changes: FieldChange[] = []

  for (const { key, value } of defaults) {
    if (!value) continue
    const asked = screen.fields.find((f) => f.key === key)
    const field = asked ?? screen.optional.find((f) => f.key === key)
    const draft = field && fitDraft(field, value)
    const change = field && draft && filledChange(field, draft, issues)
    if (!field || !draft || !change) continue
    drafts[key] = draft
    changes.push(change)
    if (!asked) added.push(key)
  }

  const complete = screen.unsupported.length === 0 && screen.fields.every((f) => changes.some((c) => c.key === f.key))
  return { drafts, added, changes, complete }
}

// Jira's validators speak English whatever the language of the site ("Time Spent" is required)
const TIME_SPENT = /time\s*spent|temps\s+(pass|consacr)/i
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The fields a refusal from Jira talks about: named in its message, as a whole word. */
export function namedIn(message: string, fields: EditField[]): EditField[] {
  return fields.filter(
    (f) =>
      (f.kind === 'timeSpent' && TIME_SPENT.test(message)) ||
      [f.name, f.key].some(
        (name) => name && new RegExp(`(?<![\\p{L}\\p{N}_])${escape(name)}(?![\\p{L}\\p{N}_])`, 'iu').test(message),
      ),
  )
}
