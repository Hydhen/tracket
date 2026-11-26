import { Sparkles } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import type { IssueSummary, SprocketTicket } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAgentActions, useAgentsUi } from './agentActions'
import { SprocketMark } from './SprocketMark'
import { agentStatus, defaultWorkflow, splitWorkflows, useSprocketPrefs, useSprocketReady, useSprocketTickets, useSprocketWorkflows } from './useSprocket'

type Colors = { glow: string; tint: string }
const AGENTS: Colors = { glow: 'var(--zone-agents)', tint: 'var(--zone-agents-tint)' }
const APPROVE: Colors = { glow: 'var(--zone-approve)', tint: 'var(--zone-approve-tint)' }
const RETRY: Colors = { glow: 'var(--zone-retry)', tint: 'var(--zone-retry-tint)' }
const STOP: Colors = { glow: 'var(--zone-stop)', tint: 'var(--zone-stop-tint)' }

/** A place to drop the tickets on: lit while they are over it. */
function Target({
  id,
  hover,
  setHover,
  onDrop,
  colors,
  dashed,
  children,
}: {
  id: string
  hover: string | null
  setHover: (id: string | null) => void
  onDrop: () => void
  colors: Colors
  dashed?: boolean
  children: React.ReactNode
}) {
  const on = hover === id
  const over = (e: DragEvent) => {
    e.preventDefault() // makes it a valid drop target
    e.dataTransfer.dropEffect = 'move'
    if (!on) setHover(id)
  }
  return (
    <div
      data-part="agents-target"
      onDragOver={over}
      onDragLeave={() => on && setHover(null)}
      onDrop={(e) => {
        e.preventDefault()
        setHover(null)
        onDrop()
      }}
      className={cn(
        'box-border flex min-h-16 min-w-0 flex-[1_1_200px] flex-col justify-center gap-1 rounded-xl border px-3.5 py-2 transition-[background,border-color,box-shadow,transform] duration-200',
        dashed && 'border-dashed',
      )}
      style={{
        background: on ? colors.tint : 'var(--overlay-surface)',
        borderColor: on ? colors.glow : 'var(--overlay-line-soft)',
        boxShadow: on ? `0 0 0 1px ${colors.glow}, 0 0 32px color-mix(in oklab, ${colors.glow} 33%, transparent)` : 'none',
        transform: on ? 'scale(1.03)' : 'none',
      }}
    >
      {/* No pointer events on the content, or hovering it fires dragleave on the target */}
      <div className="pointer-events-none flex min-w-0 flex-col gap-1">{children}</div>
    </div>
  )
}

function Name({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{children}</span>
    </span>
  )
}

/**
 * The drag overlay's Sprocket band, while signed in: hand the dragged tickets to one of Sprocket's workflows (each
 * gets its own run, in its own worktree), ask an agent in words, or act on the runs they already have.
 */
