import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth/useSession'
import { api, type ApiError, type IssueSummary, type SprocketRun } from '@/lib/api'
import { SprocketMark } from './SprocketMark'
import { useSprocketWorkflows } from './useSprocket'

/**
 * "Run with Sprocket": the workflows Sprocket offers, to start one on the ticket. The ticket's worktree is
 * made first (`worktreeFolder`, as Start working makes it), and Sprocket's agents work in it.
 * `trigger` is the header's Agents button, or the Agents section's "Run a workflow".
 */
export function AgentsMenu({
  issue,
  worktreeFolder,
  trigger,
}: {
  issue: IssueSummary
  worktreeFolder: () => Promise<string>
  trigger: 'header' | 'section'
}) {
  const queryClient = useQueryClient()
  const me = useSession().data?.displayName ?? 'Tracket'
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const workflows = useSprocketWorkflows(open)

  const start = useMutation<SprocketRun, ApiError, string>({
    mutationFn: async (workflow) =>
      api.sprocketStartRun({
        workflow,
        key: issue.key,
        title: issue.summary,
        url: issue.url,
        folder: await worktreeFolder(),
        startedBy: me,
      }),
    onSuccess: () => {
      setOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['sprocket-runs', issue.key] })
    },
  })

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false)
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      {trigger === 'header' ? (
        <Button
          variant="outline"
          className="h-8 gap-1.5 px-2 text-xs"
          title="Run a workflow with Sprocket"
          aria-label="Run a workflow with Sprocket"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {start.isPending ? <Spinner /> : <SprocketMark className="size-4" />}
          Agents
          <ChevronDown className="size-3" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {start.isPending && <Spinner />}
          Run a workflow
        </Button>
      )}

      {open && (
        <div
          role="menu"
          className={`absolute top-10 z-30 min-w-64 rounded-lg border bg-popover p-1 shadow-lg ${trigger === 'header' ? 'right-0' : 'left-0'}`}
        >
          <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Run with Sprocket</div>
          {workflows.isPending && (
            <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Asking Sprocket…
            </div>
          )}
          {workflows.error && <p className="px-2 py-2 text-sm text-destructive">{workflows.error.message}</p>}
          {workflows.data?.length === 0 && (
            <p className="px-2 py-2 text-sm text-muted-foreground">Sprocket offers no workflow in Tracket yet.</p>
          )}
          {workflows.data?.map((w) => (
            <button
              key={w.id}
              type="button"
              role="menuitem"
              disabled={start.isPending}
              onClick={() => start.mutate(w.id)}
              className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-accent disabled:opacity-60"
            >
              <span className="text-[13px] font-medium">{w.name}</span>
              {w.description && <span className="text-xs text-muted-foreground">{w.description}</span>}
            </button>
          ))}
          {start.error && <p className="max-w-72 px-2 py-2 text-xs text-destructive">{start.error.message}</p>}
        </div>
      )}
    </div>
  )
}
