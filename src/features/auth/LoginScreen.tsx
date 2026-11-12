import { openUrl } from '@tauri-apps/plugin-opener'
import { ExternalLink } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLogin } from './useSession'

const TOKEN_URL = 'https://id.atlassian.com/manage-profile/security/api-tokens'

export function LoginScreen({ initialError }: { initialError?: string }) {
  const [site, setSite] = useState('')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const login = useLogin()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate({ site, email, token })
  }

  const error = login.error?.message ?? initialError

  return (
    <div className="flex h-full items-center justify-center bg-background p-6 text-foreground">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">Tracket</h1>
          <p className="text-sm text-muted-foreground">Connect to your Jira Cloud site.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="site">Jira site</Label>
          <Input
            id="site"
            placeholder="acme.atlassian.net"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            autoFocus
            spellCheck={false}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Atlassian email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="token">API token</Label>
          <Input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => openUrl(TOKEN_URL)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            Create an API token <ExternalLink className="size-3" />
          </button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? 'Connecting…' : 'Connect'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Your token is stored in the Windows Credential Manager, never in a file.
        </p>
      </form>
    </div>
  )
}
