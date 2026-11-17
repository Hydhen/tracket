import { ChevronRight, GripVertical, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSession } from '@/features/auth/useSession'
import type { EditField } from '@/lib/api'
import { cn } from '@/lib/utils'
import { type DefaultField, type DefaultsStore } from './defaultFields'
import { describeDraft, emptyDraft, fieldProblem } from './edits'
import { FieldEditor } from './fieldEditors'

/**
 * The fields a dialog starts with, and what they are filled in with: the list to edit (`useDefaults`) and the fields to
 * choose from (`catalog`, which depends on the Jira site, so the caller reads it from tickets).
 */
export function FieldDefaultsEditor({
  title,
  intro,
  noneMessage,
  useDefaults,
  catalog,
  loading,
  loadingMessage,
  emptyMessage,
  projectKeys,
}: {
  title: string
  intro: string
  /** What the empty list means */
  noneMessage: string
  useDefaults: DefaultsStore
  catalog: EditField[]
  loading: boolean
  loadingMessage: string
  /** Shown when there is nothing to choose from */
  emptyMessage: string
  /** Where the people offered for a user field can be assigned */
  projectKeys: string[]
}) {
  const { fields, add, remove, moveTo, setValue, set } = useDefaults()
  const [search, setSearch] = useState('')
  // The field whose default value is being edited
  const [openKey, setOpenKey] = useState<string>()
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  // Set by keyboard moves: the row re-renders in a new spot, and focus must follow it
  const refocusKey = useRef<string | null>(null)

  const session = useSession().data

  const offered = catalog.filter(
    (f) => !fields.some((d) => d.key === f.key) && f.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  // While dragging, the row follows the pointer: once it passes the middle of its neighbour, they trade places.
  // Listening on the window (not the row) survives the rows being re-mounted as they shift. Comparing with the
  // neighbour's middle (not asking which row is under the pointer) keeps rows of different heights from flipping back and forth.
  useEffect(() => {
    if (!draggingKey) return

    const onMove = (e: globalThis.PointerEvent) => {
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])
      const at = rows.findIndex((row) => row.dataset.row === draggingKey)
      if (at < 0) return
      const middle = (row?: HTMLElement) => {
        if (!row) return undefined
        const r = row.getBoundingClientRect()
        return r.top + r.height / 2
      }
      const below = middle(rows[at + 1])
      const above = middle(rows[at - 1])
      if (below !== undefined && e.clientY > below) moveTo(draggingKey, at + 1)
      else if (above !== undefined && e.clientY < above) moveTo(draggingKey, at - 1)
    }
    const stop = () => setDraggingKey(null)

    document.body.style.cursor = 'grabbing'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [draggingKey, moveTo])

  useEffect(() => {
    if (!refocusKey.current) return
    listRef.current?.querySelector<HTMLElement>(`[data-handle="${refocusKey.current}"]`)?.focus()
    refocusKey.current = null
  }, [fields])

  const startDrag = (e: PointerEvent, key: string) => {
    if (e.button !== 0) return
    e.preventDefault() // no text selection while dragging
    setDraggingKey(key)
  }

  // Arrows move a row past its neighbour: the way to reorder without a pointer
  const onHandleKeyDown = (e: KeyboardEvent, key: string, at: number) => {
    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (!step || at + step < 0 || at + step >= fields.length) return
    e.preventDefault()
    refocusKey.current = key
    moveTo(key, at + step)
  }

  const toggle = (key: string) => setOpenKey((current) => (current === key ? undefined : key))

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{intro}</p>

      <ol ref={listRef} className={cn('mt-3 space-y-1.5', draggingKey && 'select-none')}>
        {fields.length === 0 && <li className="text-sm text-muted-foreground">{noneMessage}</li>}
        {fields.map((field, at) => (
          <DefaultRow
            key={field.key}
            field={field}
            // Jira's description of the field, when it has been read: needed to pick a value for it
            meta={catalog.find((f) => f.key === field.key)}
            catalogKnown={!loading && catalog.length > 0}
            open={openKey === field.key}
            dragging={field.key === draggingKey}
            anyDragging={draggingKey !== null}
            projectKeys={projectKeys}
            me={session ? { accountId: session.accountId, displayName: session.displayName } : undefined}
            onToggle={() => toggle(field.key)}
            onStartDrag={(e) => startDrag(e, field.key)}
            onHandleKeyDown={(e) => onHandleKeyDown(e, field.key, at)}
            onValue={(value) => setValue(field.key, value)}
            onRemove={() => remove(field.key)}
          />
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
            {loadingMessage}
          </div>
        ) : catalog.length === 0 ? (
          <p className="mt-2 px-1 text-sm text-muted-foreground">{emptyMessage}</p>
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
                  onClick={() => {
                    add({ key: f.key, name: f.name })
                    // Straight on to its value: that is what a field added here is for
                    setOpenKey(f.key)
                  }}
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

/** One default field: a drag handle, its name and value, and (opened) the editor for the value. */
function DefaultRow({
  field,
  meta,
  catalogKnown,
  open,
  dragging,
  anyDragging,
  projectKeys,
  me,
  onToggle,
  onStartDrag,
  onHandleKeyDown,
  onValue,
  onRemove,
}: {
  field: DefaultField
  meta: EditField | undefined
  /** Jira has been asked: a field missing from `meta` then isn't on the user's tickets */
  catalogKnown: boolean
  open: boolean
  dragging: boolean
  anyDragging: boolean
  projectKeys: string[]
  me: { accountId: string; displayName: string } | undefined
  onToggle: () => void
  onStartDrag: (e: PointerEvent) => void
  onHandleKeyDown: (e: KeyboardEvent) => void
  onValue: (value: DefaultField['value']) => void
  onRemove: () => void
}) {
  const draft = field.value ?? emptyDraft
  const summary = meta && field.value ? describeDraft(meta, field.value) : ''
  const editable = meta !== undefined && me !== undefined

  return (
    <li
      data-row={field.key}
      className={cn('rounded-md border bg-background', dragging && 'relative z-10 bg-accent shadow-md border-ring')}
    >
      <div className="flex items-center gap-1 px-1 py-1">
        <button
          type="button"
          data-handle={field.key}
          aria-label={`Move ${field.name}: drag it, or use the up and down arrow keys`}
          title="Drag to reorder"
          onPointerDown={onStartDrag}
          onKeyDown={onHandleKeyDown}
          className={cn(
            'touch-none rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
            anyDragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          aria-expanded={editable ? open : undefined}
          disabled={!editable}
          title={editable ? 'Choose the value this field starts with' : undefined}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left outline-none enabled:hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="shrink-0 text-sm">{field.name}</span>
          {summary && <span className="min-w-0 truncate text-sm text-muted-foreground">{summary}</span>}
          {!summary && editable && <span className="text-xs text-muted-foreground">no value</span>}
          {catalogKnown && !meta && (
            <span className="text-xs text-muted-foreground" title="Not found on your open tickets">
              not on your tickets
            </span>
          )}
          {editable && (
            <ChevronRight className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          )}
        </button>
        <Button variant="ghost" size="icon-xs" aria-label={`Remove ${field.name}`} onClick={onRemove}>
          <X />
        </Button>
      </div>

      {open && meta && me && (
        <div className="space-y-2 border-t px-3 py-3">
          <FieldEditor
            field={meta}
            draft={draft}
            problem={fieldProblem(meta, draft, [])}
            autoFocus
            projectKeys={projectKeys}
            me={me}
            onDraft={(patch) => onValue({ ...draft, ...patch })}
          />
          {field.value && (
            <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => onValue(undefined)}>
              Start with no value
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
