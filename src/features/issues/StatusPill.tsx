import { cn } from '@/lib/utils'
import type { IssueSummary } from '@/lib/api'

const STYLES: Record<IssueSummary['status']['category'], string> = {
  new: 'bg-muted text-muted-foreground',
  indeterminate: 'bg-chip-active-bg text-chip-active-fg',
  done: 'bg-chip-done-bg text-chip-done-fg',
}

export function StatusPill({ status }: { status: IssueSummary['status'] }) {
  return (
    <span data-part="chip" className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium uppercase', STYLES[status.category])}>
      {status.name}
    </span>
  )
}
