import { Plus, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusPill } from '@/features/issues/StatusPill'
import { cn } from '@/lib/utils'
import {
  fieldLabel,
  isBuiltin,
  jiraFieldId,
  useTicketFields,
  type BuiltinFieldId,
  type TicketFieldId,
} from './ticketFields'
import { useJiraFields } from './useJiraFields'

// Stand-in values, shaped like the real ones on a ticket
const SAMPLE: Record<BuiltinFieldId, ReactNode> = {
  status: <StatusPill status={{ id: 'sample', name: 'In progress', category: 'indeterminate' }} />,
  priority: 'Medium',
  due: '12 Mar',
  assignee: <Person name="Jane Doe" />,
  reporter: <Person name="John Smith" />,
  updated: '2 hours ago',
  labels: (
    <span className="flex flex-wrap gap-1">
      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">backend</span>
    </span>
  ),
  project: 'ABC',
  created: '3 days ago',
}

function Person({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-5 rounded-full bg-muted" />
      <span className="truncate">{name}</span>
    </span>
  )
}

const within = (el: Element | null, x: number, y: number) => {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

/**
 * Ticket details settings. The grid is a live preview of what a ticket shows: drag a tile to
 * reorder it, drop it on "Hidden" (or press its ×) to hide it, drag a hidden field back in to show it.
 */
export function TicketDetailsSettings() {
  const { fields, setVisible, show, addJira, moveTo, reset } = useTicketFields()
  const jira = useJiraFields()
  const [jiraSearch, setJiraSearch] = useState('')
  const gridRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const [draggingId, setDraggingId] = useState<TicketFieldId | null>(null)
  // Set by keyboard moves: the tile re-renders in a new spot, and focus must follow it
  const refocusId = useRef<TicketFieldId | null>(null)
  // Where the current drag started, and whether it went anywhere: a press that never moved is a click
  const dragStart = useRef({ x: 0, y: 0 })
  const dragMoved = useRef(false)

  const visible = fields.filter((f) => f.visible)
  const hidden = fields.filter((f) => !f.visible)

  // While dragging, the field follows the pointer: over the grid it takes the place of the
  // nearest tile, over the tray it gets hidden. Listening on the window (not the tile)
  // survives the tile being re-mounted as the others shift around it.
  useEffect(() => {
    if (!draggingId) return

    const onMove = (e: globalThis.PointerEvent) => {
      if (Math.hypot(e.clientX - dragStart.current.x, e.clientY - dragStart.current.y) > 4) dragMoved.current = true
      const state = useTicketFields.getState()
      const dragged = state.fields.find((f) => f.id === draggingId)
      if (!dragged) return

      if (within(trayRef.current, e.clientX, e.clientY)) {
        if (dragged.visible) state.setVisible(draggingId, false)
        return
      }
      if (!within(gridRef.current, e.clientX, e.clientY)) return
      if (!dragged.visible) state.setVisible(draggingId, true)

      // The tile under the pointer, or the closest one when it is between tiles
      const tiles = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-tile]') ?? [])
      let target: HTMLElement | undefined
      let best = Infinity
      for (const tile of tiles) {
        const r = tile.getBoundingClientRect()
        const distance = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2))
        if (within(tile, e.clientX, e.clientY)) {
          target = tile
          break
        }
        if (distance < best) {
          best = distance
          target = tile
        }
      }
      const to = state.fields.findIndex((f) => f.id === target?.dataset.tile)
      if (to >= 0) state.moveTo(draggingId, to)
    }
    const stop = () => setDraggingId(null)

    document.body.style.cursor = 'grabbing'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [draggingId])

  useEffect(() => {
    if (!refocusId.current) return
    gridRef.current?.querySelector<HTMLElement>(`[data-handle="${refocusId.current}"]`)?.focus()
    refocusId.current = null
  }, [fields])

  const startDrag = (e: PointerEvent, id: TicketFieldId) => {
    if (e.button !== 0) return
    e.preventDefault() // no text selection while dragging
    dragStart.current = { x: e.clientX, y: e.clientY }
    dragMoved.current = false
    setDraggingId(id)
  }

  // Arrows move a tile past its neighbour, Delete hides it
  const onTileKeyDown = (e: KeyboardEvent, id: TicketFieldId) => {
    const at = visible.findIndex((f) => f.id === id)
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      setVisible(id, false)
      return
    }
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0
    const neighbour = visible[at + step]
    if (!step || !neighbour) return
    e.preventDefault()
    refocusId.current = id
    moveTo(
      id,
      fields.findIndex((f) => f.id === neighbour.id),
    )
  }

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ticket details</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        This is how a ticket looks. Drag a field to move it, or drop it on Hidden to remove it.
      </p>

      {/* Preview of a ticket's header, with the real grid layout */}
      <div className={cn('mt-3 rounded-md border p-4', draggingId && 'select-none')}>
        <div className="text-sm text-muted-foreground">ABC-123 · Story</div>
        <div className="mt-1 text-xl font-semibold">Ticket title</div>

        <div ref={gridRef} className="mt-6 grid min-h-16 grid-cols-3 content-start gap-x-6 gap-y-4">
          {visible.length === 0 && (
            <p className="col-span-3 self-center text-center text-sm text-muted-foreground">
              No fields shown. Drag one here.
            </p>
          )}
          {visible.map((field) => (
            <div
              key={field.id}
              data-tile={field.id}
              className={cn(
                'group relative -m-1.5 min-w-0 rounded-md p-1.5 outline-1 outline-transparent outline-dashed hover:outline-border',
                field.id === draggingId && 'z-10 bg-accent shadow-md outline-ring',
              )}
            >
              <div className="truncate text-xs text-muted-foreground">{fieldLabel(field)}</div>
              <div className="mt-0.5 text-sm">
                {isBuiltin(field.id) ? SAMPLE[field.id] : <span className="text-muted-foreground">From Jira</span>}
              </div>
              {/* Covers the tile: the drag handle and keyboard target */}
              <button
                type="button"
                data-handle={field.id}
                aria-label={`${fieldLabel(field)}: drag to reorder, arrow keys to move, Delete to hide`}
                onPointerDown={(e) => startDrag(e, field.id)}
                onKeyDown={(e) => onTileKeyDown(e, field.id)}
                className={cn(
                  'absolute inset-0 touch-none rounded-md focus-visible:outline-2 focus-visible:outline-ring',
                  draggingId ? 'cursor-grabbing' : 'cursor-grab',
                )}
              />
              <button
                type="button"
                aria-label={`Hide ${fieldLabel(field)}`}
                title="Hide"
                onClick={() => setVisible(field.id, false)}
                className="absolute right-1 top-1 z-10 hidden rounded-full border bg-background p-0.5 text-muted-foreground hover:text-foreground group-hover:block focus-visible:block"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div
        ref={trayRef}
        className={cn(
          'mt-3 flex min-h-12 flex-wrap items-center gap-2 rounded-md border border-dashed p-2',
          draggingId && 'border-ring',
        )}
      >
        <span className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Hidden</span>
        {hidden.length === 0 && <span className="text-sm text-muted-foreground">Drop a field here to hide it.</span>}
        {hidden.map((field) => (
          <button
            key={field.id}
            type="button"
            title="Click to show, or drag it into the ticket"
            onPointerDown={(e) => startDrag(e, field.id)}
            // A drag that ends back on the chip also fires a click: only a plain press counts
            onClick={() => !dragMoved.current && show(field.id)}
            className={cn(
              'flex items-center gap-1 rounded-full border bg-muted px-2.5 py-1 text-xs touch-none hover:bg-accent',
              draggingId ? 'cursor-grabbing' : 'cursor-grab',
            )}
          >
            <Plus className="size-3" />
            {fieldLabel(field)}
          </button>
        ))}
      </div>

      {/* Every field of the user's Jira, custom ones included: asked from Jira, not listed here */}
      <div className="mt-3 rounded-md border border-dashed p-2">
        <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          More fields from your Jira
        </div>
        {jira.loading ? (
          <div className="mt-2 flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Reading the fields of your tickets…
          </div>
        ) : jira.fields.length === 0 ? (
          <p className="mt-2 px-1 text-sm text-muted-foreground">
            {jira.noTickets
              ? 'No open ticket to read the available fields from.'
              : "Couldn't read the fields of your tickets."}
          </p>
        ) : (
          <>
            {jira.fields.length > 8 && (
              <Input
                value={jiraSearch}
                onChange={(e) => setJiraSearch(e.target.value)}
                placeholder={`Find among ${jira.fields.length} fields…`}
                className="mt-2"
              />
            )}
            <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-auto">
              {jira.fields
                .filter(
                  (f) =>
                    !fields.some((s) => s.id === jiraFieldId(f.key)) &&
                    f.name.toLowerCase().includes(jiraSearch.trim().toLowerCase()),
                )
                .map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => addJira(f.key, f.name)}
                    className="rounded-full border bg-muted px-2.5 py-1 text-xs hover:bg-accent"
                  >
                    + {f.name}
                  </button>
                ))}
            </div>
          </>
        )}
      </div>

      <Button variant="ghost" size="sm" className="mt-3" onClick={reset}>
        Reset to default
      </Button>
    </div>
  )
}
