import { ChevronDown, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { matching, type SourceOption } from './sources'

/**
 * Picks a board or project from a long list: type to narrow it down, arrows and Enter to choose.
 * The options come sorted by project, and are shown under their project's name.
 */
export function SourcePicker({
  options,
  value,
  fallbackLabel,
  onChange,
}: {
  options: SourceOption[]
  value: string
  /** What to call the current choice when it isn't in the list (yet) */
  fallbackLabel: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const shown = matching(options, query)
  const current = options.find((o) => o.value === value)

  // The options come sorted by project: consecutive ones of a project make a group. `index` is the
  // option's place in the whole list, which the arrow keys move through.
  const groups: { project: string; options: { option: SourceOption; index: number }[] }[] = []
  shown.forEach((option, index) => {
    const last = groups[groups.length - 1]
    if (last && last.project === option.project) last.options.push({ option, index })
    else groups.push({ project: option.project, options: [{ option, index }] })
  })

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Keep the highlighted option in view while moving with the arrows
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (option: SourceOption | undefined) => {
    if (option) onChange(option.value)
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(shown[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // Only closes the list: the window's own Escape handling has nothing to do with it
      e.stopPropagation()
      close()
    }
  }

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Board or project"
        onClick={() => {
          setActive(Math.max(0, options.findIndex((o) => o.value === value)))
          setOpen((v) => !v)
        }}
        className="flex h-7 max-w-64 items-center gap-1.5 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="truncate">
          {current ? (
            <>
              <span className="font-medium">{current.project}</span>
              <span className="text-muted-foreground"> · {current.label}</span>
            </>
          ) : (
            fallbackLabel
          )}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-80 max-w-[80vw] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg">
          <label className="flex items-center gap-2 border-b px-2.5 py-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Search a project or a board…"
              aria-label="Search a project or a board"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          {/* No padding at the top: a project's name sticks to the very edge of the scroll area */}
          <ul ref={listRef} role="listbox" className="max-h-72 overflow-y-auto pb-1">
            {shown.length === 0 && <li className="px-3 py-3 text-center text-xs text-muted-foreground">No match</li>}
            {groups.map((group) => (
              // The header sticks while its project's options are in view: it has to share their container
              <li key={group.project} role="presentation">
                <div className="sticky top-0 z-10 border-b bg-popover px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {group.project}
                </div>
                {group.options.map(({ option, index }) => (
                  <div
                    key={option.value}
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
                      index === active && 'bg-accent',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.value === value && <span className="text-xs text-muted-foreground">current</span>}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
