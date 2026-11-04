import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type KeyboardEvent } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { api, type ApiError } from '@/lib/api'

/**
 * Writes a new comment as Jira wiki markup (what Jira's REST API v2 takes as text).
 * Ctrl/Cmd+Enter posts; Esc cancels unless there is a draft (use Cancel to discard it).
 */
export function CommentEditor({ issueKey, onDone }: { issueKey: string; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const filled = text.trim().length > 0

  const post = useMutation<void, ApiError>({
    mutationFn: async () => {
      await api.addComment(issueKey, text)
      // Wait for the comments to refresh, so the new one is there when the editor closes
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['issue', issueKey] }),
        queryClient.invalidateQueries({ queryKey: ['issues'] }),
      ])
    },
    onSuccess: onDone,
  })

  const canPost = filled && !post.isPending

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (canPost) post.mutate()
    } else if (e.key === 'Escape' && !filled && !post.isPending) {
      e.preventDefault()
      onDone()
    }
  }

  return (
    <div onKeyDown={onKeyDown} className="mb-5">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={post.isPending}
        spellCheck
        aria-label="New comment (Jira wiki markup)"
        placeholder="Write a comment…"
        className="field-sizing-content max-h-[50vh] min-h-24 w-full resize-y rounded-md border bg-background p-3 font-mono text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
      />

      {post.error && <p className="mt-2 text-sm text-destructive">{post.error.message}</p>}

      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" onClick={() => post.mutate()} disabled={!canPost}>
          {post.isPending ? <Spinner /> : 'Comment'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone} disabled={post.isPending}>
          Cancel
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">Jira wiki markup · Ctrl+Enter to post</span>
      </div>
    </div>
  )
}
