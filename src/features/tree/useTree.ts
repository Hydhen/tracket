import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, type ApiError, type IssueList } from '@/lib/api'

const ROOTS_KEY = 'tracket-tree-roots'
const EXPANDED_KEY = 'tracket-tree-expanded'
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/

function load(storageKey: string): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    // Keys end up in JQL, so only well-formed ones are accepted
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string' && ISSUE_KEY.test(k)) : []
  } catch {
    return []
  }
}

function save(storageKey: string, keys: Iterable<string>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...keys]))
  } catch {
    // the tree still works for this session
  }
}

/** Root issues of the tree and which nodes are open, both remembered between launches. */
export function useTreeState() {
  const [roots, setRoots] = useState(() => load(ROOTS_KEY))
  const [expanded, setExpanded] = useState(() => new Set(load(EXPANDED_KEY)))

  useEffect(() => save(ROOTS_KEY, roots), [roots])
  useEffect(() => save(EXPANDED_KEY, expanded), [expanded])

  const addRoot = (key: string) => {
    setRoots((prev) => (prev.includes(key) ? prev : [...prev, key]))
    // Show the children right away, that's what the tree is for
    setExpanded((prev) => new Set(prev).add(key))
  }

  const removeRoot = (key: string) => setRoots((prev) => prev.filter((k) => k !== key))

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  return { roots, expanded, addRoot, removeRoot, toggle }
}

/** The root issues, fetched in one query. Result order is Jira's, callers re-order by `roots`. */
export function useRootIssues(roots: string[]) {
  return useQuery<IssueList, ApiError>({
    queryKey: ['tree-roots', roots],
    queryFn: () => api.searchIssues(`key in (${roots.map((k) => `"${k}"`).join(', ')})`),
    enabled: roots.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

/** Direct children (stories of an epic, sub-tasks of a story…) in board order. */
export const childrenQuery = (key: string) => ({
  queryKey: ['children', key],
  queryFn: () => api.searchIssues(`parent = "${key}" ORDER BY Rank ASC`),
  staleTime: 60_000,
})

/** Children of `key`, fetched when `enabled`. */
export function useChildren(key: string, enabled: boolean) {
  return useQuery<IssueList, ApiError>({
    ...childrenQuery(key),
    enabled: enabled && ISSUE_KEY.test(key),
  })
}

/**
 * Loads the level below `children` in one query and files each group under its parent's
 * `['children', key]` cache entry. Expanding a child is then instant, and children without
 * any child of their own are known up front (so the tree can hide their caret).
 *
 * Skipped when the level doesn't fit in one page: groups would be incomplete.
 */
export function useGrandchildren(key: string, children: IssueList | undefined, enabled: boolean) {
  const queryClient = useQueryClient()
  const parents = (children?.issues ?? []).filter((i) => i.canHaveChildren).map((i) => i.key)

  return useQuery<null, ApiError>({
    queryKey: ['grandchildren', key],
    queryFn: async () => {
      const level = await api.searchIssues(
        `parent in (${parents.map((k) => `"${k}"`).join(', ')}) ORDER BY Rank ASC`,
      )
      if (level.hasMore) return null
      for (const parent of parents) {
        queryClient.setQueryData<IssueList>(['children', parent], {
          issues: level.issues.filter((i) => i.parentKey === parent),
          hasMore: false,
        })
      }
      return null
    },
    enabled: enabled && !!children && !children.hasMore && parents.length > 0,
    staleTime: 60_000,
  })
}
