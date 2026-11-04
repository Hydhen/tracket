import { useQueries } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Choice, EditField, FieldChange, IssueSummary } from '@/lib/api'
import { useBulkDefaults } from './defaultFields'
import { emptyDraft, fieldProblem, toChange, type Draft } from './edits'
import { FieldEditor } from './fieldEditors'
import { commonValue, editMetaQuery, sharedFields } from './sharedFields'

/** What the tickets have now for the few fields the lists already show. */
function currentValue(field: EditField, issues: IssueSummary[]): string | undefined {
  const value =
    field.key === 'priority'
      ? commonValue(issues, (i) => i.priority?.name ?? 'None')
      : field.key === 'duedate'
        ? commonValue(issues, (i) => i.dueDate ?? 'none')
        : field.key === 'parent'
          ? commonValue(issues, (i) => i.parentKey ?? 'none')
          : undefined
  return value === undefined ? undefined : `Now: ${value}`
}

/**
 * Changes fields on several tickets at once. The fields are the ones Jira says can be edited on
 * every ticket (custom fields included): pick the ones to change, fill them in, and each ticket
 * keeps the rest as it is.
 */
export function BulkEditDialog({
  issues,
  me,
  onApply,
  onCancel,
}: {
  issues: IssueSummary[]
  me: { accountId: string; displayName: string }
  /** `names` are the fields changed, for the confirmation; `priority` is the new priority, if one was picked */
  onApply: (changes: FieldChange[], names: string[], priority?: Choice) => void
  onCancel: () => void
}) {
  const metaQueries = useQueries({ queries: issues.map((i) => editMetaQuery(i.key)) })
  const loading = metaQueries.some((q) => q.isPending)
  const error = metaQueries.find((q) => q.error)?.error
  const fields = !loading && !error ? sharedFields(metaQueries.flatMap((q) => (q.data ? [q.data] : []))) : null

  // The fields picked for change, in the order they were picked, and what was filled in for each
  const [picked, setPicked] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [search, setSearch] = useState('')
  // The field that has the focus: the first default one when the dialog opens, then the one just added
  const [focusKey, setFocusKey] = useState<string>()
  const defaults = useBulkDefaults((s) => s.fields)
  const setDefaults = useBulkDefaults((s) => s.set)

  // Once Jira has said which fields are shared, start with the defaults among them
  const [seeded, setSeeded] = useState(false)
  if (fields && !seeded) {
    setSeeded(true)
    const start = defaults.filter((d) => fields.some((f) => f.key === d.key)).map((d) => d.key)
    setPicked(start)
    setFocusKey(start[0])
  }

  const setDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] ?? emptyDraft), ...patch } }))

  const rows = (fields ?? []).filter((f) => picked.includes(f.key))
  rows.sort((a, b) => picked.indexOf(a.key) - picked.indexOf(b.key))
  const draftOf = (key: string) => drafts[key] ?? emptyDraft
  // Defaults the tickets don't share are left out of the dialog, not of the settings: compare what is saved with what is shown
  const shownDefaults = defaults.filter((d) => fields?.some((f) => f.key === d.key)).map((d) => d.key)
  const sameAsDefaults = rows.map((f) => f.key).join() === shownDefaults.join()

  const filled = rows.flatMap((field) => {
    const change = toChange(field, draftOf(field.key), issues)
    return change ? [{ field, change }] : []
  })
  const blocked = rows.some((field) => fieldProblem(field, draftOf(field.key), issues))
  const changed = filled.length > 0

  const apply = (e?: FormEvent) => {
    e?.preventDefault()
    if (!changed || blocked) return
    const priority = filled.find(({ field, change }) => field.key === 'priority' && change.op === 'setChoice')
    onApply(
      filled.map((f) => f.change),
      filled.map((f) => f.field.name.toLowerCase()),
      priority?.field.choices.find((c) => priority.change.op === 'setChoice' && c.id === priority.change.id),
    )
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const single = issues.length === 1
  const projectKeys = [...new Set(issues.map((i) => i.projectKey))]
  const available = (fields ?? []).filter(
    (f) => !picked.includes(f.key) && f.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[8vh]"
      // Clicking beside the dialog cancels, unless that would throw away what was filled in
      onMouseDown={(e) => e.target === e.currentTarget && !changed && onCancel()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-title"
        onSubmit={apply}
        className="flex max-h-[84vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-xl"
      >
        <div className="flex items-start gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 id="bulk-title" className="text-sm font-semibold">
              {single ? `Edit ${issues[0].key}` : `Edit ${issues.length} tickets`}
            </h2>
            {!single && <p className="mt-0.5 truncate text-xs text-muted-foreground">{issues.map((i) => i.key).join(', ')}</p>}
          </div>
          <Button type="button" variant="ghost" size="icon-xs" className="ml-auto shrink-0" aria-label="Close" onClick={onCancel}>
            <X />
          </Button>
        </div>

        <div className="space-y-5 overflow-auto px-4 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Checking what can be edited…
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error.message}</p>}

          {fields && fields.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {single ? 'None of the fields can be edited on this ticket.' : 'No field can be edited on all of these tickets.'}
            </p>
          )}

          {rows.map((field) => (
            <div key={field.key}>
              <div className="mb-1.5 flex items-center gap-3">
                <label htmlFor={`bulk-${field.key}`} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {field.name}
                </label>
                <span className="ml-auto text-xs text-muted-foreground">{currentValue(field, issues)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Don't change ${field.name}`}
                  title="Leave as it is"
                  onClick={() => setPicked((prev) => prev.filter((k) => k !== field.key))}
                >
                  <X />
                </Button>
              </div>
              <FieldEditor
                field={field}
                draft={draftOf(field.key)}
                problem={fieldProblem(field, draftOf(field.key), issues)}
                autoFocus={field.key === focusKey}
                projectKeys={projectKeys}
                me={me}
                onDraft={(patch) => setDraft(field.key, patch)}
              />
            </div>
          ))}

          {fields && fields.length > 0 && (
            <div className={rows.length > 0 ? 'border-t pt-4' : undefined}>
              <label htmlFor="bulk-find" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {rows.length === 0 ? 'Fields to change' : 'Change another field'}
              </label>
              {!single && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The fields every one of these tickets lets you edit. The others stay out.
                </p>
              )}
              {fields.length > 8 && (
                <Input
                  id="bulk-find"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Find among ${fields.length} fields…`}
                  className="mt-2"
                />
              )}
              <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-auto">
                {available.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => {
                      setPicked((prev) => [...prev, f.key])
                      setFocusKey(f.key)
                      setSearch('')
                    }}
                    className="rounded-full border px-2.5 py-1 text-xs hover:bg-accent"
                  >
                    + {f.name}
                  </button>
                ))}
                {available.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {search.trim() ? 'No field matches.' : 'All the fields are already above.'}
                  </p>
                )}
              </div>
            </div>
          )}

          {fields && !sameAsDefaults && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() =>
                setDefaults([
                  ...rows.map((f) => ({ key: f.key, name: f.name })),
                  // Defaults these tickets don't share weren't on screen: keep them
                  ...defaults.filter((d) => !fields.some((f) => f.key === d.key)),
                ])
              }
            >
              {rows.length > 0 ? 'Start with these fields next time' : 'Start with no fields next time'}
            </Button>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!changed || blocked}>
            {single ? 'Apply' : `Apply to ${issues.length} tickets`}
          </Button>
        </div>
      </form>
    </div>
  )
}
