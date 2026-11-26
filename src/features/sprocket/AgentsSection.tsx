import { useMutation, useQueryClient } from '@tanstack/react-query'
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

const stepState = (run: SprocketRun, stepId: string): StepState => run.jobs.filter((j) => j.stepId === stepId).at(-1)?.state ?? 'pending'

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
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sprocket-runs'] }),
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

  return (
    <section aria-labelledby="agents-heading" className="mt-8">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="agents-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Agents
        </h2>
        <span className="text-xs text-muted-foreground">· Sprocket</span>
        {run && (
          <span className="ml-auto text-xs text-muted-foreground">
            Run #{run.number}
            {runs.data && runs.data.length > 1 && ` · ${runs.data.length} runs`}
          </span>
        )}
      </div>

      {runs.error && <p className="text-sm text-destructive">{runs.error.message}</p>}

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

          <ol aria-label="Run steps" className="flex items-start gap-1.5 overflow-x-auto p-3.5">
            {run.steps.map((step, i) => {
              const state = stepState(run, step.id)
              const passed = state === 'done'
              return (
                <Fragment key={step.id}>
                  <li
                    title={`${step.id}${step.agent ? ` (${step.agent})` : ''}: ${STATE_LABEL[state]}`}
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
