import { Info, ListChecks, LogOut, PanelTop, Rocket, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { useLogout } from '@/features/auth/useSession'
import { BulkEditSettings } from '@/features/bulk/BulkEditSettings'
import { elapsedOf, useNow, useTimers } from '@/features/timer/timerStore'
import { AboutSettings } from '@/features/update/AboutSettings'
import { QuickStartSettings } from '@/features/workspace/QuickStartSettings'
import { cn } from '@/lib/utils'
import { TicketDetailsSettings } from './TicketDetailsSettings'

type Category = 'details' | 'bulk' | 'quickstart' | 'account' | 'about'

const CATEGORIES: { id: Category; label: string; icon: LucideIcon }[] = [
  { id: 'details', label: 'Ticket details', icon: PanelTop },
  { id: 'bulk', label: 'Bulk edit', icon: ListChecks },
  { id: 'quickstart', label: 'Quick start', icon: Rocket },
  { id: 'account', label: 'Account', icon: LogOut },
  { id: 'about', label: 'About', icon: Info },
]

function AccountSettings({ site }: { site?: string }) {
  const logout = useLogout()
  const [confirming, setConfirming] = useState(false)
  const timers = useTimers((s) => s.timers)
  // Time that was never posted as a worklog is lost with the rest
  const now = useNow(false)
  const unposted = Object.values(timers).filter((t) => elapsedOf(t, now) > 0).length
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Account</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {site ? `Signed in to ${site}. ` : ''}Signing out erases everything Tracket keeps on this computer.
      </p>
      <Button variant="outline" size="sm" className="mt-3" disabled={logout.isPending} onClick={() => setConfirming(true)}>
        {logout.isPending ? <Spinner /> : <LogOut className="size-3.5" />}
        Sign out
      </Button>
      {logout.isError && <p className="mt-2 text-xs text-destructive">{logout.error.message}</p>}

      <h3 className="mt-8 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Your data on this computer
      </h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Your Jira API token is in the system keychain. It never reaches the interface, and is only sent to your Jira site.</li>
        <li>
          Timers, your settings and the folders linked to your projects are stored by the app on this computer. They hold
          ticket keys and field choices, never ticket titles or descriptions.
        </li>
        <li>Tracket talks to your Jira site only. There is no analytics and no other server.</li>
        <li>
          When you start working with herdr, the ticket key, title and link are sent to Claude Code as its first message.
        </li>
      </ul>

      {confirming && (
        <ConfirmDialog
          title="Sign out and erase local data?"
          confirmLabel="Sign out and erase"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            logout.mutate()
          }}
        >
          <p>The API token, your settings, linked folders and timers are removed from this computer.</p>
          {unposted > 0 && (
            <p className="font-medium text-foreground">
              {unposted === 1 ? '1 timer has' : `${unposted} timers have`} time that was not posted as a worklog: it will be
              lost.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  )
}

/**
 * The settings, in categories listed on the left. `linkProject` is a Jira project key whose tickets
 * have no project to start working in yet: it opens on Quick start, ready to add one for it.
 */
export function SettingsDialog({
  onClose,
  linkProject,
  site,
}: {
  onClose: () => void
  linkProject?: string
  site?: string
}) {
  const [category, setCategory] = useState<Category>(linkProject ? 'quickstart' : 'details')
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Up/Down move between categories, like any vertical list of tabs
  const onTabKeyDown = (e: KeyboardEvent, at: number) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = CATEGORIES[(at + step + CATEGORIES.length) % CATEGORIES.length]
    setCategory(next.id)
    tabs.current[next.id]?.focus()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[8vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-xl"
      >
        <div className="flex items-center border-b px-4 py-3">
          <h2 id="settings-title" className="text-sm font-semibold">
            Settings
          </h2>
          <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Close settings" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label="Settings categories"
            className="flex w-48 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-2"
          >
            {CATEGORIES.map(({ id, label, icon: CategoryIcon }, at) => (
              <button
                key={id}
                ref={(el) => {
                  tabs.current[id] = el
                }}
                role="tab"
                id={`settings-tab-${id}`}
                aria-selected={category === id}
                aria-controls="settings-panel"
                tabIndex={category === id ? 0 : -1}
                onClick={() => setCategory(id)}
                onKeyDown={(e) => onTabKeyDown(e, at)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  category === id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60',
                )}
              >
                <CategoryIcon className="size-4 shrink-0" />
                {label}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id="settings-panel"
            aria-labelledby={`settings-tab-${category}`}
            className="min-w-0 flex-1 overflow-auto px-6 py-5"
          >
            {category === 'details' && <TicketDetailsSettings />}
            {category === 'bulk' && <BulkEditSettings />}
            {category === 'quickstart' && <QuickStartSettings initialProject={linkProject} />}
            {category === 'account' && <AccountSettings site={site} />}
            {category === 'about' && <AboutSettings />}
          </div>
        </div>
      </div>
    </div>
  )
}
