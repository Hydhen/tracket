import { Square, Timer as TimerIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatClock } from './duration'
import { RecordingDot } from './RecordingDot'
import { elapsedOf, isRunning, useNow, useTimers } from './timerStore'

/**
 * Sidebar summary of the timers: a link to the Timers view, with a stop button for all the running
 * ones. Always shown, so the view can be reached (and left) whatever the timers.
 */
export function TimerChip({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const timers = useTimers((s) => s.timers)
  const pauseAll = useTimers((s) => s.pauseAll)
  const all = Object.values(timers)
  const running = all.filter(isRunning).length
  const now = useNow(running > 0)

  const total = all.reduce((sum, t) => sum + elapsedOf(t, now), 0)
  const plural = (n: number) => `${n} timer${n > 1 ? 's' : ''}`
  const label = running > 0 ? `${plural(running)} running` : all.length > 0 ? `${plural(all.length)} paused` : 'Timers'

  return (
    <div className={cn('flex items-stretch border-t text-xs', running > 0 && 'bg-red-500/10', active && 'bg-accent')}>
      <button
        onClick={onOpen}
        aria-current={active ? 'page' : undefined}
        title="See all timers"
        className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2 text-left hover:bg-accent"
      >
        {running > 0 ? <RecordingDot label="Timers running" /> : <TimerIcon className="size-3.5 text-muted-foreground" />}
        <span className={cn('truncate font-medium', running > 0 && 'text-red-600 dark:text-red-400')}>{label}</span>
        {all.length > 0 && (
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground" title="Total across all timers">
            {formatClock(total)}
          </span>
        )}
      </button>
      {running > 0 && (
        <button
          onClick={pauseAll}
          title="Stop all running timers (the time is kept)"
          aria-label="Stop all running timers"
          className="flex items-center px-3 text-red-600 hover:bg-red-500/15 dark:text-red-400"
        >
          <Square className="size-3.5 fill-current" />
        </button>
      )}
    </div>
  )
}
