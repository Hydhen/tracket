import type { BoardColumn, IssueSummary } from '@/lib/api'

export type AssigneeFilter = 'unassigned' | 'anyone' | 'mine'

export interface Column {
  id: string
  name: string
  issues: IssueSummary[]
}

const CATEGORY_ORDER: Record<IssueSummary['status']['category'], number> = { new: 0, indeterminate: 1, done: 2 }

export const isMine = (issue: IssueSummary, me: string) => issue.assignee?.accountId === me

/** The tickets a filter lets through: by who has them, and by what is typed (key, title or assignee). */
export function filterIssues(issues: IssueSummary[], filter: AssigneeFilter, me: string, text: string) {
  const needle = text.trim().toLowerCase()
  return issues.filter((issue) => {
    if (filter === 'unassigned' && issue.assignee) return false
    if (filter === 'mine' && !isMine(issue, me)) return false
    if (!needle) return true
    return (
      issue.key.toLowerCase().includes(needle) ||
      issue.summary.toLowerCase().includes(needle) ||
      !!issue.assignee?.displayName.toLowerCase().includes(needle)
    )
  })
}

/** One column per status, to do first and done last, for lists that come with no board to say how to lay them out. */
function byStatus(issues: IssueSummary[]): Column[] {
  const columns = new Map<string, Column>()
  for (const issue of issues) {
    const column = columns.get(issue.status.id) ?? { id: issue.status.id, name: issue.status.name, issues: [] }
    column.issues.push(issue)
    columns.set(issue.status.id, column)
  }
  const category = (c: Column) => CATEGORY_ORDER[c.issues[0].status.category]
  // Stable: statuses of one category keep the order their tickets came in
  return [...columns.values()].sort((a, b) => category(a) - category(b))
}

/**
 * The columns to show. A board's own columns when its configuration is known: tickets in a status
 * the board doesn't map land in `leftover` (a kanban board's backlog, for one). Otherwise one column
 * per status.
 */
export function buildColumns(
  issues: IssueSummary[],
  config: BoardColumn[] | undefined,
  leftover: string,
): Column[] {
  if (!config) return byStatus(issues)

  const placed = new Set<string>()
  const columns = config
    .filter((c) => c.statusIds.length > 0)
    .map((c, i): Column => {
      const mine = issues.filter((issue) => c.statusIds.includes(issue.status.id))
      mine.forEach((issue) => placed.add(issue.key))
      return { id: `${i}:${c.name}`, name: c.name, issues: mine }
    })

  const rest = issues.filter((issue) => !placed.has(issue.key))
  if (rest.length > 0) columns.push({ id: 'leftover', name: leftover, issues: rest })
  return columns
}
