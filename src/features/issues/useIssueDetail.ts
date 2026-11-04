import { useQuery } from '@tanstack/react-query'
import { api, type ApiError, type IssueDetail } from '@/lib/api'

/** `updated` is part of the key so the content reloads when the issue changes in Jira. */
export function useIssueDetail(key: string, updated: string) {
  return useQuery<IssueDetail, ApiError>({
    queryKey: ['issue', key, updated],
    queryFn: () => api.getIssue(key),
    staleTime: 5 * 60_000,
  })
}
