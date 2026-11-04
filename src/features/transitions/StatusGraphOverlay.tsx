import { useQueries } from '@tanstack/react-query'
import { SlidersHorizontal } from 'lucide-react'
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
const EDIT_COLORS = { glow: '#c4b5fd', tint: '#1d1a36' }

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
 * Covers the detail pane while tickets are being dragged. Two places to drop them:
 * - the zone on top edits their fields (the ones they all share) in a dialog;
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
}: {
  open: boolean
  issues: IssueSummary[]
  onDrop: (target: Status) => void
  onEdit: () => void
}) {
  const groups = statusGroups(issues)
  const mixed = groups.length > 1
  const queries = useQueries({
    queries: issues.map((i) => ({ ...transitionsQuery(i.key), enabled: open && !mixed })),
  })
  const metaQueries = useQueries({ queries: issues.map((i) => ({ ...editMetaQuery(i.key), enabled: open })) })
  const [hover, setHover] = useState<string | null>(null)
  const [editHover, setEditHover] = useState(false)
  const [scale, setScale] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)

  // A node still hovered when the drag was cancelled must not look hovered on the next one
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setHover(null)
      setEditHover(false)
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

  return (
    <div
      ref={containerRef}
      aria-hidden={!open}
      className={cn(
        // Dark whatever the theme: the graph colours are designed for it
        'absolute inset-0 z-20 flex flex-col bg-[rgba(10,10,11,0.92)] text-[#f4f4f5] backdrop-blur-[6px] transition-opacity duration-[250ms]',
        open ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      {/* About a fifth of the pane: a target as easy to hit as a status node */}
      <div className="h-[20%] min-h-24 shrink-0 p-3 pb-0">
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
            'box-border flex h-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 text-center transition-[background,border-color,box-shadow,opacity] duration-200',
            !canEdit && !metaLoading && 'opacity-60',
          )}
          style={{
            background: editHover ? EDIT_COLORS.tint : 'transparent',
            borderColor: editHover ? EDIT_COLORS.glow : '#4b4570',
            boxShadow: editHover ? `0 0 0 1px ${EDIT_COLORS.glow}, 0 0 32px ${EDIT_COLORS.glow}44` : 'none',
          }}
        >
          {/* No pointer events on the content, or hovering it fires dragleave on the zone */}
          <div className="pointer-events-none flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal className="size-4" style={{ color: EDIT_COLORS.glow }} />
            Edit {what}
          </div>
          <div className="pointer-events-none flex items-center gap-2 text-xs text-[#a0a0a8]">
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
                {issues.length > 1 && <span className="text-[#6f6f78]"> — shared by all of them</span>}
              </span>
            ) : issues.length > 1 ? (
              'No field can be edited on all of these tickets'
            ) : (
              'No field can be edited on this ticket'
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center overflow-auto px-4 py-6">
        <div className="my-auto flex flex-col items-center">
          {mixed ? (
            <div className="flex max-w-md flex-col items-center text-center">
              <div className="text-xl font-bold tracking-tight">These tickets don't share a status</div>
              <div className="mt-1.5 text-[13px] text-[#a0a0a8]">
                A status change applies to every ticket, so they all have to be in the same one.
              </div>
              <ul className="mt-5 flex flex-wrap justify-center gap-2">
                {groups.map(({ status, count }) => (
                  <li
                    key={status.id}
                    className="flex items-center gap-2 rounded-lg border border-dashed border-[#3a3a3f] px-3 py-2 text-sm font-semibold text-[#d4d4d8]"
                  >
                    <span className="size-2.5 rounded-full" style={{ background: STATUS_COLORS[statusKind(status)].dot }} />
                    {status.name.toUpperCase()}
                    <span className="font-normal text-[#a0a0a8]">×{count}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 text-[13px] text-[#a0a0a8]">
                Pick tickets in one status to move them together. Their shared fields can still be edited above.
              </div>
            </div>
          ) : (
            <>
              <div className="mb-6 text-center">
                <div className="text-xl font-bold tracking-tight">{title}</div>
                <div className="mt-1.5 text-[13px] text-[#a0a0a8]">
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
                        className="absolute left-0 text-[11px] tracking-[0.08em] text-[#a0a0a8]"
                        style={{ top: centre - NODE_H / 2 - 26 }}
                      >
                        NOW
                      </div>
                      <div
                        className="absolute left-0 box-border flex items-center gap-2.5 rounded-xl border border-dashed border-[#3a3a3f] px-4"
                        style={{ top: centre - NODE_H / 2, width: NODE_W, height: NODE_H }}
                      >
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: STATUS_COLORS[statusKind(current)].dot }}
                        />
                        <span className="whitespace-nowrap text-sm font-semibold text-[#d4d4d8]">
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
                      className="absolute flex items-center text-sm text-[#a0a0a8]"
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
                          stroke={on ? colors.glow : '#3a3a3f'}
                          strokeWidth={on ? 2.5 : 1.5}
                          strokeDasharray={on ? 'none' : '6 6'}
                          strokeLinecap="round"
                        />
                        <circle cx={TARGET_X} cy={cy} r={4} fill={on ? colors.glow : '#3a3a3f'} />
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
                          background: on ? colors.tint : '#17171a',
                          borderColor: on ? colors.glow : '#2e2e32',
                          boxShadow: on ? `0 0 0 1px ${colors.glow}, 0 0 32px ${colors.glow}66` : '0 0 0 0 transparent',
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

          <div className="mt-5 text-xs text-[#a0a0a8]">Release anywhere else to cancel</div>
        </div>
      </div>
    </div>
  )
}
