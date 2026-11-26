import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSession } from '@/features/auth/useSession'
import { api, type ApiError, type SprocketRun } from '@/lib/api'
import { timeAgo } from '@/lib/dates'

const SHOWN = 4

/**
 * The run's board, as Sprocket keeps it: notes the agents leave for each other and for you, and the reasons
 * of rejections. A note posted here is read by the agents at their next look.
 */
export function RunBoard({ run }: { run: SprocketRun }) {
  const queryClient = useQueryClient()
  const me = useSession().data?.displayName ?? 'Tracket'
  const [all, setAll] = useState(false)
  const [body, setBody] = useState('')
  const post = useMutation<void, ApiError>({
    mutationFn: () => api.sprocketPostNote(run.id, body.trim(), me),
    onSuccess: () => setBody(''),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sprocket-runs'] }),
  })
  // An older Sprocket sends no board
  if (run.board === false || !run.notes) return null
  const notes = all ? run.notes : run.notes.slice(-SHOWN)

  return (
    <div className="flex flex-col gap-2 border-t px-3.5 py-2.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">Board</span>
        <span>· {run.notes.length === 1 ? '1 note' : `${run.notes.length} notes`}</span>
        {run.notes.length > SHOWN && (
          <button type="button" className="ml-auto underline underline-offset-2" onClick={() => setAll(!all)}>
            {all ? 'Show the latest' : 'Show all'}
          </button>
        )}
      </div>
      {notes.length > 0 && (
        <ol className="flex flex-col gap-1.5" aria-label="Notes">
          {notes.map((n) => (
            <li key={n.id} className="text-[13px] leading-snug">
              <span className="font-medium">{n.author}</span>
              <span className="text-xs text-muted-foreground">
                {n.agent ? ` · ${n.agent}` : ''}
                {n.to ? ` → ${n.to}` : ''} · {timeAgo(n.at)}
              </span>
              <p className="whitespace-pre-wrap text-muted-foreground">{n.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (body.trim()) post.mutate()
        }}
      >
        <Input aria-label="A note for the agents" placeholder="A note for the agents of this run" value={body} onChange={(e) => setBody(e.target.value)} />
        <Button size="sm" type="submit" variant="outline" disabled={!body.trim() || post.isPending}>
          Post
        </Button>
      </form>
      {post.error && <p className="text-xs text-destructive">{post.error.message}</p>}
    </div>
  )
}
