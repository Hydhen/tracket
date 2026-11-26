import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, type ApiError, type SprocketSession } from '@/lib/api'
import { useSprocketPrefs, useSprocketSession } from './useSprocket'

/** Where Sprocket listens when it runs on this computer */
const DEFAULT_ADDRESS = 'http://127.0.0.1:47821'

const DATA: [string, string, string][] = [
  ['Sprocket token', 'System keychain (Windows Credential Manager)', 'Only the Rust side of the app, sent only to your Sprocket'],
  [
    'Ticket key, title and link, and its worktree folder',
    'Sent to Sprocket when you start a workflow',
    "Sprocket and its agents; agents read the full ticket from Jira themselves",
  ],
  ['Runs, stages and approvals', 'Fetched from Sprocket when displayed, kept in memory', 'Only on this computer'],
]

function statusLine(session: SprocketSession) {
  if (!session.reachable) return { text: session.message ?? "Sprocket doesn't answer. Is it running?", tone: 'text-destructive' }
  const agents = session.agentsReady ? '' : " Its agents can't run right now: see Sprocket."
  return {
    text: `Connected to Sprocket ${session.version ?? ''}. The token is kept in Windows Credential Manager, like your Jira token.${agents}`,
    tone: 'text-emerald-700 dark:text-emerald-300',
  }
}

/** Settings › Sprocket: the connection to Sprocket, and which of its parts show on a ticket. */
export function SprocketSettings() {
  const queryClient = useQueryClient()
  const session = useSprocketSession()
  const prefs = useSprocketPrefs()
  const [address, setAddress] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [askToken, setAskToken] = useState(false)
  const done = () => queryClient.invalidateQueries({ queryKey: ['sprocket-session'] })

  const signIn = useMutation<SprocketSession, ApiError>({
    mutationFn: () => api.sprocketSignIn(address ?? session.data?.address ?? DEFAULT_ADDRESS, token),
    onSuccess: () => {
      setToken('')
      setAskToken(false)
      void done()
    },
    // Sprocket's own token isn't readable here: ask for it
    onError: (e) => e.message.includes('token') && setAskToken(true),
  })
  const signOut = useMutation<void, ApiError>({ mutationFn: api.sprocketSignOut, onSuccess: () => void done() })

  const signedIn = !!session.data
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (signedIn) signOut.mutate()
    else signIn.mutate()
  }

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sprocket</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Let Sprocket's agents work on your tickets: start workflows from a ticket, follow their runs and answer their
        approvals without leaving Tracket.
      </p>

      <form onSubmit={submit}>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex min-w-80 flex-1 flex-col gap-1.5">
            <label htmlFor="sprocket-address" className="text-sm font-medium">
              Address
            </label>
            <Input
              id="sprocket-address"
              className="font-mono text-[13px]"
              value={address ?? session.data?.address ?? DEFAULT_ADDRESS}
              disabled={signedIn}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <Button type="submit" variant={signedIn ? 'outline' : 'default'} disabled={signIn.isPending || signOut.isPending}>
            {(signIn.isPending || signOut.isPending) && <Spinner />}
            {signedIn ? 'Sign out of Sprocket' : 'Sign in'}
          </Button>
        </div>
        {askToken && !signedIn && (
          <div className="mt-3 flex flex-col gap-1.5">
            <label htmlFor="sprocket-token" className="text-sm font-medium">
              Token
            </label>
            <Input id="sprocket-token" type="password" className="font-mono" value={token} onChange={(e) => setToken(e.target.value)} />
            <p className="text-xs text-muted-foreground">In Sprocket, open Integrations › Tracket and click "Copy token".</p>
          </div>
        )}
      </form>
      <p role="status" className="mt-2 text-xs">
        {signIn.error ? (
          <span className="text-destructive">{signIn.error.message}</span>
        ) : session.isPending ? (
          <span className="text-muted-foreground">Checking…</span>
        ) : session.data ? (
          <span className={statusLine(session.data).tone}>{statusLine(session.data).text}</span>
        ) : (
          <span className="text-muted-foreground">Not signed in. Agents features stay hidden until you sign in.</span>
        )}
      </p>

      <h3 className="mt-8 text-xs font-medium uppercase tracking-wide text-muted-foreground">On a ticket</h3>
      <div className="mt-2.5 flex flex-col gap-2.5">
        {(
          [
            ['section', 'Agents section on tickets', 'The run, its stages and approval requests, under the ticket fields'],
            ['button', 'Agents button next to Start working', 'Start a workflow on the ticket, in its worktree'],
          ] as const
        ).map(([key, label, help]) => (
          <label key={key} className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-(--sp-accent)"
              checked={prefs[key]}
              onChange={(e) => prefs.set({ [key]: e.target.checked })}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm">{label}</span>
              <span className="text-xs text-muted-foreground">{help}</span>
            </span>
          </label>
        ))}
      </div>

      <h3 className="mt-8 text-xs font-medium uppercase tracking-wide text-muted-foreground">Your data</h3>
      <div className="mt-2.5 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              {['What', 'Where it lives', 'Who sees it'].map((h) => (
                <th key={h} scope="col" className="border-b px-2 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DATA.map(([what, where, who]) => (
              <tr key={what}>
                <td className="border-b p-2 align-top">{what}</td>
                <td className="border-b p-2 align-top text-muted-foreground">{where}</td>
                <td className="border-b p-2 align-top text-muted-foreground">{who}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
