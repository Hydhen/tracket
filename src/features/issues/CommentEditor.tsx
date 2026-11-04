import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { api, type ApiError, type CommentSource, type User } from '@/lib/api'
import { caretPosition } from '@/lib/caret'
import { useDebounced } from '@/lib/useDebounced'
import { cn } from '@/lib/utils'
import { mentionAt, withMentions, type Mention } from './mentions'

/** Width of the list of people (`w-72`), to keep it inside the box */
const LIST_WIDTH = 288

/**
 * Writes a new comment, or edits the one of `commentId`, as Jira wiki markup (what Jira's REST API v2 takes as
 * text). Edited text is what Jira has right now, never a cached copy.
 */
export function CommentEditor({
  issueKey,
  commentId,
  onDone,
}: {
  issueKey: string
  commentId?: string
  onDone: () => void
}) {
  const editing = commentId !== undefined
  const source = useQuery<CommentSource, ApiError>({
    queryKey: ['comment-source', issueKey, commentId],
    queryFn: () => api.getCommentSource(issueKey, commentId!),
    enabled: editing,
    gcTime: 0,
    staleTime: 0,
  })

  if (editing && !source.data) {
    return (
      <div className="mb-5">
        {source.error ? (
          <>
            <p className="text-sm text-destructive">{source.error.message}</p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={onDone}>
              Cancel
            </Button>
          </>
        ) : (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        )}
      </div>
    )
  }
  return <CommentBox issueKey={issueKey} commentId={commentId} initial={source.data} onDone={onDone} />
}

/**
 * The text box. `@` opens a list of the people who can see the ticket, below the caret; the picked one is written
 * as `@Name` and becomes a real mention when the comment is posted.
 * Ctrl/Cmd+Enter posts; Esc cancels unless there is a draft (use Cancel to discard it).
 */
function CommentBox({
  issueKey,
  commentId,
  initial,
  onDone,
}: {
  issueKey: string
  commentId?: string
  initial?: CommentSource
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const field = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(initial?.text ?? '')
  const [caret, setCaret] = useState(0)
  // Under the caret, in pixels from the corner of the text box
  const [anchor, setAnchor] = useState({ left: 0, top: 0 })
  const [picked, setPicked] = useState<Mention[]>(initial?.mentions ?? [])
  const [active, setActive] = useState(0)
  // Where the `@` of the list the user closed with Esc is: it stays closed until they type another one
  const [closedAt, setClosedAt] = useState<number | null>(null)
  const filled = text.trim().length > 0
  const changed = text !== (initial?.text ?? '')

  const token = mentionAt(text, caret)
  const listed = token !== null && token.start !== closedAt
  const search = useDebounced(token?.query ?? '', 200)
  const people = useQuery<User[], ApiError>({
    queryKey: ['mentionable', issueKey, search],
    queryFn: () => api.searchMentionableUsers(issueKey, search),
    enabled: listed,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
  const results = people.data ?? []
  const open = listed && (people.isFetching || results.length > 0 || !!people.error)
  const choosable = listed && results.length > 0

  const post = useMutation<void, ApiError>({
    mutationFn: async () => {
      const body = withMentions(text, picked)
      if (commentId === undefined) await api.addComment(issueKey, body)
      else await api.updateComment(issueKey, commentId, body)
      // Wait for the comments to refresh, so the new text is there when the editor closes
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['issue', issueKey] }),
        queryClient.invalidateQueries({ queryKey: ['issues'] }),
      ])
    },
    onSuccess: onDone,
  })

  const canPost = filled && changed && !post.isPending

  const trackCaret = (e: SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    setCaret(el.selectionStart)
    const { left, top, lineHeight } = caretPosition(el, el.selectionStart)
    setAnchor({ left: Math.max(0, Math.min(left, el.clientWidth - LIST_WIDTH)), top: top + lineHeight })
  }

  const choose = (user: User) => {
    if (!token) return
    const inserted = `@${user.displayName} `
    const next = text.slice(0, token.start) + inserted + text.slice(caret)
    const end = token.start + inserted.length
    setText(next)
    setCaret(end)
    setActive(0)
    setPicked((prev) => [...prev.filter((p) => p.displayName !== user.displayName), user])
    // The textarea only takes the new text on the next render
    requestAnimationFrame(() => {
      field.current?.focus()
      field.current?.setSelectionRange(end, end)
    })
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (canPost) post.mutate()
    } else if (choosable && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + results.length) % results.length)
    } else if (choosable && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault()
      choose(results[Math.min(active, results.length - 1)])
    } else if (e.key === 'Escape') {
      if (token && listed) {
        e.preventDefault()
        // Only the list closes: the draft is still there
        e.stopPropagation()
        setClosedAt(token.start)
      } else if (!changed && !post.isPending) {
        e.preventDefault()
        onDone()
      }
    }
  }

  return (
    <div onKeyDown={onKeyDown} className="mb-5">
      <div className="relative">
        <textarea
          ref={field}
          autoFocus
          value={text}
          onFocus={(e) => {
            // Start at the end of what is there, where one goes on writing
            const end = e.currentTarget.value.length
            e.currentTarget.setSelectionRange(end, end)
          }}
          onChange={(e) => {
            setText(e.target.value)
            trackCaret(e)
            setActive(0)
          }}
          onSelect={trackCaret}
          onScroll={trackCaret}
          disabled={post.isPending}
          spellCheck
          role="combobox"
          aria-expanded={open}
          aria-controls="mention-list"
          aria-autocomplete="list"
          aria-label={commentId === undefined ? 'New comment (Jira wiki markup)' : 'Comment (Jira wiki markup)'}
          placeholder="Write a comment… @ to mention someone"
          className="field-sizing-content max-h-[50vh] min-h-24 w-full resize-y rounded-md border bg-background p-3 font-mono text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
        />

        {open && (
          <div
            id="mention-list"
            role="listbox"
            aria-label="People to mention"
            style={{ left: anchor.left, top: anchor.top }}
            className="absolute z-10 mt-1 max-h-56 w-72 max-w-full overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
          >
            {people.error ? (
              <p className="p-2 text-sm text-destructive">{people.error.message}</p>
            ) : results.length === 0 ? (
              <div className="flex justify-center p-2">
                <Spinner className="size-4" />
              </div>
            ) : (
              results.map((user, i) => (
                <div
                  key={user.accountId}
                  role="option"
                  aria-selected={i === active}
                  // The textarea must keep the focus, so the pick happens on press rather than on click
                  onMouseDown={(e) => {
                    e.preventDefault()
                    choose(user)
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm',
                    i === active && 'bg-accent',
                  )}
                >
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="size-5 rounded-full" />
                  ) : (
                    <span className="size-5 rounded-full bg-muted" />
                  )}
                  <span className="truncate">{user.displayName}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {post.error && <p className="mt-2 text-sm text-destructive">{post.error.message}</p>}

      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" onClick={() => post.mutate()} disabled={!canPost}>
          {post.isPending ? <Spinner /> : commentId === undefined ? 'Comment' : 'Save'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone} disabled={post.isPending}>
          Cancel
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          Jira wiki markup · Ctrl+Enter to {commentId === undefined ? 'post' : 'save'}
        </span>
      </div>
    </div>
  )
}
