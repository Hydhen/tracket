import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { LoginScreen } from '@/features/auth/LoginScreen'
import { useSession } from '@/features/auth/useSession'
import { MainShell } from '@/features/main/MainShell'

export default function App() {
  const { data: session, error, isPending, refetch, isFetching } = useSession()

  if (isPending) {
    return <div className="flex h-screen items-center justify-center">
        <Spinner className="size-10" />
      </div>
  }

  // Jira unreachable (offline, VPN…): keep the saved login and let the user retry
  if (error?.kind === 'network') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <Button onClick={() => refetch()} disabled={isFetching}>
          Retry
        </Button>
      </div>
    )
  }

  if (!session) {
    return <LoginScreen initialError={error?.message} />
  }

  return <MainShell session={session} />
}
