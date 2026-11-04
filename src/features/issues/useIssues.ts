import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type ApiError, type IssueList, type IssueSummary } from '@/lib/api'

export type ListView = 'open' | 'closed'

/** Closed = anything in the Done status category (Closed, Resolved, Done…), most recently touched first. */
export function viewJql(view: ListView): string {
  const scope = view === 'open' ? 'statusCategory != Done' : 'statusCategory = Done'
  return `assignee = currentUser() AND ${scope} ORDER BY updated DESC`
}

/** One ticket per project: enough to learn what a project's tickets can show or edit. */
export function onePerProject(issues: IssueSummary[], max = 5): IssueSummary[] {
  const seen = new Map<string, IssueSummary>()
  for (const issue of issues) if (!seen.has(issue.projectKey)) seen.set(issue.projectKey, issue)
  return [...seen.values()].slice(0, max)
}

export function useIssues(jql: string) {
  return useQuery<IssueList, ApiError>({
    queryKey: ['issues', jql],
    queryFn: () => api.searchIssues(jql),
    refetchInterval: 90_000,
    placeholderData: keepPreviousData,
    retry: (count, error) => error.kind === 'network' && count < 2,
  })
}
