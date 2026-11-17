import { createContext, useContext, type DragEvent } from 'react'
import type { IssueSummary } from '@/lib/api'
import type { DragSource } from './useMovesController'

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
  /** `source` is the board when the ticket is being handed out rather than moved or edited */
  startDrag: (issue: IssueSummary, e: DragEvent, source?: DragSource) => void
  endDrag: () => void
  /** Assigns the ticket (or the whole group it is picked in) to the user, asking first when someone else has it */
  assign: (issue: IssueSummary) => void
  /** Moves tickets to a status: checks, applies it, then offers to undo */
  move: (issues: IssueSummary[], target: Status) => void
  /** Opens the dialog that edits the fields of the tickets */
  edit: (issues: IssueSummary[]) => void
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
  assign: () => {},
  move: () => {},
  edit: () => {},
})

export const useTicketMoves = () => useContext(TicketMovesContext)
