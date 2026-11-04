import { cn } from '@/lib/utils'
import type { IssueSummary } from '@/lib/api'

const STYLES: Record<IssueSummary['status']['category'], string> = {
  new: 'bg-muted text-muted-foreground',
  indeterminate: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  done: 'bg-green-500/15 text-green-700 dark:text-green-300',
}

export function StatusPill({ status }: { status: IssueSummary['status'] }) {
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium uppercase', STYLES[status.category])}>
      {status.name}
    </span>
  )
}
