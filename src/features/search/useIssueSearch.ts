import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type ApiError, type IssueList, type IssueSummary } from '@/lib/api'
import { useDebounced } from '@/lib/useDebounced'
import { buildSearchJql, buildSuggestionJql, type IssueType } from './searchJql'

const RESULT_LIMIT = 20
const DEBOUNCE_MS = 250

/**
 * Searches the whole Jira site (not just my tickets) as the user types, optionally narrowed to
 * one issue type. With a type picked and nothing typed, it lists my open tickets of that type.
 */
export function useIssueSearch(input: string, keyPrefix?: string, issueType?: IssueType | null) {
  const debounced = useDebounced(input, DEBOUNCE_MS)
  const toJql = (text: string) =>
    text.trim() === '' ? (issueType ? buildSuggestionJql(issueType) : null) : buildSearchJql(text, keyPrefix, issueType)
  const jql = toJql(debounced)

  const query = useQuery<IssueList, ApiError>({
    queryKey: ['search', jql],
    queryFn: () => api.searchIssues(jql!, RESULT_LIMIT),
    enabled: jql !== null,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })

  const typed = input.trim().toUpperCase()
  const exact = (i: IssueSummary) => i.key === typed || (keyPrefix && i.key === `${keyPrefix}-${typed}`)
  // An exact key match goes first, the rest keeps Jira's order (most recently updated)
  const results = [...(query.data?.issues ?? [])].sort((a, b) => Number(!!exact(b)) - Number(!!exact(a)))

  return {
    /** False when there is nothing to search for (empty with no type, or only symbols). */
    searchable: toJql(input) !== null,
    results,
    error: query.error,
    // Waiting out the debounce also counts as loading
    isLoading: input.trim() !== debounced.trim() || (jql !== null && query.isFetching),
  }
}
