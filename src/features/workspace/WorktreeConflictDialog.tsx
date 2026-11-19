import { useQuery } from '@tanstack/react-query'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, Info, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, type WorktreeConflict, type WorktreeStrategy } from '@/lib/api'
import { submitOnCtrlEnter } from '@/lib/submitShortcut'
import { cn } from '@/lib/utils'
import type { LauncherId } from './launcher'
import { isVscodeFolder, useWorktreeFolder } from './worktreeFolder'

type Choice = WorktreeStrategy['kind']

/**
 * Asked when the folder a ticket's worktree should go in is in the way: a folder git doesn't know as a
 * worktree (what a removal left behind), or the branch already checked out somewhere else. Nothing has
 * been touched when this shows; the user picks what to do about it.
 */
export function WorktreeConflictDialog({
  issueKey,
  app,
  conflict,
  busy,
  error,
  onChoose,
  onCancel,
}: {
  issueKey: string
  app: LauncherId
  conflict: WorktreeConflict
  /** What was chosen is being done */
  busy: boolean
  /** Why what was chosen failed */
  error?: string
  onChoose: (strategy: WorktreeStrategy) => void
  onCancel: () => void
}) {
  const elsewhere = conflict.kind === 'branchElsewhere'
  // Nothing is lost by default: use the worktree git has, or keep the leftover where it is
  const [choice, setChoice] = useState<Choice>(elsewhere ? 'reuse' : 'elsewhere')

  // The folder last picked for this app, else the one proposed for it
  const remembered = useWorktreeFolder((s) => s.chosen[app])
  const proposed = useQuery({ queryKey: ['worktree-bases'], queryFn: api.worktreeBases, staleTime: Infinity })
  const [typed, setTyped] = useState<string | null>(null)
  const shown = typed ?? remembered ?? proposed.data?.[app === 'herdr' ? 'herdr' : 'tracket'] ?? ''
  const base = shown.trim()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  const browse = async () => {
    const picked = await open({ directory: true, title: 'Folder for the worktrees', defaultPath: base || undefined })
    if (typeof picked === 'string') setTyped(picked)
  }

  const blocked =
    choice === 'replace' ? conflict.replaceBlocked : choice === 'elsewhere' ? conflict.elsewhereBlocked : null
  const canGo = !busy && !blocked && (choice !== 'elsewhere' || base !== '')

  const go = (e?: FormEvent) => {
    e?.preventDefault()
    if (!canGo) return
    if (choice === 'elsewhere') {
      useWorktreeFolder.getState().choose(app, base)
      onChoose({ kind: 'elsewhere', base })
    } else {
      onChoose({ kind: choice })
    }
  }

  const leftover = conflict.leftover.length > 0 ? ` (${conflict.leftover.join(', ')}…)` : ''
  const options: { id: Choice; title: string; detail: string; blocked: string | null }[] = [
    {
      id: 'reuse',
      title: elsewhere ? 'Use the existing worktree' : 'Open the folder as it is',
      detail: elsewhere
        ? `${issueKey} is already checked out in ${conflict.registeredAt}. Work there.`
        : `It isn't a git worktree, so it isn't on branch ${issueKey}: it follows whichever branch the repository has checked out.`,
      blocked: null,
    },
    {
      id: 'replace',
      title: 'Delete and create',
      detail: elsewhere
        ? `Removes the worktree in ${conflict.registeredAt}${conflict.leftover.length > 0 ? `, and what is left in ${conflict.path}` : ''}, then creates a new one in ${conflict.path}.`
        : `Deletes ${conflict.path}${leftover}, then creates a worktree there.`,
      blocked: conflict.replaceBlocked,
    },
    {
      id: 'elsewhere',
      title: 'Create in your user folder',
      detail: `Creates the worktree in a folder of your own, as <folder>/<repo>/${issueKey}.${
        conflict.leftover.length > 0 ? ` ${conflict.path} is left as it is.` : ''
      }`,
      blocked: conflict.elsewhereBlocked,
    },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[10vh]"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="worktree-title"
        onSubmit={go}
        onKeyDown={submitOnCtrlEnter(go)}
        className="flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-xl"
      >
        <div className="border-b px-4 py-3">
          <h2 id="worktree-title" className="text-sm font-semibold">
            {issueKey} already has a worktree folder
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {elsewhere
              ? `The branch ${issueKey} is checked out in another worktree, so git can't check it out in ${conflict.path}.`
              : `${conflict.path} exists, but git doesn't know it as a worktree. It is probably what an earlier removal left behind.`}{' '}
            Nothing has been changed yet.
          </p>
        </div>

        <div className="space-y-2 overflow-auto px-4 py-4">
          <div role="radiogroup" aria-label="What to do" className="space-y-2">
            {options.map((o) => (
              <label
                key={o.id}
                className={cn(
                  'block cursor-pointer rounded-md border p-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
                  choice === o.id ? 'border-ring bg-accent/50 ring-1 ring-ring' : 'hover:bg-accent/30',
                  o.blocked && 'cursor-not-allowed opacity-60 hover:bg-transparent',
                )}
              >
                <input
                  type="radio"
                  name="worktree-strategy"
                  checked={choice === o.id}
                  disabled={!!o.blocked || busy}
                  onChange={() => setChoice(o.id)}
                  className="sr-only"
                />
                <span className="block text-sm font-medium">{o.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{o.detail}</span>
                {o.blocked && (
                  <span className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    {o.blocked}
                  </span>
                )}
              </label>
            ))}
          </div>

          {choice === 'elsewhere' && !conflict.elsewhereBlocked && (
            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <label htmlFor="worktree-base" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Folder for the worktrees
              </label>
              <div className="flex gap-2">
                <Input
                  id="worktree-base"
                  value={shown}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="~/.tracket/worktrees"
                  spellCheck={false}
                  disabled={busy}
                  aria-invalid={isVscodeFolder(base)}
                />
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={browse} disabled={busy}>
                  <FolderOpen className="size-3.5" />
                  Browse…
                </Button>
              </div>
              <p
                className={cn(
                  'flex items-start gap-1.5 text-xs',
                  isVscodeFolder(base) ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {isVscodeFolder(base) ? (
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                ) : (
                  <Info className="mt-px size-3.5 shrink-0" />
                )}
                <span>
                  Avoid <code className="rounded bg-muted px-1">.vscode</code> folders: VS Code keeps its extensions and
                  settings there, and nothing else belongs in it.{' '}
                  {app === 'herdr'
                    ? "herdr keeps its own worktrees in ~/.herdr/worktrees, which is what is proposed."
                    : 'Tracket proposes ~/.tracket/worktrees, a folder of its own.'}
                </span>
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" size="sm" variant={choice === 'replace' ? 'destructive' : 'default'} disabled={!canGo}>
            {busy ? <Spinner /> : choice === 'replace' ? 'Delete and create' : choice === 'reuse' ? 'Use it' : 'Create there'}
          </Button>
        </div>
      </form>
    </div>
  )
}
