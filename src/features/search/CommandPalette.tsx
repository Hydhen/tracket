import { Search } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Spinner } from '@/components/Spinner'
import { Icon } from '@/features/issues/IssueList'
import { StatusPill } from '@/features/issues/StatusPill'
import type { IssueSummary } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ISSUE_TYPES, type IssueType } from './searchJql'
import { useIssueSearch } from './useIssueSearch'

const SUGGESTION_COUNT = 8

/**
 * Ctrl+K palette. Empty input suggests my own tickets; typing searches the whole site.
 * Enter opens the ticket, Ctrl/Shift+Enter opens it in the side view.
 */
export function CommandPalette({
  mode = 'open',
  myIssues,
  keyPrefix,
  onPick,
  onClose,
}: {
  /** "tree" picks a root for the tree view: no side view, Enter adds it */
  mode?: 'open' | 'tree'
  myIssues: IssueSummary[]
  /** Project key assumed when only digits are typed */
  keyPrefix: string | undefined
  onPick: (issue: IssueSummary, options: { side: boolean }) => void
  onClose: () => void
}) {
  const treeMode = mode === 'tree'
  const [input, setInput] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const [issueType, setIssueType] = useState<IssueType | null>(null)
  const search = useIssueSearch(input, keyPrefix, issueType)

  const isEmpty = input.trim() === ''
  // Nothing typed and no type picked: suggest from the list already loaded, no request needed
  const showMine = isEmpty && !issueType
  const items = showMine ? myIssues.slice(0, SUGGESTION_COUNT) : search.results
  const active = Math.min(activeIndex, items.length - 1)

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, items])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (items.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((active + step + items.length) % items.length)
    } else if (e.key === 'Enter' && items[active]) {
      e.preventDefault()
      onPick(items[active], { side: !treeMode && (e.ctrlKey || e.metaKey || e.shiftKey) })
    }
  }

  let status: string | null = null
  if (showMine) status = items.length === 0 ? 'Type to search tickets' : null
  else if (!search.searchable) status = 'Type a few letters or a ticket key'
  else if (search.error) status = search.error.message
  else if (!search.isLoading && items.length === 0) status = 'No tickets found'

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search tickets"
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setActiveIndex(0)
            }}
            placeholder={treeMode ? 'Find a ticket to add to the tree…' : 'Search tickets by key or text…'}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {search.isLoading && !showMine && <Spinner />}
        </div>

        <div role="group" aria-label="Ticket type" className="flex gap-1 border-b px-4 py-2">
          {[null, ...ISSUE_TYPES].map((type) => (
            <button
              key={type ?? 'all'}
              aria-pressed={issueType === type}
              // Keep the focus in the search field so typing carries on
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setIssueType(type)
                setActiveIndex(0)
              }}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium',
                issueType === type ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {type ?? 'All'}
            </button>
          ))}
        </div>

        {isEmpty && items.length > 0 && (
          <div className="px-4 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Assigned to me
          </div>
        )}

        <ul id="palette-results" ref={listRef} role="listbox" className="overflow-auto py-1">
          {items.map((issue, index) => (
            <li
              key={issue.id}
              role="option"
              aria-selected={index === active}
              onMouseMove={() => setActiveIndex(index)}
              onClick={(e) => onPick(issue, { side: !treeMode && (e.ctrlKey || e.metaKey || e.shiftKey) })}
              className={cn('flex cursor-pointer items-center gap-2 px-4 py-2', index === active && 'bg-accent')}
            >
              <Icon url={issue.issueType.iconUrl} />
              <span className="shrink-0 text-xs font-medium text-muted-foreground">{issue.key}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{issue.summary}</span>
              <StatusPill status={issue.status} />
            </li>
          ))}
        </ul>

        {status && <div className="px-4 py-6 text-center text-sm text-muted-foreground">{status}</div>}

        <div className="flex gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
          <span>↑↓ navigate</span>
          <span>{treeMode ? 'Enter add to tree' : 'Enter open'}</span>
          {!treeMode && <span>Ctrl+Enter side view</span>}
          <span className="ml-auto">Esc close</span>
        </div>
      </div>
    </div>
  )
}
