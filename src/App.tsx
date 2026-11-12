import { Spinner } from '@/components/Spinner'
import { TitleBar } from '@/components/TitleBar'
import { Button } from '@/components/ui/button'
import { LoginScreen } from '@/features/auth/LoginScreen'
import { useSession } from '@/features/auth/useSession'
import { MainShell } from '@/features/main/MainShell'

/** What the window shows under its title bar. */
function Screen() {
  const { data: session, error, isPending, refetch, isFetching } = useSession()

  if (isPending) {
    return <div className="flex h-full items-center justify-center">
        <Spinner className="size-10" />
      </div>
  }

  // Jira unreachable (offline, VPN…): keep the saved login and let the user retry
  if (error?.kind === 'network') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
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

export default function App() {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TitleBar />
      <div className="min-h-0 flex-1">
        <Screen />
      </div>
    </div>
  )
}
