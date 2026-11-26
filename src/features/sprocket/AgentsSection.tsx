import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSession } from '@/features/auth/useSession'
import { api, type ApiError, type IssueSummary, type SprocketJobState, type SprocketRun, type SprocketStep } from '@/lib/api'
import { timeAgo } from '@/lib/dates'
import { AgentsMenu } from './AgentsMenu'
import { RunBoard } from './RunBoard'
import { useTicketRuns } from './useSprocket'

type StepState = SprocketJobState | 'pending'

const STATE_LABEL: Record<StepState, string> = {
  done: 'Done',
  running: 'Running',
  waiting: 'Needs you',
  failed: 'Failed',
  rejected: 'Rejected',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
  pending: 'Not started',
}

const DOT_COLOR: Partial<Record<StepState, string>> = {
  done: 'var(--sp-ok)',
  running: 'var(--sp-run)',
  waiting: 'var(--sp-lit)',
  failed: 'var(--sp-fail)',
  rejected: 'var(--sp-fail)',
  interrupted: 'var(--sp-lit)',
}

const RUN_PILL: Record<SprocketRun['state'], [string, string, string]> = {
  running: ['Running', 'var(--sp-act-bg)', 'var(--sp-act-fg)'],
  waiting: ['Needs you', 'var(--sp-lit-bg)', 'var(--sp-lit)'],
  passed: ['Passed', 'var(--sp-done-bg)', 'var(--sp-done-fg)'],
  failed: ['Failed', 'var(--sp-fail-bg)', 'var(--sp-fail)'],
  cancelled: ['Cancelled', 'var(--muted)', 'var(--muted-foreground)'],
  interrupted: ['Interrupted', 'var(--sp-lit-bg)', 'var(--sp-lit)'],
}

function Dot({ state }: { state: StepState }) {
  const color = DOT_COLOR[state]
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={color ? { background: color, boxShadow: `0 0 6px ${color}` } : { border: '1.5px solid var(--sp-idle)' }}
    />
  )
}

/** A step's state: its latest job outside loops that wasn't done again since (a retry or a rejection supersedes it). */
const stepState = (run: SprocketRun, stepId: string): StepState => {
  const jobs = run.jobs.filter((j) => j.stepId === stepId && !j.superseded)
  return (jobs.filter((j) => !j.scope).at(-1) ?? jobs.at(-1))?.state ?? 'pending'
}

/** A loop's items done, out of those started: `2/3`. */
function loopBadge(run: SprocketRun, step: SprocketStep): string | null {
  const prefix = `${step.id}[`
  const items = run.jobs.filter((j) => !j.superseded && j.scope?.startsWith(prefix))
  const scopes = new Set(items.map((j) => j.scope))
  if (scopes.size === 0) return null
  const last = step.steps?.at(-1)?.id
  const done = new Set(items.filter((j) => j.stepId === last && j.state === 'done').map((j) => j.scope)).size
  return `${done}/${scopes.size}`
}

/** What one stage of the run shows: the step, or each step of its branches stacked when they run side by side. */
const stageSteps = (step: SprocketStep): SprocketStep[] => (step.kind === 'parallel' ? (step.branches ?? []).flat() : [step])

