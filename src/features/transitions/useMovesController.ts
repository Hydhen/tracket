import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api,
  ApiError,
  type Choice,
  type FieldChange,
  type IssueDetail,
  type IssueList,
  type IssueSummary,
  type Person,
  type Transition,
} from '@/lib/api'
import { BOARD_ISSUES } from '@/features/board/useBoard'
import { useResolveDefaults } from '@/features/bulk/defaultFields'
import type { Draft } from '@/features/bulk/edits'
import { editMetaQuery } from '@/features/bulk/sharedFields'
import { viewJql } from '@/features/issues/useIssues'
import { summarizeChildren } from '@/features/tree/progress'
import { childrenQuery } from '@/features/tree/useTree'
import { transitionId, useLearnedFields } from './learnedFields'
import type { TicketMoves } from './movesContext'
import {
  moveInput,
  namedIn,
  filledCheckKeys,
  needsInput,
  screenKeys,
  seedFromDefaults,
  transitionsQuery,
  withoutFilled,
  type MoveInput,
  type MoveSeed,
} from './transitions'

/** The fields this transition turned out to insist on, in this project (see `useLearnedFields`). */
const learnedFor = (issue: IssueSummary, transition: Transition) =>
  useLearnedFields.getState().fields[transitionId(issue.projectKey, transition.id)] ?? []

type Status = IssueSummary['status']
type Patches = Record<string, Partial<IssueSummary>>

/** Caches holding lists of issues, whose copies of a ticket must show its new status. */
const LIST_QUERIES = ['issues', 'search', 'children', 'tree-roots', BOARD_ISSUES]
const isListQuery = (key: readonly unknown[]) => LIST_QUERIES.includes(key[0] as string)
/** The lists of the sidebar's tabs: the Open and Closed lists, and the tree's roots */
const isSidebarQuery = (key: readonly unknown[]) => key[0] === 'issues' || key[0] === 'tree-roots'

// Don't flash the overlay for a quick drag that is only meant to reorder or cancel
const OVERLAY_DELAY_MS = 150
const FLASH_MS = 1400
const TOAST_MS = 7000
const ERROR_TOAST_MS = 12000
// Lists refresh from Jira once the green flash is over (a closed ticket then leaves the Open list)
const SYNC_DELAY_MS = 1600

export interface MoveToast {
  /** Tickets that moved, as they were before (their old status is what Undo goes back to) */
  moved: IssueSummary[]
  to?: Status
  /** Something other than a move that went through, e.g. "Updated priority on 3 tickets" */
  message?: string
  errors: string[]
  /** Where to look at a ticket that refused to move */
  failedUrl?: string
  /** Fill in more fields of the move's screen and try again, when Jira asked for something it hadn't said */
  retry?: () => void
  /** Puts back what the toast reports (an assignment): Undo does it instead of undoing a move */
  revert?: () => void
}

/** Where a drag started: tickets dragged from the board can also be dropped on the Open list, to take them. */
export type DragSource = 'list' | 'board'

export interface AssignConfirm {
  issues: IssueSummary[]
  /** Who they would go to */
  to: Person
  lines: string[]
}

const isAssignedTo = (issue: IssueSummary, person: Person) => issue.assignee?.accountId === person.accountId
const countOf = (issues: IssueSummary[]) => (issues.length > 1 ? `${issues.length} tickets` : issues[0].key)

/** What was typed in the move's dialog, kept until the tickets have moved. */
export interface RememberedInput {
  drafts: Record<string, Draft>
  /** Fields of the screen the user added to the dialog */
  added: string[]
}

/** Which move a dialog belongs to: the same tickets going to the same status. */
const moveKey = (issues: IssueSummary[], target: Status) =>
  `${issues.map((i) => i.key).sort().join(',')}>${target.id}`

export interface MoveConfirm {
  issues: IssueSummary[]
  target: Status
  lines: string[]
}

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason))

/**
 * Everything about acting on several tickets at once: picking them (Ctrl/Cmd+click), dragging
 * them onto the workflow graph to change their status (applying the transitions, undoing them),
 * or onto the edit zone to change their fields in bulk.
 *
 * `patchLocal` updates the copies of tickets that live in component state rather than in the
 * query cache.
 */
