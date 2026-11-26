import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { useAgentActions, useAgentsUi } from './agentActions'
import { splitWorkflows, useSprocketPrefs, useSprocketReady, useSprocketTickets, useSprocketWorkflows } from './useSprocket'

/** Bottom-centre, after tickets were handed to agents: what Sprocket did, for which tickets, and a way to it. */
function AgentsToast() {
  const toast = useAgentsUi((s) => s.toast)
  const showToast = useAgentsUi((s) => s.showToast)
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => showToast(null), toast.errors.length ? 15_000 : 8_000)
    return () => window.clearTimeout(id)
  }, [toast, showToast])

  return (
    <div role="status" className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-4">
      {toast && (
        <div className="move-toast pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border bg-popover py-1 pl-4 pr-1.5 text-[13px] text-popover-foreground shadow-lg">
          <div className="min-w-0 py-2">
            <div>{toast.message}</div>
            {toast.errors.map((message) => (
              <div key={message} className="text-destructive">
                {message}
              </div>
            ))}
          </div>
          {toast.action && (
            <button
              onClick={() => {
                toast.action?.run()
                showToast(null)
              }}
              className="h-11 shrink-0 rounded-lg px-3.5 text-[13px] font-semibold text-action hover:bg-accent"
            >
              {toast.action.label}
            </button>
          )}
          <button onClick={() => showToast(null)} className="h-11 shrink-0 rounded-lg px-3.5 text-[13px] hover:bg-accent">
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

/** "Ask an agent": what you want done on the dropped tickets, run by the workflow Sprocket has for requests. */
function AskAgentDialog() {
  const issues = useAgentsUi((s) => s.asking)
  const close = useAgentsUi((s) => s.ask)
  const workflows = useSprocketWorkflows(!!issues)
  const { ask } = splitWorkflows(workflows.data)
  const { start } = useAgentActions()
  const [request, setRequest] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!issues) return
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && close(null)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [issues, close])

  if (!issues) return null
  const send = async () => {
    if (!ask || !request.trim()) return
    setSending(true)
    try {
      // Kept open with what was written when nothing started (the toast says why)
      const started = await start(issues.map((issue) => ({ issue, workflow: ask.id, name: ask.name })), request.trim())
      if (started > 0) {
        setRequest('')
        close(null)
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[16vh]" onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-agent-title"
        className="w-full max-w-lg rounded-lg border bg-background p-4 text-foreground shadow-xl"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <h2 id="ask-agent-title" className="text-sm font-semibold">
          Ask an agent about {issues.length > 1 ? `${issues.length} tickets` : issues[0].key}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {ask
            ? `${ask.name} reads ${issues.length > 1 ? 'each ticket' : 'the ticket'}, plans the steps and waits for your approval before changing anything.`
            : 'No workflow in Sprocket runs requests.'}
        </p>
        <textarea
          autoFocus
          aria-label="What should the agent do?"
          placeholder="What should the agent do?"
          className="mt-3 min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && void send()}
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">Ctrl+Enter to send</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!ask || !request.trim() || sending}>
            {sending && <Spinner />}
            Start
          </Button>
        </div>
      </form>
    </div>
  )
}

/**
 * Windows notifications when an agent needs you: a step waits for your approval, or a run failed. Only changes are
 * told: what was already so when Tracket started (the first answer) is not.
 */
function Notifier() {
  const ready = useSprocketReady()
  const on = useSprocketPrefs((s) => s.notify)
  const { byKey: tickets, loaded } = useSprocketTickets()
  const seen = useRef<Set<string> | null>(null)

  const events = [...tickets.values()].flatMap((t) =>
    t.state === 'waiting' && t.approvalId
      ? [{ id: `approval:${t.approvalId}`, title: `${t.ticketKey} needs you`, body: t.approvalSummary || `${t.workflowName} #${t.number} waits for your approval` }]
      : t.state === 'failed'
        ? [{ id: `failed:${t.failedJobId ?? t.runId}`, title: `${t.ticketKey}: run failed`, body: `${t.workflowName} #${t.number} failed` }]
        : [],
  )
  useEffect(() => {
    if (!ready || !loaded) return
    const fresh = events.filter((e) => seen.current && !seen.current.has(e.id))
    seen.current = new Set([...(seen.current ?? []), ...events.map((e) => e.id)])
    if (!on || fresh.length === 0) return
    void (async () => {
      let granted = await isPermissionGranted()
      if (!granted) granted = (await requestPermission()) === 'granted'
      if (!granted) return
      for (const e of fresh.slice(0, 3)) sendNotification({ title: e.title, body: e.body.slice(0, 200) })
    })().catch(() => {})
    // Runs on each answer; only ids not seen before are told
  }, [events, ready, loaded, on])

  return null
}

/** Sprocket's parts of the main pane, mounted once: they render nothing until signed in to Sprocket. */
export function SprocketLayer() {
  return (
    <>
      <AgentsToast />
      <AskAgentDialog />
      <Notifier />
    </>
  )
}