function StepChip({ run, step }: { run: SprocketRun; step: SprocketStep }) {
  const state = stepState(run, step.id)
  const badge = step.kind === 'forEach' ? loopBadge(run, step) : null
  const who = step.team ? step.team.members.join(', ') : step.agent
  return (
    <span
      title={`${step.id}${who ? ` (${who})` : ''}: ${STATE_LABEL[state]}`}
      className="flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2 whitespace-nowrap"
      style={
        state === 'waiting'
          ? { background: 'var(--sp-lit-bg)', boxShadow: 'inset 0 0 0 1px var(--sp-lit-border)' }
          : state === 'running'
            ? { background: 'var(--sp-act-bg)' }
            : undefined
      }
    >
      <Dot state={state} />
      <span
        className="text-xs font-medium"
        style={{ color: state === 'waiting' ? 'var(--sp-lit)' : state === 'pending' ? 'var(--muted-foreground)' : undefined }}
      >
        {step.id}
      </span>
      {badge && <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{badge}</span>}
      {step.team && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">team of {step.team.members.length}</span>}
    </span>
  )
}

/** Retry the failed step, stop the run (or close a failed one), from the ticket. */
function RunActions({ run }: { run: SprocketRun }) {
  const queryClient = useQueryClient()
  const me = useSession().data?.displayName ?? 'Tracket'
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['sprocket-runs'] })
    void queryClient.invalidateQueries({ queryKey: ['sprocket-tickets'] })
  }
  const failedJob = [...run.jobs].reverse().find((j) => !j.superseded && ['failed', 'interrupted', 'rejected'].includes(j.state))
  const retry = useMutation<void, ApiError>({ mutationFn: () => api.sprocketRetryJob(failedJob?.id ?? ''), onSettled: done })
  const stop = useMutation<void, ApiError>({ mutationFn: () => api.sprocketCancelRun(run.id, me), onSettled: done })
  const stopped = run.state === 'failed' || run.state === 'interrupted'
  const canStop = run.state === 'running' || run.state === 'waiting' || stopped
  if (!canStop) return null
  const error = retry.error ?? stop.error
  return (
    <div className="flex flex-wrap items-center gap-2 border-t px-3.5 py-2.5">
      {stopped && failedJob && (
        <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>
          Retry {failedJob.stepId.split('~')[0]}
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={stop.isPending} onClick={() => stop.mutate()}>
        {stopped ? 'Close the run' : 'Stop the run'}
      </Button>
      {error && <span className="text-xs text-destructive">{error.message}</span>}
    </div>
  )
}

/** Every step, those inside conditions and loops too. */
const allSteps = (steps: SprocketStep[]): SprocketStep[] =>
  steps.flatMap((s) => [s, ...allSteps([...(s.then ?? []), ...(s.else ?? []), ...(s.steps ?? []), ...(s.branches ?? []).flat()])])

/**
 * Who works in a run: each step's agent type, and each member of a team step. A team member's jobs, like the
 * answers an agent asked another agent type for, have the step id `<step>~<agent type>`.
 */
const workers = (run: SprocketRun) =>
  allSteps(run.steps).flatMap((s) =>
    s.team ? s.team.members.map((m) => ({ key: `${s.id}~${m}`, agent: m, stepId: `${s.id}~${m}` })) : s.agent ? [{ key: s.id, agent: s.agent, stepId: s.id }] : [],
  )

/** A step or tool call waiting for someone, with Approve and Reject… (which asks for a reason first). */
function Waiting({ run, approval }: { run: SprocketRun; approval: SprocketRun['approvals'][number] }) {
  const queryClient = useQueryClient()
  const me = useSession().data?.displayName ?? 'Tracket'
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const decide = useMutation<void, ApiError, boolean>({
    mutationFn: (approve) => api.sprocketDecide(approval.id, approve, me, reason),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['sprocket-runs'] })
      void queryClient.invalidateQueries({ queryKey: ['sprocket-tickets'] })
    },
  })
  const job = run.jobs.find((j) => j.id === approval.jobId)
  const [stepId, asked] = (job?.stepId ?? '').split('~')
  const step = allSteps(run.steps).find((s) => s.id === stepId)
  const title =
    approval.kind === 'tool'
      ? `${asked ?? step?.agent ?? 'An agent'} wants to use ${approval.toolName}`
      : `${step?.id ?? 'A step'} waits for your approval`
  const summary = approval.kind === 'tool' ? '' : approval.summary

  return (
    <div className="mx-3.5 mb-3.5 flex flex-col gap-2.5 rounded-lg border p-3" style={{ background: 'var(--sp-lit-bg)', borderColor: 'var(--sp-lit-border)' }}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex min-w-60 flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-medium">{title}</span>
          {summary && <span className="line-clamp-2 text-xs text-muted-foreground">{summary}</span>}
        </span>
        <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
          Approve
        </Button>
        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => (rejecting ? decide.mutate(false) : setRejecting(true))}>
          {rejecting ? 'Reject' : 'Reject…'}
        </Button>
      </div>
      {rejecting && (
        <Input
          autoFocus
          aria-label="Reason, sent to the agent"
          placeholder="What to change (optional, sent back to the agent)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && decide.mutate(false)}
        />
      )}
      {decide.error && <p className="text-xs text-destructive">{decide.error.message}</p>}
    </div>
  )
}