export function AgentsDropBand({ issues, onDone }: { issues: IssueSummary[]; onDone: () => void }) {
  const ready = useSprocketReady()
  const workflows = useSprocketWorkflows(ready)
  const tickets = useSprocketTickets().byKey
  const defaults = useSprocketPrefs((s) => s.defaults)
  const { start, onRuns } = useAgentActions()
  const ask = useAgentsUi((s) => s.ask)
  const [hover, setHover] = useState<string | null>(null)
  if (!ready) return null

  const { plain, ask: askWorkflow } = splitWorkflows(workflows.data)
  const projects = [...new Set(issues.map((i) => i.projectKey))]
  const projectDefault = projects.length === 1 ? defaultWorkflow(workflows.data, defaults, projects[0])?.id : undefined
  const many = issues.length > 1

  const runs = issues.flatMap((i) => (tickets.get(i.key) ? [tickets.get(i.key)!] : []))
  const waiting = runs.filter((t) => t.state === 'waiting' && t.approvalKind === 'gate' && t.approvalId)
  const failed = runs.filter((t) => (t.state === 'failed' || t.state === 'interrupted') && t.failedJobId)
  const stoppable = runs.filter((t) => agentStatus(t))
  const busy = runs.filter((t) => t.state === 'running' || t.state === 'waiting')
  const warn = busy.length
    ? `${busy.map((t) => t.ticketKey).join(', ')} already ${busy.length > 1 ? 'have' : 'has'} a run: a new workflow starts a second one.`
    : null

  const done = (act: () => void) => () => {
    onDone()
    act()
  }
  const actions: { id: string; name: string; help: string; colors: Colors; list: SprocketTicket[]; what: 'approve' | 'retry' | 'stop' }[] = [
    { id: 'approve', name: 'Approve waiting step', help: 'Same as Approve on the ticket', colors: APPROVE, list: waiting, what: 'approve' },
    { id: 'retry', name: 'Retry failed step', help: 'Runs the failed step again', colors: RETRY, list: failed, what: 'retry' },
    { id: 'stop', name: 'Stop run', help: 'Cancels it; the agents stop where they are', colors: STOP, list: stoppable, what: 'stop' },
  ]

  return (
    <div data-part="agents-band" className="shrink-0 border-t border-overlay-line-soft px-3 pt-2.5 pb-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <SprocketMark className="size-4" />
        <span className="text-sm font-semibold">Hand to agents</span>
        <span className="text-xs text-overlay-muted">
          Sprocket starts the workflow on {many ? `each of the ${issues.length} tickets, in its own worktree` : 'the ticket, in its worktree'}
        </span>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {workflows.isPending && <span className="text-xs text-overlay-muted">Asking Sprocket for its workflows…</span>}
        {workflows.error && <span className="text-xs text-overlay-error">{workflows.error.message}</span>}
        {plain.map((w) => (
          <Target
            key={w.id}
            id={`wf:${w.id}`}
            hover={hover}
            setHover={setHover}
            colors={AGENTS}
            onDrop={done(() => void start(issues.map((issue) => ({ issue, workflow: w.id, name: w.name }))))}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Name color={AGENTS.glow}>{w.name}</Name>
              {w.id === projectDefault && (
                <span className="shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase" style={{ background: AGENTS.tint, color: AGENTS.glow }}>
                  Default
                </span>
              )}
            </span>
            {w.description && <span className="line-clamp-1 text-xs text-overlay-muted">{w.description}</span>}
          </Target>
        ))}
        {askWorkflow ? (
          <Target id="ask" hover={hover} setHover={setHover} colors={AGENTS} dashed onDrop={done(() => ask(issues))}>
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4" style={{ color: AGENTS.glow }} />
              Ask an agent…
            </span>
            <span className="text-xs text-overlay-muted">Write what you want done; the agent plans the steps first</span>
          </Target>
        ) : (
          workflows.data && (
            <div className="flex min-h-16 flex-[1_1_200px] flex-col justify-center gap-1 rounded-xl border border-dashed border-overlay-line-soft px-3.5 py-2 opacity-60">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4" />
                Ask an agent…
              </span>
              <span className="text-xs text-overlay-muted">No workflow in Sprocket runs requests (see its ask-an-agent example)</span>
            </div>
          )
        )}
      </div>

      {actions.some((a) => a.list.length > 0) && (
        <div className="mt-2.5 flex flex-wrap gap-2.5">
          {actions
            .filter((a) => a.list.length > 0)
            .map((a) => (
              <Target key={a.id} id={a.id} hover={hover} setHover={setHover} colors={a.colors} onDrop={done(() => void onRuns(a.what, a.list))}>
                <Name color={a.colors.glow}>
                  {a.name}
                  {many && <span className="font-normal text-overlay-muted"> · {a.list.map((t) => t.ticketKey).join(', ')}</span>}
                </Name>
                <span className="text-xs text-overlay-muted">{a.help}</span>
              </Target>
            ))}
        </div>
      )}
      {warn && <div className="mt-2 text-xs" style={{ color: 'var(--zone-unassign)' }}>{warn}</div>}
    </div>
  )
}
