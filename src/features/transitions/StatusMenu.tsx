import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { StatusPill } from '@/features/issues/StatusPill'
import type { ApiError, IssueSummary, Transition } from '@/lib/api'
import { STATUS_COLORS, statusKind } from '@/lib/statusKind'
import { useTicketMoves } from './movesContext'
import { transitionsQuery } from './transitions'

/**
 * The status of a ticket as a menu of the statuses it can move to: the keyboard, touch and
 * one-click way to do what dragging onto the workflow graph does.
 */
export function StatusMenu({ issue }: { issue: IssueSummary }) {
  const { move } = useTicketMoves()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const transitions = useQuery<Transition[], ApiError>({ ...transitionsQuery(issue.key), enabled: open })

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

  // Several transitions can lead to the same status: one entry per target
  const targets = [...new Map((transitions.data ?? []).map((t) => [t.to.id, t.to])).values()].filter(
    (to) => to.id !== issue.status.id,
  )

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change status"
        className="inline-flex items-center gap-1 rounded hover:opacity-80"
      >
        <StatusPill status={issue.status} />
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>

      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 min-w-44 rounded-md border bg-popover p-1 shadow-md">
          {transitions.isPending && (
            <div className="flex justify-center p-2">
              <Spinner />
            </div>
          )}
          {transitions.error && <p className="px-2 py-1.5 text-xs text-destructive">{transitions.error.message}</p>}
          {transitions.data && targets.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No other status available</p>
          )}
          {targets.map((to) => (
            <button
              key={to.id}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                move([issue], to)
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-medium uppercase hover:bg-accent"
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLORS[statusKind(to)].dot }} />
              {to.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
