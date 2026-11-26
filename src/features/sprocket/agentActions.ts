import { useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { useSession } from '@/features/auth/useSession'
import { api, type IssueSummary, type SprocketRun, type SprocketTicket } from '@/lib/api'
import { ticketWorktree } from './worktree'

export interface AgentsToast {
  message: string
  /** One line per ticket it didn't work for */
  errors: string[]
  action?: { label: string; run: () => void }
}

/** What the Sprocket parts of the main pane show: the toast after a drop, and the "Ask an agent" dialog. */
export const useAgentsUi = create<{
  toast: AgentsToast | null
  /** The tickets dropped on "Ask an agent…", while the request is being written */
  asking: IssueSummary[] | null
  showToast: (toast: AgentsToast | null) => void
  ask: (issues: IssueSummary[] | null) => void
}>((set) => ({
  toast: null,
  asking: null,
  showToast: (toast) => set({ toast }),
  ask: (asking) => set({ asking }),
}))

const keys = (issues: { key: string }[]) => issues.map((i) => i.key).join(', ')
const failure = (key: string, e: unknown) => `${key}: ${e instanceof Error ? e.message : String(e)}`

/**
 * Starting workflows on tickets and acting on their runs, for several tickets at once. Each ticket succeeds or
 * fails on its own (no project for its worktree, something in the way, the workflow at its limit); the toast
 * says which.
 */
export function useAgentActions() {
  const queryClient = useQueryClient()
  const me = useSession().data?.displayName ?? 'Tracket'
  const showToast = useAgentsUi((s) => s.showToast)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['sprocket-tickets'] })
    void queryClient.invalidateQueries({ queryKey: ['sprocket-runs'] })
  }

  const openRun = (runId: string) => ({
    label: 'Open in Sprocket',
    // An older Sprocket can't: say so rather than doing nothing
    run: () => void api.sprocketShowRun(runId).catch((e) => showToast({ message: "Couldn't open the run in Sprocket", errors: [String(e?.message ?? e)] })),
  })

  /**
   * Starts a workflow on each ticket (its own workflow each), in the ticket's worktree. The worktrees are made one
   * after the other (each fetches in the shared repository), then the runs start together. Returns how many started.
   */
  const start = async (items: { issue: IssueSummary; workflow: string; name: string }[], request?: string, skipped: string[] = []) => {
    const folders: PromiseSettledResult<string>[] = []
    for (const { issue } of items) {
      folders.push(await ticketWorktree(queryClient, issue).then((value) => ({ status: 'fulfilled' as const, value }), (reason) => ({ status: 'rejected' as const, reason })))
    }
    const results = await Promise.allSettled(
      items.map(async ({ issue, workflow }, i) => {
        const folder = folders[i]
        if (folder.status === 'rejected') throw folder.reason
        return api.sprocketStartRun({ workflow, key: issue.key, title: issue.summary, url: issue.url, folder: folder.value, startedBy: me, request })
      }),
    )
    const started: { key: string; name: string; run: SprocketRun }[] = []
    const errors = [...skipped]
    results.forEach((r, i) => {
      const { issue, name } = items[i]
      if (r.status === 'fulfilled') started.push({ key: issue.key, name, run: r.value })
      else errors.push(failure(issue.key, r.reason))
    })
    refresh()
    const names = [...new Set(started.map((s) => s.name))]
    showToast({
      message: started.length
        ? `Sprocket started ${names.length === 1 ? names[0] : 'their default workflows'} on ${keys(started)}`
        : `Sprocket started nothing`,
      errors,
      action: started.length ? openRun(started[0].run.id) : undefined,
    })
    return started.length
  }

  /** The same action on each ticket's latest run: approve its waiting step, retry its failed step, or stop it. */
  const onRuns = async (what: 'approve' | 'retry' | 'stop', tickets: SprocketTicket[]) => {
    const act = (t: SprocketTicket) =>
      what === 'approve'
        ? api.sprocketDecide(t.approvalId ?? '', true, me)
        : what === 'retry'
          ? api.sprocketRetryJob(t.failedJobId ?? '')
          : api.sprocketCancelRun(t.runId, me)
    const results = await Promise.allSettled(tickets.map(act))
    const done = tickets.filter((_, i) => results[i].status === 'fulfilled')
    const errors = results.flatMap((r, i) => (r.status === 'rejected' ? [failure(tickets[i].ticketKey, r.reason)] : []))
    refresh()
    const verb = { approve: 'Approved the waiting step on', retry: 'Retrying the failed step on', stop: 'Stopped the run on' }[what]
    showToast({
      message: done.length ? `${verb} ${done.map((t) => t.ticketKey).join(', ')}` : 'Nothing changed',
      errors,
      action: done.length ? openRun(done[0].runId) : undefined,
    })
  }

  return { start, onRuns }
}
