import { useEffect } from 'react'
import { Spinner } from '@/components/Spinner'
import { TitleBar } from '@/components/TitleBar'
import { Button } from '@/components/ui/button'
import { LoginScreen } from '@/features/auth/LoginScreen'
import { useSession } from '@/features/auth/useSession'
import { MainShell } from '@/features/main/MainShell'
import { MiniNotch } from '@/features/timer/MiniNotch'
import { useMiniMode } from '@/features/timer/miniMode'
import { cn } from '@/lib/utils'

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
  const mini = useMiniMode((s) => s.mini)
  useEffect(() => {
    document.documentElement.toggleAttribute('data-mini', mini)
  }, [mini])

  return (
    <>
      {mini && <MiniNotch />}
      {/* Hidden, not removed, while mini: what the person was doing is still there when it's back */}
      <div className={cn('flex h-screen flex-col bg-background text-foreground', mini && 'hidden')}>
        <TitleBar />
        <div className="min-h-0 flex-1">
          <Screen />
        </div>
      </div>
    </>
  )
}
