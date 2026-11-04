import { getVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { REPO_URL } from '@/lib/app'
import { useUpdates } from './updateStore'

const LINKS = [
  { label: 'Source code', url: REPO_URL },
  { label: 'Releases', url: `${REPO_URL}/releases` },
  { label: 'Report a problem', url: `${REPO_URL}/issues/new/choose` },
  { label: 'License (MIT)', url: `${REPO_URL}/blob/main/LICENSE` },
  { label: 'Third-party notices', url: `${REPO_URL}/blob/main/THIRD-PARTY-NOTICES.md` },
]

export function AboutSettings() {
  const [version, setVersion] = useState<string>()
  const status = useUpdates((s) => s.status)
  const auto = useUpdates((s) => s.auto)
  const setAuto = useUpdates((s) => s.setAuto)
  const check = useUpdates((s) => s.check)
  const install = useUpdates((s) => s.install)

  useEffect(() => {
    getVersion().then(setVersion, () => undefined)
  }, [])

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">About</h3>
      <p className="mt-1 text-sm">Tracket {version ?? ''}</p>
      <p className="text-sm text-muted-foreground">A lightweight Jira Cloud client. Free and open source.</p>

      <h3 className="mt-8 text-xs font-medium uppercase tracking-wide text-muted-foreground">Updates</h3>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" disabled={status.kind === 'checking' || status.kind === 'installing'} onClick={() => check(true)}>
          {status.kind === 'checking' && <Spinner />}
          Check for updates
        </Button>
        {status.kind === 'upToDate' && <span className="text-sm text-muted-foreground">You have the latest version.</span>}
        {status.kind === 'error' && <span className="text-sm text-destructive">Couldn't check: {status.message}</span>}
        {status.kind === 'available' && (
          <>
            <span className="text-sm">Version {status.update.version} is available.</span>
            <Button size="sm" onClick={install}>
              Update and restart
            </Button>
          </>
        )}
        {status.kind === 'installing' && (
          <span className="text-sm text-muted-foreground">
            Downloading… {status.percent === null ? '' : `${status.percent}%`}
          </span>
        )}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        Check for updates when Tracket starts
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        Checking asks github.com for the latest release, like opening its page would: GitHub sees your IP address, and
        nothing else is sent. Updates are verified against a signature before they are installed.
      </p>

      <h3 className="mt-8 text-xs font-medium uppercase tracking-wide text-muted-foreground">Links</h3>
      <ul className="mt-2 space-y-1">
        {LINKS.map(({ label, url }) => (
          <li key={url}>
            <button className="text-sm underline hover:text-foreground text-muted-foreground" onClick={() => openUrl(url)}>
              {label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
