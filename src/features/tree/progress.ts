import type { IssueSummary } from '@/lib/api'
import { isResolvedName } from '@/lib/statusKind'

export interface Segment {
  id: 'closed' | 'resolved' | 'active' | 'open'
  count: number
  /** Background, tuned for both themes */
  className: string
}

export interface Progress {
  total: number
  done: number
  /** Rounded share of done children, 0–100 */
  percent: number
  /** Non-empty segments, in display order */
  segments: Segment[]
  /** "11 of 15 done · 1 in progress · 3 open" */
  label: string
  /** Full breakdown for screen readers */
  aria: string
}

/**
 * Where the direct children of a ticket stand. Counts come from the children as given, so
 * callers must not pass a truncated page: percentages would lie.
 */
export function summarizeChildren(children: IssueSummary[]): Progress | null {
  if (children.length === 0) return null

  const count = (match: (i: IssueSummary) => boolean) => children.filter(match).length
  const isDone = (i: IssueSummary) => i.status.category === 'done'
  const resolved = count((i) => isDone(i) && isResolvedName(i.status.name))
  const closed = count(isDone) - resolved
  const active = count((i) => i.status.category === 'indeterminate')
  const open = count((i) => i.status.category === 'new')

  const total = children.length
  const done = closed + resolved

  const all: Segment[] = [
    { id: 'closed', count: closed, className: 'bg-[#2f8f5b]' },
    { id: 'resolved', count: resolved, className: 'bg-[#5ee38d]' },
    { id: 'active', count: active, className: 'bg-[#7db4ff]' },
    { id: 'open', count: open, className: 'bg-zinc-300 dark:bg-[#3a3a3f]' },
  ]
  const segments = all.filter((s) => s.count > 0)

  const label = [`${done} of ${total} done`, active > 0 && `${active} in progress`, open > 0 && `${open} open`]
    .filter(Boolean)
    .join(' · ')
  const names = { closed: 'closed', resolved: 'resolved', active: 'in progress', open: 'open' }
  const aria = `${total} child ${total === 1 ? 'ticket' : 'tickets'}: ${segments
    .map((s) => `${s.count} ${names[s.id]}`)
    .join(', ')}`

  return { total, done, percent: Math.round((done / total) * 100), segments, label, aria }
}
