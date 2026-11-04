import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'

const SESSION_KEY = ['session']

export function useSession() {
  return useQuery<Awaited<ReturnType<typeof api.currentSession>>, ApiError>({
    queryKey: SESSION_KEY,
    queryFn: api.currentSession,
    // Only worth retrying when Jira was unreachable; bad credentials won't fix themselves
    retry: (count, error) => error.kind === 'network' && count < 2,
    staleTime: Infinity,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation<
    Awaited<ReturnType<typeof api.login>>,
    ApiError,
    { site: string; email: string; token: string }
  >({
    mutationFn: ({ site, email, token }) => api.login(site, email, token),
    onSuccess: (session) => queryClient.setQueryData(SESSION_KEY, session),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError>({
    // The Rust side forgets the token and wipes the webview's storage
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear()
      // Start over: what the stores still hold in memory would otherwise be written back
      window.location.reload()
    },
  })
}
