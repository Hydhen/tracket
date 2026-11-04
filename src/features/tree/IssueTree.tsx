import { ChevronDown, Columns2, X } from 'lucide-react'
import type { CSSProperties, MouseEvent } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Icon } from '@/features/issues/IssueList'
import { StatusPill } from '@/features/issues/StatusPill'
import { TicketKey } from '@/features/issues/TicketKey'
import { TimerDot } from '@/features/timer/RecordingDot'
import { useRowMoves } from '@/features/transitions/useRowMoves'
import type { IssueSummary } from '@/lib/api'
import { cn } from '@/lib/utils'
import { summarizeChildren } from './progress'
import { useChildren, useGrandchildren } from './useTree'

interface TreeContext {
  expanded: Set<string>
  selectedKey: string | undefined
  sideKey: string | undefined
  onToggle: (key: string) => void
  onSelect: (issue: IssueSummary) => void
  onOpenSide: (issue: IssueSummary) => void
}

const INDENT_PX = 16
/** Left inset of the progress bar and its summary, before the per-depth indent */
const BAR_INSET_PX = 46

function TreeNode({
  issue,
  depth,
  ctx,
  onRemove,
}: {
  issue: IssueSummary
  depth: number
  ctx: TreeContext
  /** Only roots can be removed from the tree */
  onRemove?: () => void
}) {
  const isRoot = depth === 0
  const open = ctx.expanded.has(issue.key)
  // Roots load their children even when closed, to know whether they get a caret at all.
  // Deeper nodes get theirs from their parent's level-below query (see useGrandchildren).
  const children = useChildren(issue.key, issue.canHaveChildren && (open || isRoot))
  useGrandchildren(issue.key, children.data, open || isRoot)
  const childIssues = children.data?.issues ?? []
  // Unknown (not loaded yet) counts as "may have children"
  const hasChildren = issue.canHaveChildren && children.data?.issues.length !== 0
  // A truncated page would give wrong counts, so no progress then
  const progress = children.data && !children.data.hasMore ? summarizeChildren(childIssues) : null
  const canOpenSide = issue.key !== ctx.selectedKey && issue.key !== ctx.sideKey
  const hasActions = canOpenSide || !!onRemove

  // Runs for a click anywhere on the row, bar and summary included (the inner buttons handle their own clicks and stop here)
  const row = useRowMoves(issue)
  const onRowClick = (e: MouseEvent) => {
    // Ctrl/Cmd+click picks several tickets to move together, Alt+click opens the side view
    if (row.handleModifierClick(e, () => ctx.onOpenSide(issue))) return
    ctx.onSelect(issue)
    // Selecting a parent reveals its children; it never folds them
    if (hasChildren && !open) ctx.onToggle(issue.key)
  }

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={issue.key === ctx.selectedKey}>
      <div onClick={onRowClick} className="tree-head cursor-pointer border-b" data-open={open} data-progress={progress !== null}>
        <div
          {...row.dragProps}
          className={cn(
            'group relative flex select-none items-center gap-1 border-l-2 border-l-transparent py-1.5 pr-2 hover:bg-accent',
            issue.key === ctx.selectedKey && 'bg-accent',
            issue.key === ctx.sideKey && 'border-l-primary bg-accent/60',
            row.marked && 'bg-primary/10 ring-1 ring-inset ring-primary/40',
            row.dragging && 'opacity-45',
            row.flash && 'row-flash',
          )}
          style={{ paddingLeft: 8 + depth * INDENT_PX }}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                ctx.onToggle(issue.key)
              }}
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${issue.key}`}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
            >
              {open && children.isFetching && !children.data ? (
                <Spinner />
              ) : (
                <ChevronDown className="tree-chevron size-4" data-open={open} />
              )}
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}

          {/* The click itself is handled by the row; this button is the keyboard focus target */}
          <button className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <Icon url={issue.issueType.iconUrl} />
            <TicketKey issueKey={issue.key} nested className="shrink-0 text-xs font-medium text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">{issue.summary}</span>
            <TimerDot issueKey={issue.key} />
          </button>

          {progress && (
            <span className="tree-pct shrink-0 text-xs text-muted-foreground" data-open={open} aria-hidden="true">
              {progress.percent}%
            </span>
          )}

          {/* Hidden only while the action buttons are shown over it (hover, or keyboard focus) */}
          <span
            className={cn('shrink-0', hasActions && 'group-hover:invisible group-has-[:focus-visible]:invisible')}
          >
            <StatusPill status={issue.status} />
          </span>

          {/* Not rendered when there's nothing to offer (e.g. the selected, non-root row): no empty box */}
          {hasActions && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-1 top-1/2 hidden -translate-y-1/2 gap-0.5 rounded border bg-background p-0.5 group-hover:flex group-has-[:focus-visible]:flex"
            >
              {canOpenSide && (
                <button
                  onClick={() => ctx.onOpenSide(issue)}
                  title="Open in side view (Alt+click)"
                  aria-label={`Open ${issue.key} in side view`}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <Columns2 className="size-3.5" />
                </button>
              )}
              {onRemove && (
                <button
                  onClick={onRemove}
                  title="Remove from tree"
                  aria-label={`Remove ${issue.key} from tree`}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {progress && (
          <>
            <div
              role="img"
              aria-label={progress.aria}
              className="tree-bar"
              data-open={open}
              style={{ '--bar-inset': `${BAR_INSET_PX + depth * INDENT_PX}px` } as CSSProperties}
            >
              {progress.segments.map((s) => (
                <div key={s.id} className={s.className} style={{ flex: s.count }} />
              ))}
            </div>
            <div className="tree-summary" data-open={open} aria-hidden="true">
              <div className="min-h-0 overflow-hidden">
                <div
                  className="mr-3.5 mt-2 text-xs text-muted-foreground"
                  style={{ marginLeft: BAR_INSET_PX + depth * INDENT_PX }}
                >
                  {progress.label}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Stays mounted while folded so the fold can animate; hidden from the tab order by the CSS */}
      {hasChildren && (children.data || children.error) && (
        <div className="tree-list" data-open={open}>
          <div>
            <ul role="group">
              {childIssues.map((child) => (
                <TreeNode key={child.id} issue={child} depth={depth + 1} ctx={ctx} />
              ))}
              {children.error && (
                <li
                  className="border-b py-1.5 pr-2 text-xs text-destructive"
                  style={{ paddingLeft: 8 + (depth + 1) * INDENT_PX + 24 }}
                >
                  {children.error.message}
                </li>
              )}
              {children.data?.hasMore && (
                <li
                  className="border-b py-1.5 pr-2 text-xs text-muted-foreground"
                  style={{ paddingLeft: 8 + (depth + 1) * INDENT_PX + 24 }}
                >
                  Showing the first {childIssues.length} children
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </li>
  )
}

/** Issues you picked as roots, each openable like a folder to reveal its children. */
export function IssueTree({
  roots,
  rootIssues,
  loading,
  onRemoveRoot,
  onAdd,
  ...ctx
}: TreeContext & {
  /** Root keys in the order the user added them */
  roots: string[]
  /** Fetched root issues, in any order */
  rootIssues: IssueSummary[]
  loading: boolean
  onRemoveRoot: (key: string) => void
  onAdd: () => void
}) {
  if (roots.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <p>Pick an epic or any ticket to browse it and its children like a folder tree.</p>
        <Button variant="outline" size="sm" onClick={onAdd}>
          Add a ticket
        </Button>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto">
      <ul role="tree">
        {roots.map((key) => {
          const issue = rootIssues.find((i) => i.key === key)
          if (issue) return <TreeNode key={key} issue={issue} depth={0} ctx={ctx} onRemove={() => onRemoveRoot(key)} />
          // Still loading, or Jira doesn't give it back (deleted, no access)
          return (
            <li key={key} className="flex items-center gap-2 border-b py-2.5 pl-9 pr-2 text-sm text-muted-foreground">
              <span className="text-xs font-medium">{key}</span>
              {loading ? <Spinner /> : <span className="flex-1 text-xs">Unavailable</span>}
              <button
                onClick={() => onRemoveRoot(key)}
                aria-label={`Remove ${key} from tree`}
                className="ml-auto rounded p-1 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
