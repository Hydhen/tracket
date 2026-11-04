import { api, type EditField, type IssueSummary } from '@/lib/api'

type Status = IssueSummary['status']

/** What a ticket lets the current user edit. Short-lived: it depends on the ticket's project and type. */
export const editMetaQuery = (key: string) => ({
  queryKey: ['edit-meta', key],
  queryFn: () => api.getEditMeta(key),
  staleTime: 60_000,
})

// The fields people change most come first, the rest follow alphabetically
const COMMON = ['priority', 'assignee', 'labels', 'components', 'fixVersions', 'duedate', 'parent']
const rank = (key: string) => {
  const at = COMMON.indexOf(key)
  return at < 0 ? COMMON.length : at
}
const byImportance = (a: { key: string; name: string }, b: { key: string; name: string }) =>
  rank(a.key) - rank(b.key) || a.name.localeCompare(b.name)

/** Every field any of the tickets lets you edit (what the settings can offer as defaults), without options. */
export function knownFields(metas: EditField[][]): EditField[] {
  const known = new Map<string, EditField>()
  for (const field of metas.flat()) if (!known.has(field.key)) known.set(field.key, field)
  return [...known.values()].sort(byImportance)
}

/**
 * The fields that can be edited on every one of the tickets: same field, same kind, and for the
 * ones that pick from a list only the options all tickets accept (a field with none left is dropped).
 */
export function sharedFields(metas: EditField[][]): EditField[] {
  const [first, ...rest] = metas
  if (!first) return []

  const shared: EditField[] = []
  for (const field of first) {
    const others = rest.map((fields) => fields.find((f) => f.key === field.key && f.kind === field.kind))
    if (others.some((other) => !other)) continue

    const choices = field.choices.filter((choice) =>
      others.every((other) => other?.choices.some((c) => c.id === choice.id)),
    )
    const picksFromList = field.kind === 'choice' || field.kind === 'choices'
    if (picksFromList && choices.length === 0) continue

    // Long lists (hundreds of components) are easier to scan in alphabetical order; a priority's order means something
    shared.push({
      ...field,
      choices: field.kind === 'choices' ? [...choices].sort((a, b) => a.name.localeCompare(b.name)) : choices,
    })
  }
  return shared.sort(byImportance)
}

/** "Priority · Assignee · Labels +12 more", for a short hint of what can be edited. */
export function describeFields(fields: EditField[], shown = 4): string {
  const names = fields.slice(0, shown).map((f) => f.name)
  const more = fields.length - names.length
  return names.join(' · ') + (more > 0 ? ` +${more} more` : '')
}

/** The statuses the tickets are in, with how many tickets are in each (in order of first appearance). */
export function statusGroups(issues: IssueSummary[]): { status: Status; count: number }[] {
  const groups = new Map<string, { status: Status; count: number }>()
  for (const { status } of issues) {
    const group = groups.get(status.id)
    if (group) group.count++
    else groups.set(status.id, { status, count: 1 })
  }
  return [...groups.values()]
}

/** The value every ticket has for something, `'mixed'` when they differ. */
export function commonValue<T>(issues: IssueSummary[], pick: (issue: IssueSummary) => T): T | 'mixed' | undefined {
  if (issues.length === 0) return undefined
  const first = pick(issues[0])
  return issues.every((i) => pick(i) === first) ? first : 'mixed'
}
