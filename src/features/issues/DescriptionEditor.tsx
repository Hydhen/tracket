import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type KeyboardEvent } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { api, type ApiError } from '@/lib/api'

/**
 * Edits a description as Jira wiki markup (what Jira's REST API v2 exposes as text).
 * Ctrl/Cmd+Enter saves; Esc cancels unless there are unsaved changes (use Cancel to discard).
 */
export function DescriptionEditor({ issueKey, onDone }: { issueKey: string; onDone: () => void }) {
  const queryClient = useQueryClient()
  const source = useQuery<string, ApiError>({
    queryKey: ['description-source', issueKey],
    queryFn: () => api.getDescriptionSource(issueKey),
    // Always edit what Jira has right now, never a cached copy
    gcTime: 0,
    staleTime: 0,
  })

  // Null until the user types: the textarea shows the loaded text until then
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? source.data ?? ''
  const dirty = draft !== null && draft !== source.data

  const save = useMutation<void, ApiError>({
    mutationFn: async () => {
      await api.updateDescription(issueKey, text)
      // Wait for the rendered description to refresh, so the old one doesn't flash back
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['issue', issueKey] }),
        queryClient.invalidateQueries({ queryKey: ['issues'] }),
      ])
    },
    onSuccess: onDone,
  })

  const canSave = source.isSuccess && dirty && !save.isPending

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (canSave) save.mutate()
    } else if (e.key === 'Escape' && !dirty && !save.isPending) {
      e.preventDefault()
      onDone()
    }
  }

  return (
    <div onKeyDown={onKeyDown}>
      {source.isPending ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-5" />
        </div>
      ) : source.error ? (
        <p className="text-sm text-destructive">{source.error.message}</p>
      ) : (
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          disabled={save.isPending}
          spellCheck
          aria-label="Description (Jira wiki markup)"
          placeholder="Describe the ticket…"
          className="field-sizing-content max-h-[60vh] min-h-40 w-full resize-y rounded-md border bg-background p-3 font-mono text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
        />
      )}

      {save.error && <p className="mt-2 text-sm text-destructive">{save.error.message}</p>}

      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" onClick={() => save.mutate()} disabled={!canSave}>
          {save.isPending ? <Spinner /> : 'Save'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">Jira wiki markup · Ctrl+Enter to save</span>
      </div>
    </div>
  )
}
