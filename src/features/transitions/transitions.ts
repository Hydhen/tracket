import { api, type EditField, type IssueSummary, type Transition } from '@/lib/api'

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

/** Whether the move has to wait for the user to fill something in. */
export const needsInput = (input: MoveInput) => input.fields.length > 0 || input.unsupported.length > 0

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
