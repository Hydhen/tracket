import { useState } from 'react'
import type { IssueSummary } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAgentActions } from './agentActions'
import { agentStatus, defaultWorkflow, TONE_COLOR, useSprocketPrefs, useSprocketTickets, useSprocketWorkflows } from './useSprocket'

/** What a ticket's row says about its latest Sprocket run: Needs you, Agent running, Run failed. */
export function AgentChip({ issueKey }: { issueKey: string }) {
  const status = agentStatus(useSprocketTickets().byKey.get(issueKey))
  if (!status) return null
  const color = TONE_COLOR[status.tone]
  return (
    <span data-part="agent-chip" className="inline-flex shrink-0 items-center gap-1.5 font-medium" style={{ color }}>
      <span aria-hidden className="size-1.5 rounded-full" style={{ background: color }} />
      {status.label}
    </span>
  )
}

/**
 * The sidebar's Agents tab. While tickets are dragged it is also a drop target: each ticket gets its project's
 * default workflow (Settings › Sprocket); a ticket whose project has none is named in the toast.
 */
export function AgentsTabButton({
  selected,
  needsYou,
  onPick,
  dragged,
  onDropped,
}: {
  selected: boolean
  needsYou: boolean
  onPick: () => void
  /** The tickets being dragged, if any */
  dragged: IssueSummary[] | null
  onDropped: () => void
}) {
  const [over, setOver] = useState(false)
  const workflows = useSprocketWorkflows(!!dragged)
  const defaults = useSprocketPrefs((s) => s.defaults)
  const { start } = useAgentActions()

  const drop = () => {
    const issues = dragged ?? []
    onDropped()
    const items = issues.flatMap((issue) => {
      const w = defaultWorkflow(workflows.data, defaults, issue.projectKey)
      return w ? [{ issue, workflow: w.id, name: w.name }] : []
    })
    const skipped = issues
      .filter((i) => !items.some((it) => it.issue.key === i.key))
      .map((i) => `${i.key}: no default workflow for ${i.projectKey} (Settings › Sprocket)`)
    void start(items, undefined, skipped)
  }

  return (
    <button
      role="tab"
      aria-selected={selected}
      onClick={onPick}
      title={dragged ? "Drop tickets here to run each one's default workflow" : 'Your tickets an agent works on'}
      onDragOver={(e) => {
        if (!dragged) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        drop()
      }}
      className={cn(
        'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium text-muted-foreground transition-[background,box-shadow] duration-200',
        selected && 'bg-background text-foreground shadow-sm',
        dragged && !over && 'outline outline-dashed outline-(--zone-agents)',
      )}
      style={over ? { background: 'var(--zone-agents-tint)', color: 'var(--zone-agents)', boxShadow: '0 0 0 1px var(--zone-agents), 0 0 16px color-mix(in oklab, var(--zone-agents) 33%, transparent)' } : undefined}
    >
      Agents
      {needsYou && <span aria-label="An agent needs you" className="size-1.5 rounded-full" style={{ background: 'var(--sp-lit)' }} />}
    </button>
  )
}
