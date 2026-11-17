import type { Board, Project } from '@/lib/api'
import type { BoardSource } from './useBoard'

/** One thing the board can show: a Jira board, or a project that has none. */
export interface SourceOption {
  value: string
  source: BoardSource
  /** Name of the project it belongs to: what the list is sorted and grouped by */
  project: string
  /** What tells it apart from the others of its project */
  label: string
  /** Lowercase text the search looks in */
  search: string
}

export const sourceValue = (s: BoardSource | null) =>
  s ? (s.kind === 'board' ? `board:${s.boardId}` : `project:${s.key}`) : ''

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

/**
 * Every board, and every project without a board (reached through the board otherwise), by project
 * name first and then by board. `extraProjects` are project keys known from elsewhere (the open
 * tickets) that the projects list may have left out.
 */
export function sourceOptions(boards: Board[], projects: Project[], extraProjects: string[]): SourceOption[] {
  const names = new Map(projects.map((p) => [p.key, p.name]))
  const withBoard = new Set(boards.map((b) => b.projectKey))
  const options: SourceOption[] = []

  for (const b of boards) {
    const project = b.projectName ?? (b.projectKey ? names.get(b.projectKey) : undefined) ?? b.projectKey ?? 'No project'
    options.push({
      value: `board:${b.id}`,
      source: { kind: 'board', boardId: b.id, scope: 'auto' },
      project,
      label: b.name,
      search: `${project} ${b.projectKey ?? ''} ${b.name} ${b.kind}`.toLowerCase(),
    })
  }

  const lonely = new Map<string, string>()
  for (const p of projects) if (!withBoard.has(p.key)) lonely.set(p.key, p.name)
  for (const key of extraProjects) if (!withBoard.has(key) && !lonely.has(key)) lonely.set(key, names.get(key) ?? key)
  for (const [key, name] of lonely) {
    options.push({
      value: `project:${key}`,
      source: { kind: 'project', key },
      project: name,
      label: `All tickets · ${key}`,
      search: `${name} ${key}`.toLowerCase(),
    })
  }

  return options.sort((a, b) => byName(a.project, b.project) || byName(a.label, b.label))
}

/** The options matching every word typed. */
export function matching(options: SourceOption[], query: string): SourceOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return words.length === 0 ? options : options.filter((o) => words.every((w) => o.search.includes(w)))
}
