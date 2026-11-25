import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, GripVertical, RefreshCw, Search, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Icon } from '@/features/issues/IssueList'
import { StatusPill } from '@/features/issues/StatusPill'
import { TicketKey } from '@/features/issues/TicketKey'
import { useRowMoves } from '@/features/transitions/useRowMoves'
import { useTicketMoves } from '@/features/transitions/movesContext'
import type { Board, IssueSummary, Person } from '@/lib/api'
import { formatDay, isOverdue } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { buildColumns, filterIssues, isMine, type AssigneeFilter, type Column } from './columns'
import { SourcePicker } from './SourcePicker'
import { sourceOptions, sourceValue } from './sources'
import {
  BOARD_ISSUES,
  defaultSource,
  useBoardData,
  useBoardPrefs,
  useBoards,
  useProjects,
  type BoardSource,
} from './useBoard'

const ASSIGNEES: { id: AssigneeFilter; label: string }[] = [
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'anyone', label: 'Anyone' },
  { id: 'mine', label: 'Mine' },
]

const SELECT =
  'h-7 min-w-0 max-w-56 truncate rounded-md border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

const scopeValue = (s: BoardSource & { kind: 'board' }) => String(s.scope)

function Avatar({ person }: { person: Person }) {
  return person.avatarUrl ? (
    <img src={person.avatarUrl} alt="" title={person.displayName} className="size-5 rounded-full" />
  ) : (
    <span
      title={person.displayName}
      className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
    >
      {person.displayName.slice(0, 1).toUpperCase()}
    </span>
  )
}

