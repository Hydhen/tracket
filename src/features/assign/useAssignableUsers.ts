import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useDebounced } from '@/lib/useDebounced'

/**
 * The people who can be assigned issues in all of `projectKeys` and match what is being typed.
 * Nothing is asked until something is typed, and not while the typing goes on.
 */
export function useAssignableUsers(projectKeys: string[], text: string) {
  const search = useDebounced(text.trim(), 250)
  const query = useQuery({
    queryKey: ['assignable', projectKeys.join(','), search],
    queryFn: () => api.searchAssignableUsers(projectKeys, search),
    enabled: search.length > 0 && projectKeys.length > 0,
    staleTime: 60_000,
  })
  return {
    /** Something is typed */
    searching: search.length > 0,
    /** Still waiting for the people matching what is typed now */
    waiting: text.trim() !== search || query.isFetching,
    users: query.data,
    error: query.error,
  }
}