/**
 * Agents · Sprocket: the ticket's latest run, its steps and what waits for you, as Sprocket reports them.
 * Shown when signed in to Sprocket (Settings › Sprocket).
 */
export function AgentsSection({ issue, worktreeFolder }: { issue: IssueSummary; worktreeFolder: () => Promise<string> }) {
  const runs = useTicketRuns(issue.key, true)
  const run = runs.data?.[0]
  const [openError, setOpenError] = useState<string | null>(null)

  return (
    <section aria-labelledby="agents-heading" className="mt-8">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="agents-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Agents
        </h2>
        <span className="text-xs text-muted-foreground">· Sprocket</span>
        {run && (
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {runs.data && runs.data.length > 1 && `${runs.data.length} runs ·`}
            <button
              type="button"
              title="Show this run in Sprocket"
              className="flex items-center gap-1 font-medium text-(--sp-accent) hover:underline"
              onClick={() => void api.sprocketShowRun(run.id).then(() => setOpenError(null), (e: ApiError) => setOpenError(e.message))}
            >
              Open run #{run.number}
              <ExternalLink className="size-3" />
            </button>
          </span>
        )}
      </div>

      {runs.error && <p className="text-sm text-destructive">{runs.error.message}</p>}
      {openError && <p className="mb-2 text-xs text-destructive">Couldn't open the run in Sprocket: {openError}</p>}

      {runs.data && !run && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-dashed px-3.5 py-3 text-[13px] text-muted-foreground">
          <span className="flex-[1_1_260px]">No agent is working on this ticket. Start a workflow and follow it here.</span>
          <AgentsMenu issue={issue} worktreeFolder={worktreeFolder} trigger="section" />
        </div>
      )}

      {run && (
        <div className="overflow-hidden rounded-[10px] border bg-card">
          <div className="flex flex-wrap items-center gap-2 px-3.5 pt-3">
            <span className="text-sm font-medium">{run.workflowName}</span>
            <span className="text-xs text-muted-foreground">
              started by {run.startedBy} · {timeAgo(run.startedAt)}
            </span>
            <span
              className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium uppercase"
              style={{ background: RUN_PILL[run.state][1], color: RUN_PILL[run.state][2] }}
            >
              {RUN_PILL[run.state][0]}
            </span>
          </div>
          {run.request && (
            <p className="px-3.5 pt-1.5 text-xs text-muted-foreground">
              Asked: <span className="text-foreground">{run.request}</span>
            </p>
          )}

          <ol aria-label="Run steps" className="flex items-center gap-1.5 overflow-x-auto p-3.5">
            {run.steps.map((step, i) => {
              const steps = stageSteps(step)
              // The chevron after a stage lights once all of it is done
              const passed = steps.every((s) => stepState(run, s.id) === 'done')
              return (
                <Fragment key={step.id}>
                  <li className="flex shrink-0 flex-col gap-1" aria-label={steps.length > 1 ? `${step.id}: side by side` : undefined}>
                    {steps.map((s) => (
                      <StepChip key={s.id} run={run} step={s} />
                    ))}
                  </li>
                  {i < run.steps.length - 1 && (
                    <svg aria-hidden viewBox="0 0 24 24" width="14" height="26" fill="none" stroke={passed ? 'var(--sp-accent)' : 'var(--sp-idle)'} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  )}
                </Fragment>
              )
            })}
          </ol>

          {run.approvals.map((a) => (
            <Waiting key={a.id} run={run} approval={a} />
          ))}
          <RunActions run={run} />

          <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 border-t px-3.5 py-2.5 text-xs text-muted-foreground">
            {workers(run).map((w) => {
              const state = stepState(run, w.stepId)
              return (
                <span key={w.key} className="flex items-center gap-1.5">
                  <Dot state={state} />
                  <span className="text-foreground">{w.agent}</span>
                  {STATE_LABEL[state].toLowerCase()}
                </span>
              )
            })}
          </div>
          <RunBoard run={run} />
        </div>
      )}
    </section>
  )
}
