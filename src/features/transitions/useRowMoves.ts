import type { MouseEvent } from 'react'
import type { IssueSummary } from '@/lib/api'
import { useTicketMoves } from './movesContext'

/**
 * What a ticket row needs to take part in moving tickets: draggable props, how it should look
 * (picked, being dragged, just moved), and the click rules shared by every list.
 */
export function useRowMoves(issue: IssueSummary) {
  const moves = useTicketMoves()

  return {
    dragProps: {
      draggable: true,
      onDragStart: (e: React.DragEvent) => moves.startDrag(issue, e),
      onDragEnd: moves.endDrag,
    },
    marked: moves.marked.has(issue.key),
    dragging: moves.dragging.has(issue.key),
    flash: moves.flash.has(issue.key),
    /**
     * Ctrl/Cmd+click picks tickets to move together and Alt+click opens the side view. Returns
     * true when the click was one of those, so the caller doesn't also select the ticket.
     */
    handleModifierClick: (e: MouseEvent, openSide: () => void) => {
      if (e.ctrlKey || e.metaKey) {
        moves.toggleMark(issue)
        return true
      }
      if (e.altKey) {
        openSide()
        return true
      }
      moves.clearMarks()
      return false
    },
  }
}
