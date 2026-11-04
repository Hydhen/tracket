import { openUrl } from '@tauri-apps/plugin-opener'
import { X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { emptyDraft, fieldProblem, toChange, type Draft } from '@/features/bulk/edits'
import { FieldEditor } from '@/features/bulk/fieldEditors'
import type { EditField, FieldChange, IssueSummary } from '@/lib/api'
import type { MoveInput } from './transitions'

type Status = IssueSummary['status']

/** A field is filled in when there is a real value for it, not just a clearing. */
function filled(field: EditField, draft: Draft, issues: IssueSummary[]): FieldChange | null {
  const change = toChange(field, draft, issues)
  if (!change) return null
  const needsText = ['text', 'number', 'date', 'longText', 'timeSpent'].includes(field.kind)
  if (needsText && !draft.value.trim()) return null
  if (field.kind === 'user' && !draft.user?.accountId) return null
  return change
}

/**
 * Asks for what Jira insists on before it moves tickets to a status (a resolution, a comment…).
 * Jira's own screen for the move says what: nothing here is specific to one workflow. The rest of
 * the screen can be added too, since a workflow may insist on a field without saying so; when Jira
 * has refused a move, its words are shown and the fields they name are already there.
 */
export function TransitionInputDialog({
  issues,
  target,
  input,
  me,
  onSubmit,
  onCancel,
}: {
  issues: IssueSummary[]
  target: Status
  input: MoveInput
  me: { accountId: string; displayName: string }
  onSubmit: (changes: FieldChange[]) => void
  onCancel: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  // Fields of the screen added by the user, in the order they were added
  const [added, setAdded] = useState<string[]>([])
  const draftOf = (key: string) => drafts[key] ?? emptyDraft

  const rows = [...input.fields, ...added.flatMap((key) => input.optional.find((f) => f.key === key) ?? [])]
  const changes = rows.map((field) => filled(field, draftOf(field.key), issues))
  const canMove = changes.every((change) => change !== null) && input.unsupported.length === 0
  const started = Object.keys(drafts).length > 0 || added.length > 0
  const more = input.optional.filter((f) => !added.includes(f.key))

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (canMove) onSubmit(changes.filter((change): change is FieldChange => change !== null))
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const what = issues.length > 1 ? `${issues.length} tickets` : issues[0].key
  const projectKeys = [...new Set(issues.map((i) => i.projectKey))]

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[10vh]"
      // Clicking beside the dialog cancels, unless that would throw away what was filled in
      onMouseDown={(e) => e.target === e.currentTarget && !started && onCancel()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-title"
        onSubmit={submit}
        className="flex max-h-[82vh] w-full max-w-md flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-xl"
      >
        <div className="border-b px-4 py-3">
          <h2 id="move-title" className="text-sm font-semibold">
            Move {what} to {target.name}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {input.reason ? 'Jira refused the move without more details.' : 'Jira needs this before it accepts the move.'}
          </p>
        </div>

        <div className="space-y-5 overflow-auto px-4 py-4">
          {input.reason && (
            <p className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {input.reason}
            </p>
          )}

          {rows.map((field, i) => {
            const optional = !input.fields.includes(field)
            return (
              <div key={field.key}>
                <div className="mb-1.5 flex items-center gap-2">
                  <label
                    htmlFor={`bulk-${field.key}`}
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {field.name}
                  </label>
                  {optional && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="ml-auto"
                      aria-label={`Don't fill in ${field.name}`}
                      title="Leave it out"
                      onClick={() => setAdded((prev) => prev.filter((k) => k !== field.key))}
                    >
                      <X />
                    </Button>
                  )}
                </div>
                <FieldEditor
                  field={field}
                  draft={draftOf(field.key)}
                  problem={fieldProblem(field, draftOf(field.key), issues)}
                  autoFocus={i === 0 || (optional && field.key === added[added.length - 1])}
                  required
                  issueCount={issues.length}
                  projectKeys={projectKeys}
                  me={me}
                  onDraft={(patch) =>
                    setDrafts((prev) => ({ ...prev, [field.key]: { ...(prev[field.key] ?? emptyDraft), ...patch } }))
                  }
                />
              </div>
            )
          })}

          {input.unsupported.length > 0 && (
            <p className="text-sm text-destructive">
              Jira also needs {input.unsupported.join(', ')}, which Tracket can't fill in yet. Make this move in Jira
              instead.
            </p>
          )}

          {more.length > 0 && (
            <div className={rows.length > 0 ? 'border-t pt-4' : undefined}>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Also on Jira's screen for this move
              </div>
              <div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-auto">
                {more.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setAdded((prev) => [...prev, f.key])}
                    className="rounded-full border px-2.5 py-1 text-xs hover:bg-accent"
                  >
                    + {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          {input.unsupported.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => openUrl(issues[0].url)}>
              Open {issues[0].key} in Jira
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canMove}>
            Move to {target.name}
          </Button>
        </div>
      </form>
    </div>
  )
}
