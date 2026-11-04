import { useQueries } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { onePerProject, useIssues, viewJql } from '@/features/issues/useIssues'
import { useBulkDefaults } from './defaultFields'
import { editMetaQuery, knownFields } from './sharedFields'

/**
 * The fields the bulk edit dialog starts with. Which fields exist depends on the Jira site, so the
 * ones to choose from are read from your open tickets (one per project).
 */
export function BulkEditSettings() {
  const { fields, add, remove, move, set } = useBulkDefaults()
  const [search, setSearch] = useState('')

  const issues = useIssues(viewJql('open'))
  const sample = onePerProject(issues.data?.issues ?? [])
  const metaQueries = useQueries({ queries: sample.map((i) => editMetaQuery(i.key)) })
  const loading = issues.isPending || metaQueries.some((q) => q.isPending)
  const catalog = knownFields(metaQueries.flatMap((q) => (q.data ? [q.data] : [])))

  const offered = catalog.filter(
    (f) => !fields.some((d) => d.key === f.key) && f.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Bulk edit</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Fields already added when you edit tickets together (drag tickets onto the edit zone). A field the tickets
        don't all share is skipped.
      </p>

      <ol className="mt-3 space-y-1.5">
        {fields.length === 0 && <li className="text-sm text-muted-foreground">None: the dialog starts empty.</li>}
        {fields.map((field, i) => (
          <li key={field.key} className="flex items-center gap-1 rounded-md border px-2.5 py-1">
            <span className="min-w-0 flex-1 truncate text-sm">{field.name}</span>
            {!loading && catalog.length > 0 && !catalog.some((f) => f.key === field.key) && (
              <span className="text-xs text-muted-foreground" title="Not found on your open tickets">
                not on your tickets
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Move ${field.name} up`}
              disabled={i === 0}
              onClick={() => move(field.key, -1)}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Move ${field.name} down`}
              disabled={i === fields.length - 1}
              onClick={() => move(field.key, 1)}
            >
              <ArrowDown />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label={`Remove ${field.name}`} onClick={() => remove(field.key)}>
              <X />
            </Button>
          </li>
        ))}
      </ol>
      {fields.length > 0 && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => set([])}>
          Clear
        </Button>
      )}

      <div className="mt-3 rounded-md border border-dashed p-2">
        <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Add a field</div>
        {loading ? (
          <div className="mt-2 flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Reading the fields of your tickets…
          </div>
        ) : catalog.length === 0 ? (
          <p className="mt-2 px-1 text-sm text-muted-foreground">
            {sample.length === 0
              ? 'No open ticket to read the available fields from.'
              : "Couldn't read the fields of your tickets."}
          </p>
        ) : (
          <>
            {catalog.length > 8 && (
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Find among ${catalog.length} fields…`}
                className="mt-2"
              />
            )}
            <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-auto">
              {offered.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => add({ key: f.key, name: f.name })}
                  className="rounded-full border bg-muted px-2.5 py-1 text-xs hover:bg-accent"
                >
                  + {f.name}
                </button>
              ))}
              {offered.length === 0 && (
                <p className="px-1 text-xs text-muted-foreground">
                  {search.trim() ? 'No field matches.' : 'Every field is already in the list.'}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
