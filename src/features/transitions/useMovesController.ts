import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  api,
  ApiError,
  type Choice,
  type FieldChange,
  type IssueList,
  type IssueSummary,
  type Transition,
} from '@/lib/api'
import type { Draft } from '@/features/bulk/edits'
import { editMetaQuery } from '@/features/bulk/sharedFields'
import { summarizeChildren } from '@/features/tree/progress'
import { childrenQuery } from '@/features/tree/useTree'
import { transitionId, useLearnedFields } from './learnedFields'
import type { TicketMoves } from './movesContext'
import { moveInput, namedIn, needsInput, screenKeys, transitionsQuery, type MoveInput } from './transitions'

/** The fields this transition turned out to insist on, in this project (see `useLearnedFields`). */
const learnedFor = (issue: IssueSummary, transition: Transition) =>
  useLearnedFields.getState().fields[transitionId(issue.projectKey, transition.id)] ?? []

type Status = IssueSummary['status']
type Patches = Record<string, Partial<IssueSummary>>

/** Caches holding lists of issues, whose copies of a ticket must show its new status. */
const LIST_QUERIES = ['issues', 'search', 'children', 'tree-roots']
const isListQuery = (key: readonly unknown[]) => LIST_QUERIES.includes(key[0] as string)

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
}

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
}: {
  /** The ticket open in the detail pane: the first member of a group started with Ctrl+click */
  selected: IssueSummary | undefined
  patchLocal: (patches: Patches) => void
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
  const openInput = (issues: IssueSummary[], target: Status, needed: MoveInput) =>
    setInput({ issues, target, needed, remembered: remembered.current.get(moveKey(issues, target)) })
  // Kept after the drag ends so the overlay doesn't change content while it fades out
  const [dragged, setDragged] = useState<IssueSummary[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [flash, setFlash] = useState<string[]>([])
  const [toast, setToast] = useState<MoveToast | null>(null)
  const [confirm, setConfirm] = useState<MoveConfirm | null>(null)
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
      queryClient.invalidateQueries({ predicate: (q) => isListQuery(q.queryKey) || q.queryKey[0] === 'issue' })
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

  /** Some moves need more than the click (a resolution, a comment…): asks first, then moves. */
  const moveOrAsk = async (issues: IssueSummary[], target: Status) => {
    let needed: MoveInput | null = null
    try {
      const lists = await Promise.all(issues.map((i) => queryClient.fetchQuery(transitionsQuery(i.key))))
      const screen = moveInput(issues, lists, target, learnedFor)
      needed = needsInput(screen) ? screen : null
    } catch {
      // can't tell: try the move, and Jira's own message will say what is missing
    }
    if (needed) openInput(issues, target, needed)
    else await execute(issues, target)
  }

  const requestMove = async (issues: IssueSummary[], target: Status) => {
    const lines = await openChildrenWarnings(issues, target)
    if (lines.length > 0) setConfirm({ issues, target, lines })
    else await moveOrAsk(issues, target)
  }

  const undo = async () => {
    const current = toast
    if (!current || current.moved.length === 0) return
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

  const endDrag = () => {
    window.clearTimeout(timers.current.overlay)
    setIsDragging(false)
    setOverlayOpen(false)
  }

  const moves: TicketMoves = {
    marked: new Set(marked.map((i) => i.key)),
    dragging: new Set(isDragging ? dragged.map((i) => i.key) : []),
    flash: new Set(flash),
    toggleMark: (issue) =>
      setMarked((prev) => {
        const base = prev.length > 0 ? prev : selected ? [selected] : []
        if (base.some((m) => m.key === issue.key)) return base.filter((m) => m.key !== issue.key)
        // Any ticket can join: tickets in different statuses can still be edited together
        return [...base, issue]
      }),
    clearMarks: () => setMarked((prev) => (prev.length > 0 ? [] : prev)),
    startDrag: (issue, e) => {
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
        setIsDragging(true)
        // A mixed group can't move together, so only a group in one status needs its transitions
        const sameStatus = group.every((i) => i.status.id === group[0].status.id)
        group.forEach((i) => {
          if (sameStatus) queryClient.prefetchQuery(transitionsQuery(i.key))
          queryClient.prefetchQuery(editMetaQuery(i.key))
        })
      }, 0)
      window.clearTimeout(timers.current.overlay)
      timers.current.overlay = window.setTimeout(() => setOverlayOpen(true), OVERLAY_DELAY_MS)
    },
    endDrag,
    move: (issues, target) => void requestMove(issues, target),
  }

  // Esc cancels a drag, then clears a group (the edit dialog handles its own Esc)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || editing || input) return
      if (isDragging) endDrag()
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
    },
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
