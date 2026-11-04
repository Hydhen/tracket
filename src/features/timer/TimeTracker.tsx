import { useMutation } from '@tanstack/react-query'
import { Pause, Play, Timer as TimerIcon, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { api, type ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatClock, formatDuration, jiraTimestamp, parseDuration } from './duration'
import { RecordingDot } from './RecordingDot'
import { elapsedOf, isRunning, useNow, useTimers } from './timerStore'

/** Timers shorter than this aren't worth a confirmation when thrown away */
const DISCARD_CONFIRM_MS = 60_000

/**
 * A stopwatch for the ticket, and the way to log time on it in Jira. Logging works without the
 * stopwatch too: type the duration. The stopwatch pauses while the form is open and is cleared once
 * Jira has the worklog. Red while it runs, like a recording light.
 */
export function TimeTracker({ issueKey }: { issueKey: string }) {
  const timer = useTimers((s) => s.timers[issueKey])
  const { start, pause, discard } = useTimers.getState()
  const running = isRunning(timer)
  const now = useNow(running)
  const elapsed = timer ? elapsedOf(timer, now) : 0

  const [logging, setLogging] = useState(false)
  const [duration, setDuration] = useState('')
  const [comment, setComment] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [logged, setLogged] = useState<string | null>(null)

  const seconds = parseDuration(duration)

  const log = useMutation<void, ApiError, number>({
    mutationFn: (secs) => api.addWorklog(issueKey, secs, jiraTimestamp(new Date(Date.now() - secs * 1000)), comment),
    onSuccess: (_, secs) => {
      discard(issueKey)
      setLogging(false)
      setComment('')
      setLogged(formatDuration(secs))
    },
  })

  const openForm = () => {
    pause(issueKey)
    // Whole minutes, at least one: that's the smallest worklog Jira takes
    setDuration(elapsed >= 1000 ? formatDuration(Math.max(60, Math.round(elapsed / 60_000) * 60)) : '')
    setLogged(null)
    log.reset()
    setLogging(true)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (seconds !== null && seconds >= 60 && !log.isPending) log.mutate(seconds)
  }

  const durationInvalid = duration.trim() !== '' && (seconds === null || seconds < 60)

  return (
    <section
      aria-label="Time tracking"
      className={cn(
        'mt-6 rounded-md border px-3 py-2 transition-colors',
        running && 'border-red-500/60 bg-red-500/10',
      )}
    >
      <div className="flex items-center gap-2">
        <TimerIcon className={cn('size-4 text-muted-foreground', running && 'text-red-600 dark:text-red-400')} />
        <span
          className={cn(
            'min-w-[4.5rem] text-sm font-medium tabular-nums',
            running && 'text-red-600 dark:text-red-400',
          )}
          // Not announced every second
          aria-live="off"
        >
          {formatClock(elapsed)}
        </span>
        {running && <RecordingDot label="Timer running" />}

        {running ? (
          <Button
            variant="outline"
            size="sm"
            className="border-red-500/50 text-red-600 hover:bg-red-500/15 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
            onClick={() => pause(issueKey)}
          >
            <Pause className="size-3.5" />
            Pause
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => start(issueKey)} disabled={logging}>
            <Play className="size-3.5" />
            {elapsed > 0 ? 'Resume' : 'Start'}
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {logged && !logging && (
            <span role="status" className="mr-1 text-xs text-muted-foreground">
              Logged {logged} in Jira
            </span>
          )}
          {!logging && (
            <Button variant="ghost" size="sm" onClick={openForm}>
              Log time
            </Button>
          )}
          {timer && !logging && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title="Discard the timer"
              aria-label="Discard the timer"
              onClick={() => (elapsed >= DISCARD_CONFIRM_MS ? setConfirmDiscard(true) : discard(issueKey))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {logging && (
        <form onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && !log.isPending && setLogging(false)} className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <label htmlFor={`worklog-duration-${issueKey}`} className="text-xs text-muted-foreground">
              Time spent
            </label>
            <input
              id={`worklog-duration-${issueKey}`}
              autoFocus
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              disabled={log.isPending}
              placeholder="1h 30m, 2d"
              aria-invalid={durationInvalid}
              className={cn(
                'w-36 rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                durationInvalid && 'border-destructive',
              )}
            />
            <span className="text-xs text-muted-foreground">
              {durationInvalid ? 'Try 1h 30m, 45m, 2d or 1:30 (1 minute at least)' : 'ending now'}
            </span>
          </div>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={log.isPending}
            aria-label="Work description"
            placeholder="What did you work on? (optional)"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          {log.error && <p className="text-sm text-destructive">{log.error.message}</p>}
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={seconds === null || seconds < 60 || log.isPending}>
              {log.isPending ? <Spinner /> : 'Log in Jira'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setLogging(false)} disabled={log.isPending}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title="Discard the timer?"
          confirmLabel="Discard"
          onConfirm={() => {
            discard(issueKey)
            setConfirmDiscard(false)
          }}
          onCancel={() => setConfirmDiscard(false)}
        >
          <p>
            {formatClock(elapsed)} on {issueKey} hasn't been logged in Jira and will be lost.
          </p>
        </ConfirmDialog>
      )}
    </section>
  )
}

