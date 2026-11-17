import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, type ApiError, type Board, type BoardScope, type IssueList, type IssueSummary, type Sprint } from '@/lib/api'
import { appStorage } from '@/lib/storage'
import type { AssigneeFilter } from './columns'

const PREFS_KEY = 'tracket-board'
const PROJECT_KEY = /^[A-Z][A-Z0-9_]*$/

/** Key of the query caches holding the tickets of the board shown: patched like every other list of tickets. */
export const BOARD_ISSUES = 'board-issues'

/**
 * What a board shows. `auto` is the sprint under way, or the whole board when there is none;
 * a number is a sprint.
 */
export type BoardSource =
  | { kind: 'board'; boardId: number; scope: 'auto' | 'board' | 'backlog' | number }
  /** A project with no board to its name: its open tickets, one column per status */
  | { kind: 'project'; key: string }

export interface BoardPrefs {
  source: BoardSource | null
  assignee: AssigneeFilter
  showDone: boolean
  /** Names of the columns folded away, for each board or project (by `sourceValue`) */
  collapsed: Record<string, string[]>
}

const DEFAULTS: BoardPrefs = { source: null, assignee: 'unassigned', showDone: false, collapsed: {} }

function parseCollapsed(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string[]> = {}
  for (const [source, names] of Object.entries(raw)) {
    if (Array.isArray(names)) out[source] = names.filter((n): n is string => typeof n === 'string')
  }
  return out
}

function parseSource(raw: unknown): BoardSource | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (s.kind === 'project' && typeof s.key === 'string' && PROJECT_KEY.test(s.key)) return { kind: 'project', key: s.key }
  if (s.kind === 'board' && typeof s.boardId === 'number') {
    const scope = s.scope
    if (scope === 'auto' || scope === 'board' || scope === 'backlog' || typeof scope === 'number') {
      return { kind: 'board', boardId: s.boardId, scope }
    }
  }
  return null
}

function load(): BoardPrefs {
  try {
    const raw: unknown = JSON.parse(appStorage.getItem(PREFS_KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return DEFAULTS
    const p = raw as Record<string, unknown>
    return {
      source: parseSource(p.source),
      assignee: p.assignee === 'anyone' || p.assignee === 'mine' || p.assignee === 'unassigned' ? p.assignee : DEFAULTS.assignee,
      showDone: p.showDone === true,
      collapsed: parseCollapsed(p.collapsed),
    }
  } catch {
    return DEFAULTS
  }
}

/** The board's source and filters, remembered between launches. */
export function useBoardPrefs() {
  const [prefs, setPrefs] = useState(load)
  useEffect(() => {
    try {
      appStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      // the choice still applies for this session
    }
  }, [prefs])
  return [prefs, (patch: Partial<BoardPrefs>) => setPrefs((prev) => ({ ...prev, ...patch }))] as const
}

export function useBoards() {
  return useQuery<Board[], ApiError>({ queryKey: ['boards'], queryFn: api.listBoards, staleTime: 5 * 60_000 })
}

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: api.listProjects, staleTime: 10 * 60_000 })
}

/** Where to start when nothing was chosen yet: the board of the project the person works in the most. */
export function defaultSource(boards: Board[], myIssues: IssueSummary[]): BoardSource | null {
  const counts = new Map<string, number>()
  for (const issue of myIssues) counts.set(issue.projectKey, (counts.get(issue.projectKey) ?? 0) + 1)
  const projects = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key)

  for (const key of projects) {
    // A scrum board has a sprint to work from: it comes first
    const mine = boards.filter((b) => b.projectKey === key)
    const board = mine.find((b) => b.kind === 'scrum') ?? mine[0]
    if (board) return { kind: 'board', boardId: board.id, scope: 'auto' }
  }
  if (boards[0]) return { kind: 'board', boardId: boards[0].id, scope: 'auto' }
  return projects[0] ? { kind: 'project', key: projects[0] } : null
}

function resolveScope(scope: 'auto' | 'board' | 'backlog' | number, sprints: Sprint[]): BoardScope {
  if (scope === 'backlog') return { kind: 'backlog' }
  if (scope === 'board') return { kind: 'board' }
  if (typeof scope === 'number' && sprints.some((s) => s.id === scope)) return { kind: 'sprint', id: scope }
  const active = sprints.find((s) => s.state === 'active') ?? sprints[0]
  return active ? { kind: 'sprint', id: active.id } : { kind: 'board' }
}

const projectJql = (key: string, showDone: boolean) =>
  `project = "${key}" ${showDone ? '' : 'AND statusCategory != Done '}ORDER BY updated DESC`

/** The tickets of what the board shows, with the board's columns and sprints when it is a board. */
export function useBoardData(source: BoardSource | null, showDone: boolean) {
  const boardId = source?.kind === 'board' ? source.boardId : undefined
  const isBoard = boardId !== undefined

  const sprints = useQuery({
    queryKey: ['board-sprints', boardId],
    queryFn: () => api.getBoardSprints(boardId!),
    enabled: isBoard,
    staleTime: 60_000,
  })
  const columns = useQuery({
    queryKey: ['board-columns', boardId],
    queryFn: () => api.getBoardColumns(boardId!),
    enabled: isBoard,
    staleTime: 10 * 60_000,
  })

  const scope = source?.kind === 'board' ? resolveScope(source.scope, sprints.data ?? []) : undefined
  // The sprint decides what to ask for: wait to know it (a failing sprint list just means no sprint)
  const ready = !!source && (!isBoard || !sprints.isPending)
  const scopeId = scope ? (scope.kind === 'sprint' ? `sprint-${scope.id}` : scope.kind) : undefined

  const issues = useQuery<IssueList, ApiError>({
    queryKey: [BOARD_ISSUES, source?.kind === 'board' ? `board-${source.boardId}-${scopeId}` : `project-${source?.key}`, showDone],
    queryFn: () =>
      source?.kind === 'board'
        ? api.getBoardIssues(source.boardId, scope!, showDone ? undefined : 'statusCategory != Done')
        : api.searchIssues(projectJql(source!.key, showDone)),
    enabled: ready,
    refetchInterval: 90_000,
    placeholderData: keepPreviousData,
    retry: (count, error) => error.kind === 'network' && count < 2,
  })

  return {
    issues,
    sprints: sprints.data ?? [],
    columns: columns.data,
    scope,
    /** Waiting on the first answer (no earlier board to keep showing meanwhile) */
    loading: !ready || issues.isPending,
  }
}
