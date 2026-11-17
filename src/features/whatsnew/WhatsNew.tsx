import { getVersion } from '@tauri-apps/api/app'
import { Sparkles, Wrench, X, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import changelogSource from '../../../CHANGELOG.md?raw'
import { parseChangelog, type Change, type ChangeKind, type Release } from './changelog'
import { useWhatsNew } from './whatsNewStore'

const RELEASES = parseChangelog(changelogSource)

/** In the order a person wants them: what breaks, then what is new, then the small things */
const GROUPS: { kind: ChangeKind; label: string; icon: LucideIcon; tone: string }[] = [
  { kind: 'major', label: 'Breaking changes', icon: TriangleAlert, tone: 'text-destructive' },
  { kind: 'minor', label: 'New', icon: Sparkles, tone: 'text-primary' },
  { kind: 'patch', label: 'Fixes and polish', icon: Wrench, tone: 'text-muted-foreground' },
]

/** The text of a change, with what was written between backticks set as code */
function Text({ children }: { children: string }) {
  const parts = children.split(/`([^`]+)`/)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  )
}

function ChangeItem({ change }: { change: Change }) {
  return (
    <li className="text-sm">
      <span className="font-medium">
        <Text>{change.headline}</Text>
      </span>
      {change.detail && (
        <span className="text-muted-foreground">
          {' '}
          <Text>{change.detail}</Text>
        </span>
      )}
    </li>
  )
}

function ReleaseChanges({ release }: { release: Release }) {
  return (
    <div className="space-y-4">
      {GROUPS.filter((g) => release.changes[g.kind].length > 0).map(({ kind, label, icon: GroupIcon, tone }) => (
        <section key={kind}>
          <h4 className={cn('mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide', tone)}>
            <GroupIcon className="size-3.5" />
            {label}
          </h4>
          <ul className="list-disc space-y-2 pl-5 marker:text-muted-foreground/60">
            {release.changes[kind].map((change, i) => (
              <ChangeItem key={i} change={change} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** "3 new · 2 fixes", for a version that is folded */
function summary(release: Release): ReactNode {
  const parts = [
    release.changes.major.length && `${release.changes.major.length} breaking`,
    release.changes.minor.length && `${release.changes.minor.length} new`,
    release.changes.patch.length && `${release.changes.patch.length} ${release.changes.patch.length > 1 ? 'fixes' : 'fix'}`,
  ].filter(Boolean)
  return parts.join(' · ')
}

/**
 * What changed in each version, newest first: the version in use opens on its changes, the older ones are folded
 * (a click unfolds them). Closed with Esc, the cross, or a click beside it.
 */
function WhatsNewDialog({ version, onClose }: { version: string | undefined; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Closes this and nothing under it (the settings may be open)
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  // The newest version at most is the one in use: a build can be older than the file it carries only by mistake
  const current = RELEASES.find((r) => r.version === version) ?? RELEASES[0]

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center bg-black/40 px-4 pt-[8vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-xl"
      >
        <div className="flex items-center border-b px-5 py-3">
          <h2 id="whats-new-title" className="text-sm font-semibold">
            What's new in Tracket
          </h2>
          <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="space-y-6 overflow-auto px-5 py-5">
          {!current ? (
            <p className="text-sm text-muted-foreground">There are no release notes in this version.</p>
          ) : (
            <>
              <section>
                <h3 className="mb-3 flex items-baseline gap-2">
                  <span className="text-lg font-semibold tracking-tight">Version {current.version}</span>
                  {current.version === version && <span className="text-xs text-muted-foreground">the one you have</span>}
                </h3>
                <ReleaseChanges release={current} />
              </section>

              {RELEASES.filter((r) => r !== current).length > 0 && (
                <section className="border-t pt-4">
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Before</h3>
                  <div className="space-y-1">
                    {RELEASES.filter((r) => r !== current).map((release) => (
                      <details key={release.version} className="group rounded-md border px-3 py-2 open:bg-muted/30">
                        <summary className="flex cursor-pointer list-none items-baseline gap-2 text-sm [&::-webkit-details-marker]:hidden">
                          <span className="font-medium">Version {release.version}</span>
                          <span className="text-xs text-muted-foreground">{summary(release)}</span>
                        </summary>
                        <div className="pt-3">
                          <ReleaseChanges release={release} />
                        </div>
                      </details>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The release notes, opened from Settings > About, and on their own the first time the app starts in a new version
 * (never the very first time it is installed, when there is nothing to catch up on).
 */
export function WhatsNew() {
  const open = useWhatsNew((s) => s.open)
  const show = useWhatsNew((s) => s.show)
  const hide = useWhatsNew((s) => s.hide)
  const lastSeen = useWhatsNew((s) => s.lastSeen)
  const setLastSeen = useWhatsNew((s) => s.setLastSeen)
  const [version, setVersion] = useState<string>()
  const known = useMemo(() => new Set(RELEASES.map((r) => r.version)), [])

  useEffect(() => {
    getVersion().then(setVersion, () => undefined)
  }, [])

  useEffect(() => {
    // A dev build runs whatever version the files say, and shares its settings with the installed app
    if (!version || import.meta.env.DEV || lastSeen === version) return
    setLastSeen(version)
    if (lastSeen !== null && known.has(version)) show()
  }, [version, lastSeen, known, setLastSeen, show])

  return open ? <WhatsNewDialog version={version} onClose={hide} /> : null
}
