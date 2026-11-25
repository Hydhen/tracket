import { useQueries } from '@tanstack/react-query'
import { SlidersHorizontal, UserMinus, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { describeFields, editMetaQuery, sharedFields, statusGroups } from '@/features/bulk/sharedFields'
import type { IssueSummary, Transition } from '@/lib/api'
import { STATUS_COLORS, statusKind } from '@/lib/statusKind'
import { cn } from '@/lib/utils'
import { transitionsQuery } from './transitions'

type Status = IssueSummary['status']

const GRAPH_W = 560
const NODE_W = 150
const NODE_H = 56
const TARGET_X = GRAPH_W - NODE_W
const MIN_H = 360

// The edit zone's colours: none of the status colours, so it never reads as a status
const EDIT_COLORS = { glow: 'var(--zone-edit)', tint: 'var(--zone-edit-tint)' }
const UNASSIGN_COLORS = { glow: 'var(--zone-unassign)', tint: 'var(--zone-unassign-tint)' }
const ASSIGN_COLORS = { glow: 'var(--zone-assign)', tint: 'var(--zone-assign-tint)' }

/** Vertical centre of each target, spaced 96px apart around the middle (tighter when there are many). */
function layout(count: number) {
  const spacing = count <= 4 ? 96 : Math.max(NODE_H + 8, 288 / (count - 1))
  const height = Math.max(MIN_H, (count - 1) * spacing + NODE_H + 64)
  const centres = Array.from({ length: count }, (_, i) => height / 2 + (i - (count - 1) / 2) * spacing)
  return { height, centre: height / 2, centres }
}

/** Statuses every dragged ticket can reach (a group has to move together), minus where they are. */
function commonTargets(current: Status, lists: Transition[][]): Status[] {
  const [first, ...rest] = lists
  if (!first) return []
  const seen = new Set<string>()
  return first
    .map((t) => t.to)
    .filter((to) => {
      if (to.id === current.id || seen.has(to.id)) return false
      seen.add(to.id)
      return rest.every((list) => list.some((t) => t.to.id === to.id))
    })
}

/**
 * Covers the detail pane while tickets are being dragged. Places to drop them:
 * - the zones on top: one edits their fields (the ones they all share) in a dialog, one opens the choice of who to
 *   assign them to, and one leaves them with nobody;
 * - below it, the workflow graph: the current status on the left, each status they can move to
 *   on the right. Releasing on one moves the tickets there. Tickets in different statuses can't
 *   move together, so they get a message instead of the graph.
 * The overlay itself accepts no drops, so releasing anywhere else cancels.
 */
export function StatusGraphOverlay({
  open,
  issues,
  onDrop,
  onEdit,
  onAssign,
  onUnassign,
}: {
  open: boolean
  issues: IssueSummary[]
  onDrop: (target: Status) => void
  onEdit: () => void
  onAssign: () => void
  onUnassign: () => void
}) {
  const groups = statusGroups(issues)
  const mixed = groups.length > 1
  const queries = useQueries({
    queries: issues.map((i) => ({ ...transitionsQuery(i.key), enabled: open && !mixed })),
  })
  const metaQueries = useQueries({ queries: issues.map((i) => ({ ...editMetaQuery(i.key), enabled: open })) })
  const [hover, setHover] = useState<string | null>(null)
  const [editHover, setEditHover] = useState(false)
  const [unassignHover, setUnassignHover] = useState(false)
  const [assignHover, setAssignHover] = useState(false)
  const [scale, setScale] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)

  // A node still hovered when the drag was cancelled must not look hovered on the next one
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setHover(null)
      setEditHover(false)
      setUnassignHover(false)
      setAssignHover(false)
    }
  }

  // The graph has a fixed design size: shrink it to fit a narrow pane (e.g. side by side)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, (entry.contentRect.width - 48) / GRAPH_W)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const current = issues[0]?.status
  const loading = !mixed && queries.some((q) => q.isPending)
  const error = queries.find((q) => q.error)?.error
  const lists = queries.map((q) => q.data).filter((d): d is Transition[] => !!d)
  const targets = current && !mixed && !loading && lists.length === issues.length ? commonTargets(current, lists) : []
  const { height, centre, centres } = layout(targets.length)

  const metaLoading = metaQueries.some((q) => q.isPending)
  const metaError = metaQueries.find((q) => q.error)?.error
  const editable = metaLoading || metaError ? [] : sharedFields(metaQueries.flatMap((q) => (q.data ? [q.data] : [])))
  const canEdit = editable.length > 0

  const what = issues.length > 1 ? `${issues.length} tickets` : (issues[0]?.key ?? '')
  const title = `Move ${what} to…`
  const canUnassign = issues.length > 0 && issues.every((i) => i.assignee)

  return (
    <div
      ref={containerRef}
      aria-hidden={!open}
      className={cn(
        // Dark whatever the theme: the graph colours are designed for it
        'absolute inset-0 z-20 flex flex-col bg-overlay text-overlay-fg backdrop-blur-[6px] transition-opacity duration-[250ms]',
        open ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      {/* About a fifth of the pane: a target as easy to hit as a status node */}
      <div className="flex h-[26%] min-h-32 shrink-0 gap-3 p-3 pb-0">
        <div
          onDragOver={(e) => {
            if (!canEdit) return
            e.preventDefault() // makes the zone a valid drop target
            e.dataTransfer.dropEffect = 'move'
            setEditHover(true)
          }}
          onDragLeave={() => setEditHover(false)}
          onDrop={(e) => {
            if (!canEdit) return
            e.preventDefault()
            setEditHover(false)
            onEdit()
          }}
          className={cn(
            'box-border flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 text-center transition-[background,border-color,box-shadow,opacity] duration-200',
            !canEdit && !metaLoading && 'opacity-60',
          )}
          style={{
            background: editHover ? EDIT_COLORS.tint : 'transparent',
            borderColor: editHover ? EDIT_COLORS.glow : 'var(--zone-edit-line)',
            boxShadow: editHover ? `0 0 0 1px ${EDIT_COLORS.glow}, 0 0 32px color-mix(in oklab, ${EDIT_COLORS.glow} 26.67%, transparent)` : 'none',
          }}
        >
          {/* No pointer events on the content, or hovering it fires dragleave on the zone */}
          <div className="pointer-events-none flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal className="size-4" style={{ color: EDIT_COLORS.glow }} />
            Edit {what}
          </div>
          <div className="pointer-events-none flex items-center gap-2 text-xs text-overlay-muted">
            {metaLoading ? (
              <>
                <Spinner className="size-3" />
                Checking what can be edited…
              </>
            ) : metaError ? (
              metaError.message
            ) : canEdit ? (
              <span>
                {describeFields(editable)}
                {issues.length > 1 && <span className="text-overlay-dim"> — shared by all of them</span>}
              </span>
            ) : issues.length > 1 ? (
              'No field can be edited on all of these tickets'
            ) : (
              'No field can be edited on this ticket'
            )}
          </div>
        </div>

        {/* The two ways of changing who has the tickets, one above the other */}
        <div className="flex w-[30%] shrink-0 flex-col gap-3">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setAssignHover(true)
            }}
            onDragLeave={() => setAssignHover(false)}
            onDrop={(e) => {
              e.preventDefault()
              setAssignHover(false)
              onAssign()
            }}
            className="box-border flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed px-3 text-center transition-[background,border-color,box-shadow] duration-200"
            style={{
              background: assignHover ? ASSIGN_COLORS.tint : 'transparent',
              borderColor: assignHover ? ASSIGN_COLORS.glow : 'var(--zone-assign-line)',
              boxShadow: assignHover ? `0 0 0 1px ${ASSIGN_COLORS.glow}, 0 0 32px color-mix(in oklab, ${ASSIGN_COLORS.glow} 26.67%, transparent)` : 'none',
            }}
          >
            <div className="pointer-events-none flex items-center gap-2 text-sm font-semibold">
              <UserPlus className="size-4" style={{ color: ASSIGN_COLORS.glow }} />
              Assign to…
            </div>
            <div className="pointer-events-none text-xs text-overlay-muted">Pick who gets {what}</div>
          </div>

          <div
            onDragOver={(e) => {
              if (!canUnassign) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setUnassignHover(true)
            }}
            onDragLeave={() => setUnassignHover(false)}
            onDrop={(e) => {
              if (!canUnassign) return
              e.preventDefault()
              setUnassignHover(false)
              onUnassign()
            }}
            className={cn(
              'box-border flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed px-3 text-center transition-[background,border-color,box-shadow,opacity] duration-200',
              !canUnassign && 'opacity-60',
            )}
            style={{
              background: unassignHover ? UNASSIGN_COLORS.tint : 'transparent',
              borderColor: unassignHover ? UNASSIGN_COLORS.glow : 'var(--zone-unassign-line)',
              boxShadow: unassignHover ? `0 0 0 1px ${UNASSIGN_COLORS.glow}, 0 0 32px color-mix(in oklab, ${UNASSIGN_COLORS.glow} 26.67%, transparent)` : 'none',
            }}
          >
            <div className="pointer-events-none flex items-center gap-2 text-sm font-semibold">
              <UserMinus className="size-4" style={{ color: UNASSIGN_COLORS.glow }} />
              Unassign {what}
            </div>
            <div className="pointer-events-none text-xs text-overlay-muted">
              {canUnassign ? 'Leaves it with nobody' : 'Nobody has this ticket'}
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center overflow-auto px-4 py-6">
        <div className="my-auto flex flex-col items-center">
          {mixed ? (
            <div className="flex max-w-md flex-col items-center text-center">
              <div className="text-xl font-bold tracking-tight">These tickets don't share a status</div>
              <div className="mt-1.5 text-[13px] text-overlay-muted">
                A status change applies to every ticket, so they all have to be in the same one.
              </div>
              <ul className="mt-5 flex flex-wrap justify-center gap-2">
                {groups.map(({ status, count }) => (
                  <li
                    key={status.id}
                    className="flex items-center gap-2 rounded-lg border border-dashed border-overlay-line px-3 py-2 text-sm font-semibold text-overlay-dashed"
                  >
                    <span className="size-2.5 rounded-full" style={{ background: STATUS_COLORS[statusKind(status)].dot }} />
                    {status.name.toUpperCase()}
                    <span className="font-normal text-overlay-muted">×{count}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 text-[13px] text-overlay-muted">
                Pick tickets in one status to move them together. Their shared fields can still be edited above.
              </div>
            </div>
          ) : (
            <>
              <div className="mb-6 text-center">
                <div className="text-xl font-bold tracking-tight">{title}</div>
                <div className="mt-1.5 text-[13px] text-overlay-muted">
                  Now {current?.name.toUpperCase()} · drop on a status
                </div>
              </div>

              <div style={{ width: GRAPH_W * scale, height: (loading || targets.length === 0 ? MIN_H : height) * scale }}>
                <div
                  className="relative"
                  style={{
                    width: GRAPH_W,
                    height: loading || targets.length === 0 ? MIN_H : height,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                  }}
                >
                  {current && (
                    <>
                      <div
                        className="absolute left-0 text-[11px] tracking-[0.08em] text-overlay-muted"
                        style={{ top: centre - NODE_H / 2 - 26 }}
                      >
                        NOW
                      </div>
                      <div
                        className="absolute left-0 box-border flex items-center gap-2.5 rounded-xl border border-dashed border-overlay-line px-4"
                        style={{ top: centre - NODE_H / 2, width: NODE_W, height: NODE_H }}
                      >
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: STATUS_COLORS[statusKind(current)].dot }}
                        />
                        <span className="whitespace-nowrap text-sm font-semibold text-overlay-dashed">
                          {current.name.toUpperCase()}
                        </span>
                      </div>
                    </>
                  )}

                  {loading && (
                    <div className="absolute inset-y-0 right-0 flex items-center" style={{ width: NODE_W }}>
                      <Spinner className="size-5" />
                    </div>
                  )}
                  {!loading && (error || targets.length === 0) && (
                    <p
                      className="absolute flex items-center text-sm text-overlay-muted"
                      style={{ left: 200, right: 0, top: centre - NODE_H / 2, height: NODE_H }}
                    >
                      {error
                        ? error.message
                        : issues.length > 1
                          ? 'No status is reachable from all of these tickets.'
                          : 'No transition is available for you on this ticket.'}
                    </p>
                  )}

                  {targets.map((target, i) => {
                    const colors = STATUS_COLORS[statusKind(target)]
                    const on = hover === target.id
                    const cy = centres[i]
                    return (
                      <svg
                        key={`edge-${target.id}`}
                        width={GRAPH_W}
                        height={height}
                        viewBox={`0 0 ${GRAPH_W} ${height}`}
                        aria-hidden="true"
                        className="pointer-events-none absolute left-0 top-0 overflow-visible"
                      >
                        <path
                          d={`M${NODE_W} ${centre} C 280 ${centre}, 280 ${cy}, ${TARGET_X} ${cy}`}
                          className={cn('fill-none transition-[stroke] duration-200', !on && 'status-edge-flow')}
                          style={{ stroke: on ? colors.glow : 'var(--overlay-line)' }}
                          strokeWidth={on ? 2.5 : 1.5}
                          strokeDasharray={on ? 'none' : '6 6'}
                          strokeLinecap="round"
                        />
                        <circle cx={TARGET_X} cy={cy} r={4} style={{ fill: on ? colors.glow : 'var(--overlay-line)' }} />
                      </svg>
                    )
                  })}

                  {targets.map((target, i) => {
                    const colors = STATUS_COLORS[statusKind(target)]
                    const on = hover === target.id
                    return (
                      <div
                        key={target.id}
                        onDragOver={(e) => {
                          e.preventDefault() // makes the node a valid drop target
                          e.dataTransfer.dropEffect = 'move'
                          setHover(target.id)
                        }}
                        onDragLeave={() => setHover((h) => (h === target.id ? null : h))}
                        onDrop={(e) => {
                          e.preventDefault()
                          setHover(null)
                          onDrop(target)
                        }}
                        className="absolute box-border flex items-center gap-2.5 rounded-xl border px-4 transition-[transform,box-shadow,background,border-color,opacity] duration-[250ms]"
                        style={{
                          left: TARGET_X,
                          top: centres[i] - NODE_H / 2,
                          width: NODE_W,
                          height: NODE_H,
                          background: on ? colors.tint : 'var(--overlay-surface)',
                          borderColor: on ? colors.glow : 'var(--overlay-line-soft)',
                          boxShadow: on ? `0 0 0 1px ${colors.glow}, 0 0 32px color-mix(in oklab, ${colors.glow} 40%, transparent)` : '0 0 0 0 transparent',
                          transform: open ? (on ? 'scale(1.07)' : 'scale(1)') : 'translateX(24px)',
                          opacity: open ? (hover && !on ? 0.5 : 1) : 0,
                        }}
                      >
                        {/* No pointer events on the content, or hovering it fires dragleave on the node */}
                        <span className="pointer-events-none size-2.5 shrink-0 rounded-full" style={{ background: colors.dot }} />
                        <span className="pointer-events-none whitespace-nowrap text-sm font-semibold">
                          {target.name.toUpperCase()}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          <div className="mt-5 text-xs text-overlay-muted">Release anywhere else to cancel</div>
        </div>
      </div>
    </div>
  )
}
