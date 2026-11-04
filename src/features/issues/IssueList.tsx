import { Columns2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDay, isOverdue, timeAgo } from '@/lib/dates'
import type { IssueSummary } from '@/lib/api'
import { StatusPill } from './StatusPill'
import { TimerDot } from '@/features/timer/RecordingDot'
import { useRowMoves } from '@/features/transitions/useRowMoves'
import { TicketKey } from './TicketKey'

const isReview = (i: IssueSummary) => i.status.category !== 'done' && /review|revue/i.test(i.status.name)

// Each issue lands in the first group that matches
const GROUPS: { id: string; label: string; match: (i: IssueSummary) => boolean }[] = [
  { id: 'progress', label: 'In progress', match: (i) => i.status.category === 'indeterminate' && !isReview(i) },
  { id: 'review', label: 'In review', match: isReview },
  { id: 'todo', label: 'To do', match: (i) => i.status.category === 'new' && !isReview(i) },
  { id: 'done', label: 'Done', match: (i) => i.status.category === 'done' },
]

export function Icon({ url }: { url: string | null | undefined }) {
  if (!url) return null
  return (
    <img
      src={url}
      alt=""
      className="size-4 shrink-0"
      onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
    />
  )
}

function IssueRow({
  issue: i,
  selected,
  inSide,
  onSelect,
  onOpenSide,
}: {
  issue: IssueSummary
  selected: boolean
  inSide: boolean
  onSelect: (key: string) => void
  onOpenSide: (key: string) => void
}) {
  const row = useRowMoves(i)

  return (
    <li className={cn('group relative select-none', row.dragging && 'opacity-45')} {...row.dragProps}>
      <button
        // Ctrl/Cmd+click picks several tickets to move together, Alt+click opens the side view
        onClick={(e) => row.handleModifierClick(e, () => onOpenSide(i.key)) || onSelect(i.key)}
        className={cn(
          'w-full border-b border-l-2 border-l-transparent px-4 py-2.5 text-left hover:bg-accent',
          selected && 'bg-accent',
          inSide && 'border-l-primary bg-accent/60',
          row.marked && 'bg-primary/10 ring-1 ring-inset ring-primary/40',
          row.flash && 'row-flash',
        )}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon url={i.issueType.iconUrl} />
          <TicketKey issueKey={i.key} nested className="font-medium" />
          <TimerDot issueKey={i.key} />
          <span className="ml-auto">{timeAgo(i.updated)}</span>
        </div>
        <div className="mt-0.5 truncate text-sm">{i.summary}</div>
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          <StatusPill status={i.status} />
          {i.priority && (
            <span title={i.priority.name}>
              <Icon url={i.priority.iconUrl} />
            </span>
          )}
          {i.dueDate && (
            <span
              className={cn('ml-auto', isOverdue(i.dueDate) ? 'font-medium text-destructive' : 'text-muted-foreground')}
            >
              Due {formatDay(i.dueDate)}
            </span>
          )}
        </div>
      </button>
      {!selected && !inSide && (
        <button
          onClick={() => onOpenSide(i.key)}
          title="Open in side view (Alt+click)"
          aria-label={`Open ${i.key} in side view`}
          className="absolute right-2 top-1.5 hidden rounded border bg-background p-1 text-muted-foreground hover:text-foreground focus-visible:block group-hover:block"
        >
          <Columns2 className="size-3.5" />
        </button>
      )}
    </li>
  )
}


export function IssueList({
  issues,
  selectedKey,
  sideKey,
  onSelect,
  onOpenSide,
}: {
  issues: IssueSummary[]
  selectedKey: string | undefined
  /** Issue currently open in the side view */
  sideKey: string | undefined
  onSelect: (key: string) => void
  onOpenSide: (key: string) => void
}) {
  return (
    <div className="flex-1 overflow-auto">
      {GROUPS.map(({ id, label, match }) => {
        const items = issues.filter(match)
        if (items.length === 0) return null
        return (
          <section key={id}>
            <h2 className="sticky top-0 border-b bg-background/95 px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
              {label} · {items.length}
            </h2>
            <ul>
              {items.map((i) => (
                <IssueRow
                  key={i.id}
                  issue={i}
                  selected={i.key === selectedKey}
                  inSide={i.key === sideKey}
                  onSelect={onSelect}
                  onOpenSide={onOpenSide}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
