import type { QueryClient } from '@tanstack/react-query'
import { useProjects } from '@/features/workspace/repos'
import { fieldsUsed, pickProject, PROJECT_FIELD } from '@/features/workspace/routing'
import { api, ApiError, type IssueSummary } from '@/lib/api'

/** The metadata that say which project a ticket belongs to: the same cache entry as the ticket view's. */
export const routingValuesQuery = (issue: IssueSummary, fields: string[]) => ({
  queryKey: ['routing-values', issue.key, issue.updated, fields.join(',')],
  queryFn: () => api.getFieldValues(issue.key, fields),
  staleTime: 60_000,
})

/**
 * The ticket's worktree, made as Start working makes it, for Sprocket's agents to work in. A plain function, so a
 * drop on several tickets can make each one's. Throws when no project fits the ticket or something is in the way.
 */
export async function ticketWorktree(queryClient: QueryClient, issue: IssueSummary): Promise<string> {
  const projects = useProjects.getState().projects
  const fields = fieldsUsed(projects)
  const values = fields.length > 0 ? await queryClient.fetchQuery(routingValuesQuery(issue, fields)) : {}
  const project = pickProject(projects, { ...values, [PROJECT_FIELD]: [issue.projectKey] })
  if (!project) {
    throw new ApiError('unexpected', 'No project in Settings › Quick start has the metadata of this ticket.')
  }
  const outcome = await api.createWorktree(project.path, issue.key)
  if (outcome.status === 'conflict') {
    throw new ApiError('unexpected', "Something is in the way of the ticket's worktree: use Start working once to sort it out.")
  }
  return outcome.worktree.folder
}
