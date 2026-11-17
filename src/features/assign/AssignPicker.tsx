import { Search, X } from 'lucide-react'
import { useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type { IssueSummary, Person, User } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useFavoriteAssignees } from './favoriteAssignees'
import { useAssignableUsers } from './useAssignableUsers'

const GLOW = '#5eead4'
const TINT = '#10252a'

function Avatar({ user, className }: { user: User; className: string }) {
  return user.avatarUrl ? (
    <img src={user.avatarUrl} alt="" className={cn('shrink-0 rounded-full', className)} />
  ) : (
    <span className={cn('shrink-0 rounded-full bg-[#2e2e32]', className)} />
  )
}

/**
 * Where the tickets dropped on "Assign to…" go next: covers the detail pane like the drag overlay does, with the
 * favorite assignees on top and a search for anyone else below. A click on either assigns the tickets.
 * Esc and the cross close it (the controller takes care of Esc).
 */
export function AssignPicker({
  issues,
  onPick,
  onCancel,
}: {
  issues: IssueSummary[]
  onPick: (person: Person) => void
  onCancel: () => void
}) {
  const favorites = useFavoriteAssignees((s) => s.people)
  const [text, setText] = useState('')
  const [hover, setHover] = useState<string | null>(null)
  // The people who can be assigned in every project the tickets are in
  const projectKeys = [...new Set(issues.map((i) => i.projectKey))]
  const { searching, waiting, users, error } = useAssignableUsers(projectKeys, text)

  const what = issues.length > 1 ? `${issues.length} tickets` : (issues[0]?.key ?? '')

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Assign ${what} to`}
      // Dark whatever the theme, like the drag overlay it follows
      className="absolute inset-0 z-20 flex flex-col overflow-auto bg-[rgba(10,10,11,0.92)] px-6 py-8 text-[#f4f4f5] backdrop-blur-[6px]"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <button
        type="button"
        aria-label="Close"
        title="Close (Esc)"
        onClick={onCancel}
        className="absolute right-3 top-3 rounded-md p-1.5 text-[#a0a0a8] hover:bg-white/10 hover:text-[#f4f4f5]"
      >
        <X className="size-4" />
      </button>

      <div className="m-auto flex w-full max-w-xl flex-col items-center">
        <div className="text-center">
          <div className="text-xl font-bold tracking-tight">Assign {what} to…</div>
          <div className="mt-1.5 text-[13px] text-[#a0a0a8]">Pick a favorite, or search for someone else</div>
        </div>

        <div className="mt-6 flex w-full flex-wrap justify-center gap-3">
          {favorites.map((person) => {
            const on = hover === person.accountId
            return (
              <button
                key={person.accountId}
                type="button"
                onClick={() => onPick(person)}
                onMouseEnter={() => setHover(person.accountId)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(person.accountId)}
                onBlur={() => setHover(null)}
                className="box-border flex w-36 flex-col items-center gap-2 rounded-xl border px-3 py-4 text-center outline-none transition-[transform,box-shadow,background,border-color] duration-200"
                style={{
                  background: on ? TINT : '#17171a',
                  borderColor: on ? GLOW : '#2e2e32',
                  boxShadow: on ? `0 0 0 1px ${GLOW}, 0 0 32px ${GLOW}44` : 'none',
                  transform: on ? 'scale(1.05)' : 'scale(1)',
                }}
              >
                <Avatar user={person} className="size-10" />
                <span className="line-clamp-2 text-sm font-semibold">{person.displayName}</span>
              </button>
            )
          })}
          {favorites.length === 0 && (
            <p className="max-w-sm text-center text-[13px] text-[#a0a0a8]">
              No favorite yet. Add up to 5 people in Settings, under Favorite assignees, to find them here.
            </p>
          )}
        </div>

        <div className="mt-8 w-full max-w-sm">
          <label className="flex items-center gap-2 rounded-xl border border-dashed border-[#4b4570] px-3 py-2 focus-within:border-[#c4b5fd]">
            <Search className="size-4 shrink-0 text-[#a0a0a8]" />
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Someone else…"
              aria-label="Search a person"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#6f6f78]"
            />
          </label>

          {searching && (
            <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-[#2e2e32] bg-[#17171a]">
              {waiting && !users ? (
                <div className="flex justify-center p-3">
                  <Spinner className="size-4" />
                </div>
              ) : error ? (
                <p className="p-3 text-sm text-red-400">{error.message}</p>
              ) : users?.length === 0 ? (
                <p className="p-3 text-sm text-[#a0a0a8]">
                  No one found who can be assigned in {projectKeys.length > 1 ? 'all these projects' : projectKeys[0]}.
                </p>
              ) : (
                <ul>
                  {users?.map((user) => (
                    <li key={user.accountId}>
                      <button
                        type="button"
                        onClick={() => onPick(user)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
                      >
                        <Avatar user={user} className="size-5" />
                        <span className="truncate">{user.displayName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
