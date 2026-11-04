import { useContext } from 'react'
import { copyText, useCopyPopup } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { TicketActionsContext } from './ticketActions'

/**
 * A ticket id you can act on: click copies it (a "Copied!" popup confirms, the id itself never
 * changes), Ctrl/Cmd+click opens it in the side view (or in the browser when the app can't load it).
 *
 * Rendered as a span so it can sit inside a row that is itself a button; pass `nested` there
 * to keep it out of the tab order (the row stays the keyboard target).
 */
export function TicketKey({
  issueKey,
  nested = false,
  title,
  className,
}: {
  issueKey: string
  nested?: boolean
  title?: string
  className?: string
}) {
  const { openInSide } = useContext(TicketActionsContext)
  const copied = useCopyPopup()

  // `anchor` is read before the copy is awaited: React clears `currentTarget` once the handler returns
  const activate = async (open: boolean, anchor: Element) => {
    if (open) return openInSide(issueKey)
    if (await copyText(issueKey)) copied.show(anchor)
  }

  return (
    <>
      <span
        role="button"
        tabIndex={nested ? -1 : 0}
        title={title ?? 'Click to copy · Ctrl+click to open in the side view'}
        onClick={(e) => {
          // Don't also trigger the row this label sits in
          e.stopPropagation()
          void activate(e.ctrlKey || e.metaKey, e.currentTarget)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          e.stopPropagation()
          void activate(e.ctrlKey || e.metaKey, e.currentTarget)
        }}
        className={cn(
          'cursor-pointer rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring',
          className,
        )}
      >
        {issueKey}
      </span>
      {copied.popup}
    </>
  )
}
