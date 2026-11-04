/** A ticket has to have this value in this field to belong to a project. */
export interface Condition {
  /** Jira field key (`components`, `customfield_10001`…), or {@link PROJECT_FIELD} */
  field: string
  /** The field as named when the project was set up, so it can be shown without asking Jira */
  name: string
  value: string
}

/**
 * A project to work on: the tickets that have all of its 1 or 2 metadata belong to it, and it
 * lives in the folder at `path`.
 */
export interface WorkProject {
  id: string
  name: string
  when: Condition[]
  /** The project's root folder: a repository, or a folder inside one (a monorepo's package) */
  path: string
}

/** Two metadata are enough to tell a project's tickets apart. */
export const MAX_CONDITIONS = 2

/**
 * Not a field to read off the ticket: the key of the Jira project it is in, which the ticket
 * already says. Offered next to the site's own fields, since a whole Jira project is often one project.
 */
export const PROJECT_FIELD = 'project'

/** Values of fields on a ticket, as `get_field_values` reads them. */
export type FieldValues = Record<string, string[]>

const norm = (text: string) => text.trim().toLowerCase()

/**
 * The ticket has the value in the field. Cascading selects read "EU › France": naming a higher
 * level ("EU") matches too.
 */
export function holds(condition: Condition, values: FieldValues): boolean {
  const wanted = norm(condition.value)
  return (values[condition.field] ?? []).some((v) => {
    const have = norm(v)
    return have === wanted || have.startsWith(`${wanted} › `)
  })
}

/** The fields to ask Jira for to tell which projects a ticket belongs to. */
export function fieldsUsed(projects: WorkProject[]): string[] {
  return [...new Set(projects.flatMap((p) => p.when.map((c) => c.field)))].filter((f) => f !== PROJECT_FIELD)
}

/**
 * The project a ticket belongs to: among those whose metadata it all has, the one with the most
 * (it is the most precise), and the first set up when that is a tie.
 */
export function pickProject(projects: WorkProject[], values: FieldValues): WorkProject | undefined {
  let best: WorkProject | undefined
  for (const project of projects) {
    if (project.when.length === 0 || !project.when.every((c) => holds(c, values))) continue
    if (!best || project.when.length > best.when.length) best = project
  }
  return best
}

export const describeWhen = (when: Condition[]) => when.map((c) => `${c.name} = ${c.value}`).join(' and ')

/** The same metadata, whatever their order or capitalisation. */
export function sameWhen(a: Condition[], b: Condition[]): boolean {
  const id = (c: Condition) => `${c.field}=${norm(c.value)}`
  const left = a.map(id).sort()
  const right = b.map(id).sort()
  return left.length === right.length && left.every((x, i) => x === right[i])
}
