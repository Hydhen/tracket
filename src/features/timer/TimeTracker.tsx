import { useMutation } from '@tanstack/react-query'
import { Pause, Play, Timer as TimerIcon, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { api, type ApiError } from '@/lib/api'
import { submitOnCtrlEnter } from '@/lib/submitShortcut'
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

  // Stuck at the top: the pane has scrolled the bar up to the ticket's header. Told by a marker just above it
  const marker = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = marker.current
    if (!el) return
    // What scrolls is the pane around the ticket; the header covers its first 45px
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)),
      { root: el.closest('main, aside'), rootMargin: '-45px 0px 0px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (seconds !== null && seconds >= 60 && !log.isPending) log.mutate(seconds)
  }

  const durationInvalid = duration.trim() !== '' && (seconds === null || seconds < 60)

  const submitOnShortcut = submitOnCtrlEnter(submit)
  const onFormKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !log.isPending) setLogging(false)
    else submitOnShortcut(e)
  }

  return (
    <>
      {/*
        Stays at the top while the ticket scrolls, right under the sticky header of the ticket (45px high, its
        border included). It is as high as the row of the views on the left (28px of controls, 6px of padding
        around them, 1px of border: 41px), so that its bottom edge lines up with theirs. In the flow of the
        ticket it is a narrow card with a rounded border; once stuck it grows to the width of the pane (-mx-6) like
        the header, and only its bottom border is left. The opaque row around it keeps the red tint of a running
        timer from showing what scrolls underneath.
      */}
      <div ref={marker} aria-hidden className="mt-4 h-0" />
      <div className="sticky top-[45px] z-10 -mx-6 bg-background px-6">
        <section
          aria-label="Time tracking"
          className={cn(
            // The border is always there, 1px on each side: stuck, only its bottom shows (the rest is transparent)
            'border bg-background py-[5.5px] transition-[margin,padding,border-radius,border-color,background-color,box-shadow] duration-[60ms] motion-reduce:transition-none',
            stuck
              ? '-mx-6 rounded-none border-transparent border-b-border px-6 shadow-sm'
              : 'rounded-md border-border px-3',
            running && (stuck ? 'border-b-alert-line-strong bg-alert-bg' : 'border-alert-line-strong bg-alert-bg'),
          )}
        >
          <div className="flex h-7 items-center gap-2">
            <TimerIcon className={cn('size-4 text-muted-foreground', running && 'text-alert')} />
            <span
              className={cn(
                'min-w-[4.5rem] text-sm font-medium tabular-nums',
                running && 'text-alert',
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
                className="border-alert-line text-alert hover:bg-alert-bg-hover hover:text-alert"
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
            <form onSubmit={submit} onKeyDown={onFormKeyDown} className="mt-3 space-y-2">
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
        </section>
      </div>

      {/* Outside the sticky row: its stacking context would keep the dialog under the rest of the app */}
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
    </>
  )
}
