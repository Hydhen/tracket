import { createContext, useContext, type DragEvent } from 'react'
import type { IssueSummary } from '@/lib/api'

type Status = IssueSummary['status']

/** What ticket rows and the status menu need to select, drag and move tickets. */
export interface TicketMoves {
  /** Keys of the tickets picked with Ctrl/Cmd+click, to be moved together */
  marked: ReadonlySet<string>
  /** Keys of the tickets being dragged right now */
  dragging: ReadonlySet<string>
  /** Keys of the tickets that just changed status */
  flash: ReadonlySet<string>
  /** Ctrl/Cmd+click: adds or removes a ticket from the group (same status as the first only) */
  toggleMark: (issue: IssueSummary) => void
  clearMarks: () => void
  startDrag: (issue: IssueSummary, e: DragEvent) => void
  endDrag: () => void
  /** Moves tickets to a status: checks, applies it, then offers to undo */
  move: (issues: IssueSummary[], target: Status) => void
}

const empty: ReadonlySet<string> = new Set()

export const TicketMovesContext = createContext<TicketMoves>({
  marked: empty,
  dragging: empty,
  flash: empty,
  toggleMark: () => {},
  clearMarks: () => {},
  startDrag: () => {},
  endDrag: () => {},
  move: () => {},
})

export const useTicketMoves = () => useContext(TicketMovesContext)
