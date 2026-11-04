import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, type Choice, type EditField, type User } from '@/lib/api'
import { useDebounced } from '@/lib/useDebounced'
import { cn } from '@/lib/utils'
import { parseLabels, type Draft, type Person } from './edits'

const unique = (list: string[]) => [...new Set(list)]

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs hover:bg-accent',
        active && 'border-primary bg-primary/10 text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function Chip({ label, removeLabel, onRemove }: { label: string; removeLabel: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
      {label}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

/** "Add" and "Remove" rows share this layout: a verb, then whatever picks the values. */
function VerbRow({ id, verb, children }: { id: string; verb: 'Add' | 'Remove'; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-start gap-2">
      <label htmlFor={id} className="pt-1 text-sm text-muted-foreground">
        {verb}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Labels as chips, typed in a field: Enter, comma or space turns what was typed into a chip. */
function LabelList({
  id,
  labels,
  draft,
  placeholder,
  onLabels,
  onDraft,
}: {
  id: string
  labels: string[]
  draft: string
  placeholder: string
  onLabels: (labels: string[]) => void
  onDraft: (draft: string) => void
}) {
  const commit = () => {
    onLabels(unique([...labels, ...parseLabels(draft)]))
    onDraft('')
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.key === 'Enter' && draft.trim()) || e.key === ',' || e.key === ' ') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && !draft && labels.length > 0) {
      onLabels(labels.slice(0, -1))
    }
  }

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
      {labels.map((label) => (
        <Chip
          key={label}
          label={label}
          removeLabel={`Remove ${label}`}
          onRemove={() => onLabels(labels.filter((l) => l !== label))}
        />
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={labels.length === 0 ? placeholder : ''}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}

/** The chosen options as chips, and a menu for the others. */
function ChoiceList({
  id,
  options,
  chosen,
  taken,
  verb,
  onChange,
}: {
  id: string
  options: Choice[]
  chosen: string[]
  /** Options chosen in the other list: they can't be added and removed at once */
  taken: string[]
  verb: 'add' | 'remove'
  onChange: (ids: string[]) => void
}) {
  const left = options.filter((o) => !chosen.includes(o.id) && !taken.includes(o.id))
  const nameOf = (optionId: string) => options.find((o) => o.id === optionId)?.name ?? optionId

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chosen.map((optionId) => (
        <Chip
          key={optionId}
          label={nameOf(optionId)}
          removeLabel={`Don't ${verb} ${nameOf(optionId)}`}
          onRemove={() => onChange(chosen.filter((c) => c !== optionId))}
        />
      ))}
      <select
        id={id}
        value=""
        disabled={left.length === 0}
        onChange={(e) => e.target.value && onChange([...chosen, e.target.value])}
        className="h-7 max-w-full rounded-md border border-input bg-background px-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        <option value="">{left.length === 0 ? 'None left' : 'Choose…'}</option>
        {left.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  )
}

/** A search field for people who can be assigned issues in the projects, listing matches under it. */
function UserSearch({
  id,
  projectKeys,
  exclude = [],
  onPick,
}: {
  id: string
  projectKeys: string[]
  exclude?: string[]
  onPick: (user: User) => void
}) {
  const [text, setText] = useState('')
  const search = useDebounced(text.trim(), 250)
  const users = useQuery({
    queryKey: ['assignable', projectKeys.join(','), search],
    queryFn: () => api.searchAssignableUsers(projectKeys, search),
    enabled: search.length > 0,
    staleTime: 60_000,
  })
  const waiting = text.trim() !== search || users.isFetching
  const results = users.data?.filter((u) => !exclude.includes(u.accountId))

  return (
    <div className="space-y-2">
      <Input id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder="Search a person…" />
      {search.length > 0 && (
        <div className="max-h-40 overflow-auto rounded-md border">
          {waiting && !users.data ? (
            <div className="flex justify-center p-2">
              <Spinner className="size-4" />
            </div>
          ) : users.error ? (
            <p className="p-2 text-sm text-destructive">{users.error.message}</p>
          ) : results?.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">
              No one found who can be assigned in {projectKeys.length > 1 ? 'all these projects' : projectKeys[0]}.
            </p>
          ) : (
            <ul>
              {results?.map((user) => (
                <li key={user.accountId}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(user)
                      setText('')
                    }}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" className="size-5 rounded-full" />
                    ) : (
                      <span className="size-5 rounded-full bg-muted" />
                    )}
                    <span className="truncate">{user.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** One person: me, nobody, or someone found by name. */
function UserPicker({
  id,
  nobodyLabel,
  projectKeys,
  me,
  value,
  onChange,
}: {
  id: string
  /** The choice that clears the field; left out when the field can't be empty */
  nobodyLabel?: string
  projectKeys: string[]
  me: { accountId: string; displayName: string }
  value: Person | null
  onChange: (value: Person | null) => void
}) {
  const pick = (next: Person) => onChange(value?.accountId === next.accountId ? null : next)
  const someoneElse = value && value.accountId !== null && value.accountId !== me.accountId

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill active={value?.accountId === me.accountId} onClick={() => pick({ accountId: me.accountId, name: 'you' })}>
          Me
        </Pill>
        {nobodyLabel && (
          <Pill active={value !== null && value.accountId === null} onClick={() => pick({ accountId: null, name: '' })}>
            {nobodyLabel}
          </Pill>
        )}
        {someoneElse && (
          <Pill active onClick={() => onChange(null)}>
            {value.name} ×
          </Pill>
        )}
      </div>
      <UserSearch id={id} projectKeys={projectKeys} onPick={(u) => onChange({ accountId: u.accountId, name: u.displayName })} />
    </div>
  )
}

/** What the person will see as the value of the field, e.g. "Will be cleared". */
function Note({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs text-muted-foreground">{children}</p>
}

/**
 * The editor for one field, chosen by the kind of field Jira says it is. `draft` is what has been
 * filled in so far; `onDraft` merges changes into it.
 */
export function FieldEditor({
  field,
  draft,
  problem,
  autoFocus,
  required = false,
  issueCount = 1,
  projectKeys,
  me,
  onDraft,
}: {
  field: EditField
  draft: Draft
  problem: string | null
  /** Whether the editor takes the focus when it appears */
  autoFocus: boolean
  /** The field can't be left empty: no way to clear it */
  required?: boolean
  /** How many tickets the value goes to, for the wording of a few notes */
  issueCount?: number
  projectKeys: string[]
  me: { accountId: string; displayName: string }
  onDraft: (patch: Partial<Draft>) => void
}) {
  const id = `bulk-${field.key}`
  const cleared = draft.touched && draft.value.trim() === ''

  // Text, number and date: typing sets the value, "Clear it" empties it on every ticket
  const clearable = (control: ReactNode) => (
    <>
      <div className="flex items-center gap-2">
        {control}
        {!required && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onDraft({ value: '', touched: true })}>
            Clear it
          </Button>
        )}
      </div>
      {required ? (
        problem && <p className="mt-1 text-xs text-destructive">{problem}</p>
      ) : problem ? (
        <p className="mt-1 text-xs text-destructive">{problem}</p>
      ) : (
        <Note>{cleared ? 'Will be cleared on every ticket.' : draft.touched ? 'Will be set on every ticket.' : 'Not changed yet.'}</Note>
      )}
    </>
  )

  switch (field.kind) {
    case 'choice':
      return (
        <select
          id={id}
          value={draft.value}
          onChange={(e) => onDraft({ value: e.target.value })}
          autoFocus={autoFocus}
          className={SELECT_CLASS}
        >
          <option value="">Choose…</option>
          {field.choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )

    case 'choices':
      return (
        <div className="space-y-2">
          {(['add', 'remove'] as const).map((verb) => (
            <VerbRow key={verb} id={`${id}-${verb}`} verb={verb === 'add' ? 'Add' : 'Remove'}>
              <ChoiceList
                id={`${id}-${verb}`}
                options={field.choices}
                chosen={draft[verb]}
                taken={draft[verb === 'add' ? 'remove' : 'add']}
                verb={verb}
                onChange={(ids) => onDraft({ [verb]: ids })}
              />
            </VerbRow>
          ))}
        </div>
      )

    case 'labels':
      return (
        <div className="space-y-2">
          <VerbRow id={`${id}-add`} verb="Add">
            <LabelList
              id={`${id}-add`}
              labels={draft.add}
              draft={draft.addText}
              placeholder="backend, urgent… (Enter, comma or space after each)"
              onLabels={(add) => onDraft({ add })}
              onDraft={(addText) => onDraft({ addText })}
            />
          </VerbRow>
          <VerbRow id={`${id}-remove`} verb="Remove">
            <LabelList
              id={`${id}-remove`}
              labels={draft.remove}
              draft={draft.removeText}
              placeholder="legacy…"
              onLabels={(remove) => onDraft({ remove })}
              onDraft={(removeText) => onDraft({ removeText })}
            />
          </VerbRow>
          {problem && <p className="text-xs text-destructive">{problem}</p>}
        </div>
      )

    case 'text':
      return clearable(
        <Input
          id={id}
          value={draft.value}
          onChange={(e) => onDraft({ value: e.target.value, touched: true })}
          autoFocus={autoFocus}
        />,
      )

    case 'longText':
      return (
        <textarea
          id={id}
          value={draft.value}
          onChange={(e) => onDraft({ value: e.target.value, touched: true })}
          rows={4}
          autoFocus={autoFocus}
          className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      )

    case 'timeSpent':
      return (
        <>
          <Input
            id={id}
            value={draft.value}
            onChange={(e) => onDraft({ value: e.target.value, touched: true })}
            placeholder="1h 30m, 2d"
            aria-invalid={!!problem}
            className="w-44"
            autoFocus={autoFocus}
          />
          {problem ? (
            <p className="mt-1 text-xs text-destructive">{problem}</p>
          ) : (
            <Note>Logged as work on {issueCount === 1 ? 'the ticket' : 'each ticket'}.</Note>
          )}
        </>
      )

    case 'number':
      return clearable(
        <Input
          id={id}
          inputMode="decimal"
          value={draft.value}
          onChange={(e) => onDraft({ value: e.target.value, touched: true })}
          aria-invalid={!!problem}
          className="w-44"
          autoFocus={autoFocus}
        />,
      )

    case 'date':
      return clearable(
        <Input
          id={id}
          type="date"
          value={draft.value}
          onChange={(e) => onDraft({ value: e.target.value, touched: true })}
          className="w-44 dark:scheme-dark"
          autoFocus={autoFocus}
        />,
      )

    case 'user':
      return (
        <UserPicker
          id={id}
          nobodyLabel={required ? undefined : field.key === 'assignee' ? 'Unassigned' : 'Nobody'}
          projectKeys={projectKeys}
          me={me}
          value={draft.user}
          onChange={(user) => onDraft({ user })}
        />
      )

    case 'users':
      return (
        <div className="space-y-2">
          {(['add', 'remove'] as const).map((verb) => {
            const other = verb === 'add' ? 'remove' : 'add'
            return (
              <VerbRow key={verb} id={`${id}-${verb}`} verb={verb === 'add' ? 'Add' : 'Remove'}>
                <div className="space-y-2">
                  {draft[verb].length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {draft[verb].map((accountId) => (
                        <Chip
                          key={accountId}
                          label={draft.names[accountId] ?? accountId}
                          removeLabel={`Don't ${verb} ${draft.names[accountId] ?? accountId}`}
                          onRemove={() => onDraft({ [verb]: draft[verb].filter((a) => a !== accountId) })}
                        />
                      ))}
                    </div>
                  )}
                  <UserSearch
                    id={`${id}-${verb}`}
                    projectKeys={projectKeys}
                    exclude={draft[verb]}
                    onPick={(user) =>
                      onDraft({
                        [verb]: [...draft[verb], user.accountId],
                        // Added and removed at once makes no sense: the latest choice wins
                        [other]: draft[other].filter((a) => a !== user.accountId),
                        names: { ...draft.names, [user.accountId]: user.displayName },
                      })
                    }
                  />
                </div>
              </VerbRow>
            )
          })}
        </div>
      )

    case 'parent':
      return (
        <>
          <Input
            id={id}
            value={draft.value}
            onChange={(e) => onDraft({ value: e.target.value.toUpperCase(), touched: true })}
            placeholder="Epic or ticket to put them under, e.g. ABC-123"
            aria-invalid={!!problem}
            autoFocus={autoFocus}
          />
          {problem && <p className="mt-1 text-xs text-destructive">{problem}</p>}
        </>
      )
  }
}
