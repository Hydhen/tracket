import { openUrl } from '@tauri-apps/plugin-opener'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { REPO_URL } from '@/lib/app'
import { useUpdates } from './updateStore'

/**
 * Bottom-right notice when a new version is out: what it is, what changed, and a button to install it.
 * The wrapper is a live region that is always mounted, so screen readers announce what appears in it.
 */
export function UpdateNotice() {
  const status = useUpdates((s) => s.status)
  const dismissed = useUpdates((s) => s.dismissed)
  const dismiss = useUpdates((s) => s.dismiss)
  const install = useUpdates((s) => s.install)

  const visible = status.kind === 'installing' || (status.kind === 'available' && status.update.version !== dismissed)

  return (
    <div role="status" className="pointer-events-none fixed bottom-4 right-4 z-40 w-72">
      {visible && (
        <div className="pointer-events-auto rounded-xl border bg-popover p-3 text-[13px] text-popover-foreground shadow-lg">
          {status.kind === 'installing' ? (
            <div className="flex items-center gap-2">
              <Spinner />
              {status.percent === null ? 'Downloading the update…' : `Downloading the update… ${status.percent}%`}
            </div>
          ) : status.kind === 'available' ? (
            <>
              <div className="font-medium">Tracket {status.update.version} is available</div>
              <div className="mt-0.5 text-muted-foreground">You have {status.update.currentVersion}.</div>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" onClick={install}>
                  Update and restart
                </Button>
                <Button size="sm" variant="ghost" onClick={dismiss}>
                  Later
                </Button>
                <button
                  className="ml-auto text-xs underline text-muted-foreground hover:text-foreground"
                  onClick={() => openUrl(`${REPO_URL}/releases/tag/v${status.update.version}`)}
                >
                  What's new
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
