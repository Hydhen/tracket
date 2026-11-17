import { X } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { UserSearch } from '@/features/bulk/fieldEditors'
import { useIssues, viewJql } from '@/features/issues/useIssues'
import { MAX_FAVORITE_ASSIGNEES, useFavoriteAssignees } from './favoriteAssignees'

/**
 * The people offered first when tickets are dropped on "Assign to…". Who can be assigned depends on the Jira
 * project, so the search reads it from the project of your most recent open ticket.
 */
export function AssigneeSettings() {
  const { people, add, remove } = useFavoriteAssignees()
  const issues = useIssues(viewJql('open'))
  const projectKey = issues.data?.issues[0]?.projectKey
  const full = people.length >= MAX_FAVORITE_ASSIGNEES

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Favorite assignees</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Up to {MAX_FAVORITE_ASSIGNEES} people offered first when you drag tickets onto "Assign to…". Anyone else can
        still be searched for there.
      </p>

      <ul className="mt-3 space-y-1.5">
        {people.length === 0 && <li className="text-sm text-muted-foreground">None yet.</li>}
        {people.map((person) => (
          <li key={person.accountId} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
            {person.avatarUrl ? (
              <img src={person.avatarUrl} alt="" className="size-6 rounded-full" />
            ) : (
              <span className="size-6 rounded-full bg-muted" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm">{person.displayName}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${person.displayName}`}
              onClick={() => remove(person.accountId)}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>

      <div className="mt-3 rounded-md border border-dashed p-2">
        <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Add a person</div>
        <div className="mt-2 px-1">
          {full ? (
            <p className="text-sm text-muted-foreground">
              That's {MAX_FAVORITE_ASSIGNEES} favorites: remove one to add someone else.
            </p>
          ) : issues.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Reading your tickets…
            </div>
          ) : !projectKey ? (
            <p className="text-sm text-muted-foreground">
              No open ticket to tell which project to look for people in.
            </p>
          ) : (
            <>
              <UserSearch
                id="favorite-assignee-search"
                projectKeys={[projectKey]}
                exclude={people.map((p) => p.accountId)}
                onPick={add}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">People who can be assigned in {projectKey}.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