export function useMovesController({
  selected,
  patchLocal,
  me,
}: {
  /** The ticket open in the detail pane: the first member of a group started with Ctrl+click */
  selected: IssueSummary | undefined
  patchLocal: (patches: Patches) => void
  /** Who tickets get assigned to */
  me: Person
}) {
  const queryClient = useQueryClient()
  const [marked, setMarked] = useState<IssueSummary[]>([])
  // The tickets whose fields are being edited in the bulk edit dialog
  const [editing, setEditing] = useState<IssueSummary[] | null>(null)
  // A move that Jira won't accept as it is: what it asks for, to be filled in a dialog
  const [input, setInput] = useState<{
    issues: IssueSummary[]
    target: Status
    needed: MoveInput
    remembered?: RememberedInput
  } | null>(null)
  // Jira can ask for more after each try: what the user already filled in stays until the move is done
  const remembered = useRef(new Map<string, RememberedInput>())
  // `seed`: what the defaults fill in, when nothing was typed yet for this move
  const openInput = (issues: IssueSummary[], target: Status, needed: MoveInput, seed?: MoveSeed) =>
    setInput({
      issues,
      target,
      needed,
      remembered: remembered.current.get(moveKey(issues, target)) ?? (seed && { drafts: seed.drafts, added: seed.added }),
    })
  // Kept after the drag ends so the overlay doesn't change content while it fades out
  const [dragged, setDragged] = useState<IssueSummary[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [flash, setFlash] = useState<string[]>([])
  const [toast, setToast] = useState<MoveToast | null>(null)
  const [confirm, setConfirm] = useState<MoveConfirm | null>(null)
  // Taking tickets over from someone else asks first
  const [assignConfirm, setAssignConfirm] = useState<AssignConfirm | null>(null)
  // The tickets dropped on "Assign to…", while the person to give them to is being picked
  const [assigning, setAssigning] = useState<IssueSummary[] | null>(null)
  const [dragSource, setDragSource] = useState<DragSource>('list')
  const timers = useRef<Record<'overlay' | 'flash' | 'toast' | 'sync', number | undefined>>({
    overlay: undefined,
    flash: undefined,
    toast: undefined,
    sync: undefined,
  })

  useEffect(
    () => () => Object.values(timers.current).forEach((t) => window.clearTimeout(t)),
    [],
  )

  const showToast = (next: MoveToast, ms = TOAST_MS) => {
    window.clearTimeout(timers.current.toast)
    setToast(next)
    timers.current.toast = window.setTimeout(() => setToast(null), ms)
  }

  const flashRows = (keys: string[]) => {
    window.clearTimeout(timers.current.flash)
    setFlash(keys)
    timers.current.flash = window.setTimeout(() => setFlash([]), FLASH_MS)
  }

  /** Shows new values everywhere a ticket is displayed, before Jira has been asked again. */
  const applyPatches = (patches: Patches) => {
    queryClient.setQueriesData<IssueList>({ predicate: (q) => isListQuery(q.queryKey) }, (old) =>
      old && Array.isArray(old.issues)
        ? { ...old, issues: old.issues.map((i) => (patches[i.key] ? { ...i, ...patches[i.key] } : i)) }
        : old,
    )
    patchLocal(patches)
  }

  const applyStatuses = (statuses: Record<string, Status>) =>
    applyPatches(Object.fromEntries(Object.entries(statuses).map(([key, status]) => [key, { status }])))

  /** Once the dust has settled, reload from Jira what the optimistic update only guessed. */
  const scheduleSync = (keys: string[]) => {
    keys.forEach((key) => queryClient.removeQueries({ queryKey: ['transitions', key] }))
    window.clearTimeout(timers.current.sync)
    timers.current.sync = window.setTimeout(() => {
      queryClient.invalidateQueries({
        predicate: (q) => (isListQuery(q.queryKey) || q.queryKey[0] === 'issue') && !isSidebarQuery(q.queryKey),
      })
      // The sidebar's tabs (Open, Closed, Tree) are reloaded even when not showing, so none of them
      // is out of date when the person switches to it: it appears already right, with nothing loading
      queryClient.invalidateQueries({ predicate: (q) => isSidebarQuery(q.queryKey), refetchType: 'all' })
    }, SYNC_DELAY_MS)
  }

  /**
   * Applies the transition leading to `target` on each issue; reports who moved and who didn't.
   * `changes` are the values for the fields the transition asks for: each issue gets the ones its
   * own transition has.
   */
  const transitionAll = async (
    issues: IssueSummary[],
    targetOf: (issue: IssueSummary) => Status,
    changes: FieldChange[] = [],
  ) => {
    // What each ticket moved with: its transition, and the values that went along
    const used = new Map<string, { transition: Transition; own: FieldChange[] }>()
    const results = await Promise.allSettled(
      issues.map(async (issue) => {
        const target = targetOf(issue)
        // Fresh list: after a move, what is available has changed
        const transitions = await queryClient.fetchQuery({ ...transitionsQuery(issue.key), staleTime: 0 })
        const transition = transitions.find((t) => t.to.id === target.id)
        if (!transition) throw new ApiError('invalidQuery', `${issue.key} can't move to ${target.name} from here`)
        const keys = screenKeys(transition)
        const own = changes.filter((c) => keys.includes(c.key))
        await api.transitionIssue(issue.key, transition.id, own)
        used.set(issue.key, { transition, own })
      }),
    )
    const ok: IssueSummary[] = []
    const failed: { issue: IssueSummary; message: string }[] = []
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') ok.push(issues[i])
      else failed.push({ issue: issues[i], message: `${issues[i].key}: ${messageOf(result.reason)}` })
    })
    return { ok, failed, used }
  }

  /**
   * When Jira refused a move: a way to fill in more fields of its screen and try again. Its message
   * often names what was missing (the workflow can insist on a field its screen calls optional), and
   * those fields start in the dialog. Nothing when the screen has nothing more to offer.
   */
  const retryFor = async (issues: IssueSummary[], target: Status, reason: string) => {
    try {
      const lists = await Promise.all(issues.map((i) => queryClient.fetchQuery(transitionsQuery(i.key))))
      const screen = moveInput(issues, lists, target, learnedFor)
      if (screen.fields.length === 0 && screen.optional.length === 0) return undefined
      const named = namedIn(reason, screen.optional)
      const needed: MoveInput = {
        ...screen,
        fields: [...screen.fields, ...named],
        optional: screen.optional.filter((f) => !named.includes(f)),
        reason,
      }
      return () => {
        window.clearTimeout(timers.current.toast)
        setToast(null)
        openInput(issues, target, needed)
      }
    } catch {
      return undefined
    }
  }

  /**
   * `learn`: the user filled the fields in because Jira had refused without them, so once the move
   * goes through, those fields are asked for upfront next time.
   */
  const execute = async (issues: IssueSummary[], target: Status, changes: FieldChange[] = [], learn = false) => {
    setMarked([])
    applyStatuses(Object.fromEntries(issues.map((i) => [i.key, target])))

    const { ok, failed, used } = await transitionAll(issues, () => target, changes)

    if (learn) {
      for (const issue of ok) {
        const done = used.get(issue.key)
        const keys = done?.own.map((c) => c.key).filter((k) => done.transition.optional.some((f) => f.key === k))
        if (done && keys?.length) {
          useLearnedFields.getState().learn(transitionId(issue.projectKey, done.transition.id), keys)
        }
      }
    }

    // Tickets that moved need nothing more; the ones Jira refused keep what was filled in for the retry
    const key = moveKey(issues, target)
    const kept = remembered.current.get(key)
    remembered.current.delete(key)
    if (kept && failed.length > 0) {
      remembered.current.set(
        moveKey(
          failed.map((f) => f.issue),
          target,
        ),
        kept,
      )
    }

    // Tickets Jira refused go back to where they were
    if (failed.length > 0) applyStatuses(Object.fromEntries(failed.map((f) => [f.issue.key, f.issue.status])))
    if (ok.length > 0) flashRows(ok.map((i) => i.key))
    if (ok.length > 0 || failed.length > 0) {
      const retry =
        failed.length > 0
          ? await retryFor(
              failed.map((f) => f.issue),
              target,
              failed.map((f) => f.message).join('\n'),
            )
          : undefined
      showToast(
        { moved: ok, to: target, errors: failed.map((f) => f.message), failedUrl: failed[0]?.issue.url, retry },
        failed.length > 0 ? ERROR_TOAST_MS : TOAST_MS,
      )
      scheduleSync(issues.map((i) => i.key))
    }
  }

  /**
   * Applies the same field changes to each ticket; reports who changed and who didn't. `names` are
   * the fields changed, for the message. `priority` is the new priority when there is one, so the
   * lists can show it without asking Jira again.
   */
  const applyEdits = async (issues: IssueSummary[], changes: FieldChange[], names: string[], priority?: Choice) => {
    setMarked([])
    const results = await Promise.allSettled(issues.map((issue) => api.updateIssueFields(issue.key, changes)))
    const ok: IssueSummary[] = []
    const errors: string[] = []
    let failedUrl: string | undefined
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') ok.push(issues[i])
      else {
        errors.push(`${issues[i].key}: ${messageOf(result.reason)}`)
        failedUrl ??= issues[i].url
      }
    })

    // The fields the lists show; assignee and labels are only in the detail, which reloads below
    const patch: Partial<IssueSummary> = {}
    if (priority) patch.priority = { name: priority.name, iconUrl: priority.iconUrl }
    for (const change of changes) {
      if (change.key === 'duedate' && change.op === 'setDate') patch.dueDate = change.day
      if (change.key === 'parent' && change.op === 'setParent') patch.parentKey = change.issueKey
    }
    if (ok.length > 0) {
      applyPatches(Object.fromEntries(ok.map((i) => [i.key, patch])))
      flashRows(ok.map((i) => i.key))
      scheduleSync(ok.map((i) => i.key))
    }

    const what = names.join(', ')
    showToast(
      {
        moved: [],
        message: ok.length > 0 ? `Updated ${what} on ${ok.length > 1 ? `${ok.length} tickets` : ok[0].key}` : undefined,
        errors,
        failedUrl,
      },
      errors.length > 0 ? ERROR_TOAST_MS : TOAST_MS,
    )
  }

  /** Closing a parent whose children aren't done is probably a mistake: ask first. */
  const openChildrenWarnings = async (issues: IssueSummary[], target: Status) => {
    if (target.category !== 'done') return []
    const lines: string[] = []
    for (const issue of issues) {
      if (!issue.canHaveChildren) continue
      try {
        const children = await queryClient.fetchQuery(childrenQuery(issue.key))
        const progress = children.hasMore ? null : summarizeChildren(children.issues)
        if (progress && progress.done < progress.total) {
          lines.push(`${issue.key} still has children open (${progress.label}).`)
        }
      } catch {
        // can't tell, so don't get in the way of the move
      }
    }
    return lines
  }

  /**
   * Some moves need more than the click (a resolution, a comment…): asks first, then moves. A move to a done status
   * starts from the Resolve defaults of the settings: when they cover everything Jira asks for, it just goes through.
   */
  const moveOrAsk = async (issues: IssueSummary[], target: Status) => {
    let screen: MoveInput | null = null
    // Required fields the tickets already hold: not asked, and not overwritten by the defaults either
    let filled: string[] = []
    try {
      const lists = await Promise.all(issues.map((i) => queryClient.fetchQuery(transitionsQuery(i.key))))
      screen = moveInput(issues, lists, target, learnedFor)
    } catch {
      // can't tell: try the move, and Jira's own message will say what is missing
    }
    if (screen) {
      try {
        const keys = filledCheckKeys(screen)
        if (keys.length > 0) {
          // What the tickets hold right now, not what a list remembers: it may have been filled in since
          const values = await Promise.all(
            issues.map((i) =>
              queryClient.fetchQuery({
                queryKey: ['move-field-values', i.key, keys.join(',')],
                queryFn: () => api.getFieldValues(i.key, keys),
                staleTime: 0,
                gcTime: 0,
              }),
            ),
          )
          const checked = withoutFilled(screen, values)
          screen = checked.input
          filled = checked.filled
        }
      } catch {
        // can't tell: every required field is asked for, as Jira's screen says
      }
    }
    const defaults = target.category === 'done' ? useResolveDefaults.getState().fields : []
    const seed =
      screen && defaults.length > 0
        ? seedFromDefaults({ ...screen, optional: screen.optional.filter((f) => !filled.includes(f.key)) }, defaults, issues)
        : undefined

    if (screen && needsInput(screen) && !seed?.complete) {
      openInput(issues, target, screen, seed)
    } else if (seed && seed.changes.length > 0) {
      // Kept like what is typed in the dialog: if Jira refuses, its retry starts from these values
      remembered.current.set(moveKey(issues, target), { drafts: seed.drafts, added: seed.added })
      await execute(issues, target, seed.changes)
    } else {
      await execute(issues, target)
    }
  }

  const requestMove = async (issues: IssueSummary[], target: Status) => {
    const lines = await openChildrenWarnings(issues, target)
    if (lines.length > 0) setConfirm({ issues, target, lines })
    else await moveOrAsk(issues, target)
  }

  const undo = async () => {
    const current = toast
    if (!current) return
    if (current.revert) {
      window.clearTimeout(timers.current.toast)
      setToast(null)
      current.revert()
      return
    }
    if (current.moved.length === 0) return
    window.clearTimeout(timers.current.toast)
    setToast(null)

    // `moved` holds the tickets as they were: their status is where Undo goes
    const { ok, failed } = await transitionAll(current.moved, (issue) => issue.status)
    applyStatuses(Object.fromEntries(ok.map((i) => [i.key, i.status])))
    if (ok.length > 0) flashRows(ok.map((i) => i.key))
    if (failed.length > 0) {
      showToast(
        { moved: [], errors: failed.map((f) => f.message), failedUrl: failed[0].issue.url },
        ERROR_TOAST_MS,
      )
    }
    scheduleSync(current.moved.map((i) => i.key))
  }

  /**
   * The Open and Closed lists hold what is assigned to the user (by status category): tickets join or
   * leave them as soon as they are handed out or taken back, whichever tab is showing.
   */
  const syncAssignedLists = (issues: IssueSummary[]) => {
    const keys = new Set(issues.map((i) => i.key))
    for (const [view, done] of [['open', false], ['closed', true]] as const) {
      queryClient.setQueryData<IssueList>(['issues', viewJql(view)], (old) => {
        if (!old) return old
        const joining = issues.filter((i) => isAssignedTo(i, me) && (i.status.category === 'done') === done)
        return { ...old, issues: [...joining, ...old.issues.filter((i) => !keys.has(i.key))] }
      })
    }
  }

  /**
   * Gives each ticket the person `to` says (nobody unassigns). They show it at once, and go back to what
   * `from` says when Jira refuses.
   */
  const setAssignees = async (
    issues: IssueSummary[],
    to: (issue: IssueSummary) => Person | null,
    from: (issue: IssueSummary) => Person | null,
  ) => {
    setMarked([])
    // What is shown is the truth once Jira has said yes: Jira's search takes too long to take the change
    // in for the lists to be reloaded from it right after, so they are not. The board, the Open and Closed
    // lists, the tree and the ticket's detail are all changed here.
    const show = (list: IssueSummary[], who: (issue: IssueSummary) => Person | null) => {
      applyPatches(Object.fromEntries(list.map((i) => [i.key, { assignee: who(i) }])))
      syncAssignedLists(list.map((i) => ({ ...i, assignee: who(i) })))
      for (const i of list) {
        queryClient.setQueriesData<IssueDetail>({ queryKey: ['issue', i.key] }, (old) =>
          old ? { ...old, assignee: who(i) } : old,
        )
      }
    }
    // A list being reloaded right now would answer with what Jira had before: it would put the
    // tickets back where they were
    await queryClient.cancelQueries({ predicate: (q) => isListQuery(q.queryKey) })
    show(issues, to)

    const results = await Promise.allSettled(issues.map((i) => api.assignIssue(i.key, to(i)?.accountId ?? null)))
    const ok: IssueSummary[] = []
    const failed: { issue: IssueSummary; message: string }[] = []
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') ok.push(issues[i])
      else failed.push({ issue: issues[i], message: `${issues[i].key}: ${messageOf(result.reason)}` })
    })

    if (failed.length > 0) {
      show(
        failed.map((f) => f.issue),
        from,
      )
    }
    if (ok.length > 0) flashRows(ok.map((i) => i.key))
    // No reload from Jira: see above
    return { ok, failed }
  }

  /** `issues` are as they were: Undo gives each one back to who had it (`was` is who has them now). */
  const undoAssignment = async (issues: IssueSummary[], was: Person | null) => {
    const { failed } = await setAssignees(
      issues,
      (i) => i.assignee,
      () => was,
    )
    if (failed.length > 0) {
      showToast({ moved: [], errors: failed.map((f) => f.message), failedUrl: failed[0].issue.url }, ERROR_TOAST_MS)
    }
  }

  const reportAssignment = (
    ok: IssueSummary[],
    failed: { issue: IssueSummary; message: string }[],
    what: string,
    now: Person | null,
  ) =>
    showToast(
      {
        moved: [],
        message: ok.length > 0 ? `${countOf(ok)} ${what}` : undefined,
        errors: failed.map((f) => f.message),
        failedUrl: failed[0]?.issue.url,
        revert: ok.length > 0 ? () => void undoAssignment(ok, now) : undefined,
      },
      failed.length > 0 ? ERROR_TOAST_MS : TOAST_MS,
    )

  const assignTo = async (issues: IssueSummary[], to: Person) => {
    const { ok, failed } = await setAssignees(
      issues,
      () => to,
      (i) => i.assignee,
    )
    reportAssignment(ok, failed, `assigned to ${to.accountId === me.accountId ? 'you' : to.displayName}`, to)
  }

  /** Hands tickets to `to` (the user by default), once they said it is fine to take them from whoever has them. */
  const requestAssign = (group: IssueSummary[], to: Person = me) => {
    const issues = group.filter((i) => !isAssignedTo(i, to))
    if (issues.length === 0) {
      showToast({
        moved: [],
        message: `${countOf(group)} already assigned to ${to.accountId === me.accountId ? 'you' : to.displayName}`,
        errors: [],
      })
      return
    }
    const taken = issues.filter((i) => i.assignee)
    if (taken.length === 0) {
      void assignTo(issues, to)
      return
    }
    const names = [...new Set(taken.map((i) => i.assignee!.displayName))].join(', ')
    setAssignConfirm({
      issues,
      to,
      lines:
        taken.length <= 4
          ? taken.map((i) => `${i.key} is assigned to ${i.assignee!.displayName}.`)
          : [`${taken.length} of these tickets are assigned to someone else (${names}).`],
    })
  }

  const unassign = async (issues: IssueSummary[]) => {
    const { ok, failed } = await setAssignees(
      issues,
      () => null,
      (i) => i.assignee,
    )
    reportAssignment(ok, failed, 'unassigned', null)
  }

  const closeAssigning = useCallback(() => setAssigning(null), [])

  const endDrag = () => {
    window.clearTimeout(timers.current.overlay)
    setIsDragging(false)
    setOverlayOpen(false)
  }

  const moves: TicketMoves = {
    marked: new Set(marked.map((i) => i.key)),
    dragging: new Set(isDragging ? dragged.map((i) => i.key) : []),
    flash: new Set(flash),
    toggleMark: (issue) => {
      // Picking tickets again leaves the picker's tickets behind
      setAssigning(null)
      setMarked((prev) => {
        const base = prev.length > 0 ? prev : selected ? [selected] : []
        if (base.some((m) => m.key === issue.key)) return base.filter((m) => m.key !== issue.key)
        // Any ticket can join: tickets in different statuses can still be edited together
        return [...base, issue]
      })
    },
    clearMarks: () => setMarked((prev) => (prev.length > 0 ? [] : prev)),
    assign: (issue) => requestAssign(marked.some((m) => m.key === issue.key) ? marked : [issue]),
    startDrag: (issue, e, source = 'list') => {
      setAssigning(null)
      const group = marked.some((m) => m.key === issue.key) ? marked : [issue]
      e.dataTransfer.effectAllowed = 'move'
      try {
        e.dataTransfer.setData('text/plain', group.map((g) => g.key).join(','))
      } catch {
        // some webviews refuse; the drag still works through our own state
      }
      // Changing the DOM inside dragstart can cancel the drag in Chromium: defer it
      window.setTimeout(() => {
        setDragged(group)
        setDragSource(source)
        setIsDragging(true)
        // A mixed group can't move together, so only a group in one status needs its transitions
        const sameStatus = group.every((i) => i.status.id === group[0].status.id)
        group.forEach((i) => {
          if (sameStatus) queryClient.prefetchQuery(transitionsQuery(i.key))
          queryClient.prefetchQuery(editMetaQuery(i.key))
        })
      }, 0)
      window.clearTimeout(timers.current.overlay)
      // Tickets dragged from the board can be moved, edited and assigned like the ones of the lists: the overlay covers
      // the board, and the Open list (outside it) stays a drop target for taking them
      timers.current.overlay = window.setTimeout(() => setOverlayOpen(true), OVERLAY_DELAY_MS)
    },
    endDrag,
    move: (issues, target) => void requestMove(issues, target),
    edit: (issues) => setEditing(issues),
  }

  // Esc cancels a drag, then clears a group (the edit dialog handles its own Esc)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || editing || input || assignConfirm) return
      if (assigning) setAssigning(null)
      else if (isDragging) endDrag()
      else if (marked.length > 0) setMarked([])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return {
    moves,
    overlay: {
      open: overlayOpen && isDragging,
      issues: dragged,
      onDrop: (target: Status) => {
        endDrag()
        moves.move(dragged, target)
      },
      onEdit: () => {
        endDrag()
        setEditing(dragged)
      },
      onUnassign: () => {
        endDrag()
        void unassign(dragged)
      },
      onAssign: () => {
        endDrag()
        setAssigning(dragged)
      },
      /** Ends the drag after a drop somewhere else (Sprocket's targets): they act on the tickets themselves */
      close: endDrag,
    },
    /** Tickets dropped on "Assign to…": the person to give them to is being picked */
    assignPicker: {
      issues: assigning,
      pick: (person: Person) => {
        const issues = assigning
        setAssigning(null)
        if (issues) requestAssign(issues, person)
      },
      // Stable: a screen effect closes the picker when another ticket is opened
      cancel: closeAssigning,
    },
    /** Tickets dragged from the board, waiting to be dropped on the Open list */
    boardDrag: {
      active: isDragging && dragSource === 'board',
      drop: () => {
        const issues = dragged
        endDrag()
        requestAssign(issues)
      },
    },
    /** Taking tickets over from someone else: waiting for a yes */
    assignConfirm,
    confirmAssign: () => {
      const pending = assignConfirm
      setAssignConfirm(null)
      if (pending) void assignTo(pending.issues, pending.to)
    },
    cancelAssign: () => setAssignConfirm(null),
    /** The tickets being edited in bulk, while the dialog is open */
    editing,
    applyEdits: (changes: FieldChange[], names: string[], priority?: Choice) => {
      const issues = editing
      setEditing(null)
      if (issues) void applyEdits(issues, changes, names, priority)
    },
    cancelEdit: () => setEditing(null),
    toast,
    undo,
    dismissToast: () => {
      window.clearTimeout(timers.current.toast)
      setToast(null)
    },
    confirm,
    confirmMove: () => {
      const pending = confirm
      setConfirm(null)
      if (pending) void moveOrAsk(pending.issues, pending.target)
    },
    cancelMove: () => setConfirm(null),
    /** The move waiting for what Jira insists on, while its dialog is open */
    input,
    submitInput: (changes: FieldChange[]) => {
      const pending = input
      setInput(null)
      if (pending) void execute(pending.issues, pending.target, changes, !!pending.needed.reason)
    },
    cancelInput: () => setInput(null),
    /** Keeps what is typed in the dialog, in case Jira asks for more or the dialog is closed */
    rememberInput: (kept: RememberedInput) => {
      if (input) remembered.current.set(moveKey(input.issues, input.target), kept)
    },
  }
}
