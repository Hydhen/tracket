import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Pause, Play, Square } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { Icon } from '@/features/issues/IssueList'
import { StatusPill } from '@/features/issues/StatusPill'
import { TicketKey } from '@/features/issues/TicketKey'
import { api, type ApiError, type IssueList, type IssueSummary } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatClock } from './duration'
import { RecordingDot } from './RecordingDot'
import { elapsedOf, isRunning, useNow, useTimers, type Timer } from './timerStore'

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/

function TimerRow({
  issueKey,
  issue,
  timer,
  now,
  selected,
  inSide,
  loading,
  onOpen,
}: {
  issueKey: string
  /** Not known when Jira hasn't answered yet, or doesn't give the ticket back */
  issue: IssueSummary | undefined
  timer: Timer
  now: number
  selected: boolean
  inSide: boolean
  loading: boolean
  onOpen: (issue: IssueSummary, side: boolean) => void
}) {
  const { start, pause } = useTimers.getState()
  const running = isRunning(timer)

  return (
    <li
      className={cn(
        'flex items-center gap-2 border-b border-l-2 border-l-transparent px-3 py-2 hover:bg-accent',
        selected && 'bg-accent',
        inSide && 'border-l-primary bg-accent/60',
      )}
    >
      <button
        disabled={!issue}
        // Alt+click opens the side view, like in the other lists
        onClick={(e) => issue && onOpen(issue, e.altKey)}
        className="min-w-0 flex-1 text-left disabled:cursor-default"
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {issue && <Icon url={issue.issueType.iconUrl} />}
          <TicketKey issueKey={issueKey} nested className="font-medium" />
          {issue ? <StatusPill status={issue.status} /> : loading ? <Spinner /> : <span>Unavailable</span>}
        </div>
        {issue && <div className="mt-0.5 truncate text-sm">{issue.summary}</div>}
      </button>

      <span
        className={cn(
          'shrink-0 text-sm font-medium tabular-nums',
          running ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
        )}
      >
        {formatClock(elapsedOf(timer, now))}
      </span>
      <button
        onClick={() => (running ? pause(issueKey) : start(issueKey))}
        title={running ? 'Pause' : 'Resume'}
        aria-label={`${running ? 'Pause' : 'Resume'} the timer on ${issueKey}`}
        className={cn(
          'shrink-0 rounded border p-1.5 hover:bg-background',
          running ? 'border-red-500/50 text-red-600 dark:text-red-400' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </button>
    </li>
  )
}

/** Every ticket that has a timer, running ones first, with a way to stop them all. */
export function TimersView({
  selectedKey,
  sideKey,
  onOpen,
}: {
  selectedKey: string | undefined
  sideKey: string | undefined
  onOpen: (issue: IssueSummary, side: boolean) => void
}) {
  const timers = useTimers((s) => s.timers)
  const pauseAll = useTimers((s) => s.pauseAll)

  // Keys end up in JQL, so only well-formed ones are sent
  const keys = Object.keys(timers)
    .filter((k) => ISSUE_KEY.test(k))
    .sort((a, b) => Number(isRunning(timers[b])) - Number(isRunning(timers[a])) || a.localeCompare(b))
  const jql = `key in (${[...keys].sort().map((k) => `"${k}"`).join(', ')})`
  const issues = useQuery<IssueList, ApiError>({
    queryKey: ['search', jql],
    queryFn: () => api.searchIssues(jql),
    enabled: keys.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })

  const runningCount = keys.filter((k) => isRunning(timers[k])).length
  const now = useNow(runningCount > 0)

  if (keys.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <p>No timers yet.</p>
        <p className="text-xs">Start one from a ticket, and every ticket you're timing shows up here.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn('flex items-center gap-2 border-b px-4 py-2', runningCount > 0 && 'bg-red-500/10')}>
        {runningCount > 0 && <RecordingDot label="Timers running" />}
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {runningCount} running · {keys.length - runningCount} paused
        </span>
        <button
          onClick={pauseAll}
          disabled={runningCount === 0}
          title="Stop all running timers (the time is kept)"
          aria-label="Stop all running timers"
          className="ml-auto flex items-center gap-1.5 rounded border border-red-500/50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/15 disabled:pointer-events-none disabled:opacity-40 dark:text-red-400"
        >
          <Square className="size-3 fill-current" />
          Stop all
        </button>
      </div>

      {issues.error && !issues.data && <p className="border-b px-4 py-2 text-xs text-destructive">{issues.error.message}</p>}

      <ul className="flex-1 overflow-auto">
        {keys.map((key) => (
          <TimerRow
            key={key}
            issueKey={key}
            issue={issues.data?.issues.find((i) => i.key === key)}
            timer={timers[key]}
            now={now}
            selected={key === selectedKey}
            inSide={key === sideKey}
            loading={issues.isFetching}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </div>
  )
}