function BoardCard({
  issue,
  me,
  open,
  onOpen,
}: {
  issue: IssueSummary
  me: string
  /** Shown in the detail pane */
  open: boolean
  onOpen: (issue: IssueSummary) => void
}) {
  // Dragged to the Open list to take it, not to the status graph
  const row = useRowMoves(issue, 'board')
  const moves = useTicketMoves()
  const mine = isMine(issue, me)

  return (
    <li className={cn('group relative select-none', row.dragging && 'opacity-45')} {...row.dragProps}>
      <button
        data-part="card"
        // Ctrl/Cmd+click picks several tickets to take together
        onClick={(e) => row.handleModifierClick(e, () => onOpen(issue)) || onOpen(issue)}
        className={cn(
          'w-full rounded-lg border bg-card px-3 py-2.5 text-left text-card-foreground shadow-xs hover:bg-accent',
          mine && 'border-primary/40',
          open && 'border-primary bg-accent/60',
          row.marked && 'bg-primary/10 ring-1 ring-inset ring-primary/40',
          row.flash && 'row-flash',
        )}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon url={issue.issueType.iconUrl} />
          <TicketKey issueKey={issue.key} nested className="font-medium" />
          {issue.parentKey && <span className="truncate rounded bg-muted px-1.5 text-[11px]">{issue.parentKey}</span>}
          <GripVertical className="ml-auto size-3.5 shrink-0 opacity-0 group-hover:opacity-60" />
        </div>
        <div className="mt-1 line-clamp-3 text-sm">{issue.summary}</div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <StatusPill status={issue.status} />
          {issue.priority && (
            <span title={issue.priority.name}>
              <Icon url={issue.priority.iconUrl} />
            </span>
          )}
          {issue.dueDate && (
            <span className={cn(isOverdue(issue.dueDate) ? 'font-medium text-destructive' : 'text-muted-foreground')}>
              {formatDay(issue.dueDate)}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
            {issue.assignee && !mine && <span className="max-w-24 truncate">{issue.assignee.displayName}</span>}
            {issue.assignee ? <Avatar person={issue.assignee} /> : <span className="italic">Unassigned</span>}
          </span>
        </div>
      </button>
      {!mine && (
        <button
          onClick={() => moves.assign(issue)}
          title={issue.assignee ? `Take over from ${issue.assignee.displayName}` : 'Assign to me'}
          aria-label={`Assign ${issue.key} to me`}
          className="absolute right-2 top-1.5 hidden items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:flex group-hover:flex"
        >
          <UserPlus className="size-3.5" />
          Assign to me
        </button>
      )}
    </li>
  )
}

function BoardColumnView({
  column,
  me,
  openKey,
  collapsed,
  onToggle,
  onOpen,
}: {
  column: Column
  me: string
  openKey: string | undefined
  /** Folded into a narrow strip: just its name and how many tickets it holds */
  collapsed: boolean
  onToggle: () => void
  onOpen: (issue: IssueSummary) => void
}) {
  if (collapsed) {
    return (
      <section className="flex w-10 shrink-0 flex-col rounded-lg bg-muted/40">
        <button
          onClick={onToggle}
          aria-expanded={false}
          aria-label={`Expand ${column.name} (${column.issues.length})`}
          title={`Expand ${column.name}`}
          className="flex h-full min-h-24 flex-col items-center gap-2 rounded-lg px-1 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronRight className="size-3.5 shrink-0" />
          <span className="font-normal">{column.issues.length}</span>
          <span className="truncate font-medium uppercase tracking-wide [writing-mode:vertical-rl]">{column.name}</span>
        </button>
      </section>
    )
  }

  return (
    <section data-part="column" className="flex min-h-0 w-72 shrink-0 flex-col rounded-lg bg-muted/40">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <button
          onClick={onToggle}
          aria-expanded
          title={`Collapse ${column.name}`}
          className="flex w-full items-center gap-2 rounded-t-lg px-3 py-2 text-left uppercase hover:bg-accent hover:text-foreground"
        >
          <ChevronDown className="size-3.5 shrink-0" />
          <span data-part="column-title" className="truncate">{column.name}</span>
          <span className="font-normal">{column.issues.length}</span>
        </button>
      </h2>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {column.issues.map((issue) => (
          <BoardCard key={issue.id} issue={issue} me={me} open={issue.key === openKey} onOpen={onOpen} />
        ))}
        {column.issues.length === 0 && <li className="px-1 py-3 text-center text-xs text-muted-foreground">Nothing here</li>}
      </ul>
    </section>
  )
}

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

/**
 * Explore a Jira board (or a whole project) and hand tickets to yourself: drag a card onto the Open
 * list in the sidebar, or use "Assign to me" on it. Tickets can be taken from someone else (after
 * a confirmation), and dragged back out of the Open list to unassign them.
 */
export function BoardView({
  me,
  myIssues,
  openKey,
  onOpen,
}: {
  /** Account id of the user */
  me: string
  /** What is assigned to the user: where to start when no board was picked yet */
  myIssues: IssueSummary[]
  /** Ticket shown in the detail pane */
  openKey: string | undefined
  onOpen: (issue: IssueSummary) => void
}) {
  const queryClient = useQueryClient()
  const [prefs, setPrefs] = useBoardPrefs()
  const boards = useBoards()
  const projects = useProjects()
  // Not remembered: a new visit starts unfiltered
  const [text, setText] = useState('')

  const boardList = boards.data
  const source = prefs.source ?? (boardList ? defaultSource(boardList, myIssues) : null)
  const board: Board | undefined = source?.kind === 'board' ? boardList?.find((b) => b.id === source.boardId) : undefined

  // Sorted by project name. A project from the open tickets is offered even if the projects list left it out
  const projectList = projects.data
  const options = useMemo(
    () => sourceOptions(boardList ?? [], projectList ?? [], [...new Set(myIssues.map((i) => i.projectKey))]),
    [boardList, projectList, myIssues],
  )

  const data = useBoardData(source, prefs.showDone)
  const loaded = data.issues.data?.issues
  const issues = useMemo(() => loaded ?? [], [loaded])
  const visible = useMemo(() => filterIssues(issues, prefs.assignee, me, text), [issues, prefs.assignee, me, text])

  const backlog = data.scope?.kind === 'backlog'
  const columns = useMemo(
    () => buildColumns(visible, backlog ? undefined : data.columns, board?.kind === 'kanban' ? 'Backlog' : 'Other statuses'),
    [visible, backlog, data.columns, board?.kind],
  )

  // Remember where the default put us: the board stays the same even if the open tickets change
  useEffect(() => {
    if (!prefs.source && source) setPrefs({ source })
  }, [prefs.source, source, setPrefs])

  const refresh = () => {
    void queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] === BOARD_ISSUES || q.queryKey[0] === 'board-sprints',
    })
  }

  const pickSource = (value: string) => {
    const picked = options.find((o) => o.value === value)
    if (picked) setPrefs({ source: picked.source })
  }

  const pickScope = (value: string) => {
    if (source?.kind !== 'board') return
    const scope = value === 'auto' || value === 'board' || value === 'backlog' ? value : Number(value)
    setPrefs({ source: { ...source, scope } })
  }

  // Columns folded away are remembered for each board, by name (a board's columns keep theirs)
  const folded = prefs.collapsed[sourceValue(source)] ?? []
  const toggleColumn = (name: string) => {
    const id = sourceValue(source)
    const next = folded.includes(name) ? folded.filter((n) => n !== name) : [...folded, name]
    setPrefs({ collapsed: { ...prefs.collapsed, [id]: next } })
  }

  const hasSprints = data.sprints.length > 0
  const everyone = prefs.assignee === 'anyone'
  const fetching = data.issues.isFetching

  const noSource = !source && !boards.isPending && !projects.isPending
  const loadingSources = !source && (boards.isPending || projects.isPending)

  let body: ReactNode
  if (loadingSources || (source && data.loading && !data.issues.error)) {
    body = (
      <Message>
        <Spinner className="size-5" />
      </Message>
    )
  } else if (noSource) {
    body = <Message>No board or project to show. Is your Jira Software set up?</Message>
  } else if (data.issues.error && !data.issues.data) {
    body = (
      <Message>
        <p className="text-destructive">{data.issues.error.message}</p>
        <Button variant="outline" size="sm" onClick={() => void data.issues.refetch()}>
          Retry
        </Button>
      </Message>
    )
  } else if (columns.length === 0 || columns.every((c) => c.issues.length === 0)) {
    body = (
      <Message>
        <p>
          {issues.length === 0
            ? 'No ticket here.'
            : prefs.assignee === 'unassigned'
              ? 'Every ticket here is already assigned.'
              : 'No ticket matches.'}
        </p>
        {issues.length > 0 && !everyone && (
          <Button variant="outline" size="sm" onClick={() => setPrefs({ assignee: 'anyone' })}>
            Show tickets of anyone
          </Button>
        )}
      </Message>
    )
  } else {
    body = (
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {columns.map((column) => (
          <BoardColumnView
            key={column.id}
            column={column}
            me={me}
            openKey={openKey}
            collapsed={folded.includes(column.name)}
            onToggle={() => toggleColumn(column.name)}
            onOpen={onOpen}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <SourcePicker
          options={options}
          value={sourceValue(source)}
          fallbackLabel={
            !source ? 'Choose a board…' : source.kind === 'project' ? source.key : `Board ${source.boardId}`
          }
          onChange={pickSource}
        />

        {source?.kind === 'board' && board?.kind !== 'kanban' && (
          <select
            aria-label="Sprint"
            value={scopeValue(source)}
            onChange={(e) => pickScope(e.target.value)}
            className={SELECT}
          >
            {hasSprints && <option value="auto">Current sprint</option>}
            {data.sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.state === 'active' ? ' (active)' : ''}
              </option>
            ))}
            <option value="backlog">Backlog</option>
            <option value="board">Whole board</option>
          </select>
        )}
        {source?.kind === 'board' && board?.kind === 'kanban' && (
          <select aria-label="Scope" value={scopeValue(source)} onChange={(e) => pickScope(e.target.value)} className={SELECT}>
            <option value="auto">Board</option>
            <option value="backlog">Backlog</option>
          </select>
        )}

        <div role="tablist" aria-label="Who has the tickets" className="flex rounded-md bg-muted p-0.5">
          {ASSIGNEES.map((a) => (
            <button
              key={a.id}
              role="tab"
              aria-selected={prefs.assignee === a.id}
              onClick={() => setPrefs({ assignee: a.id })}
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium text-muted-foreground',
                prefs.assignee === a.id && 'bg-background text-foreground shadow-sm',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>

        <label className="flex h-7 min-w-32 flex-1 items-center gap-1.5 rounded-md border bg-background px-2 text-xs focus-within:ring-2 focus-within:ring-ring/50">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Filter tickets…"
            aria-label="Filter tickets"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={prefs.showDone}
            onChange={(e) => setPrefs({ showDone: e.target.checked })}
            className="size-3.5"
          />
          Done
        </label>

        <span className="text-xs text-muted-foreground">
          {visible.length}
          {data.issues.data?.hasMore ? '+' : ''}
        </span>
        <Button variant="ghost" size="icon" className="size-7" title="Refresh" onClick={refresh} disabled={fetching}>
          <RefreshCw className={cn('size-3.5', fetching && 'animate-spin')} />
        </Button>
      </div>

      {data.issues.error && data.issues.data && (
        <div className="border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          Couldn't refresh: {data.issues.error.message}
        </div>
      )}
      {data.issues.data?.hasMore && (
        <div className="border-b bg-muted/50 px-4 py-1.5 text-xs text-muted-foreground">
          Only the first tickets are shown. Narrow it down with a sprint or the filter.
        </div>
      )}

      {body}
    </div>
  )
}
