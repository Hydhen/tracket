import { useQueries } from '@tanstack/react-query'
import { onePerProject, useIssues, viewJql } from '@/features/issues/useIssues'
import { api, type FieldRef } from '@/lib/api'

/**
 * Every field the user's Jira lets a ticket show (custom fields included), read off the open
 * tickets (one per project): which fields exist depends on the site, so it is asked, not listed here.
 */
export function useJiraFields(): { fields: FieldRef[]; loading: boolean; noTickets: boolean } {
  const issues = useIssues(viewJql('open'))
  const sample = onePerProject(issues.data?.issues ?? [])
  const queries = useQueries({
    queries: sample.map((i) => ({
      queryKey: ['ticket-fields', i.key],
      queryFn: () => api.getTicketFields(i.key),
      staleTime: 5 * 60_000,
    })),
  })

  const known = new Map<string, FieldRef>()
  for (const field of queries.flatMap((q) => q.data ?? [])) if (!known.has(field.key)) known.set(field.key, field)

  return {
    fields: [...known.values()].sort((a, b) => a.name.localeCompare(b.name)),
    loading: issues.isPending || queries.some((q) => q.isPending),
    noTickets: !issues.isPending && sample.length === 0,
  }
}
