import { openUrl } from '@tauri-apps/plugin-opener'
import { keepPreviousData, useIsFetching, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  ExternalLink,
  Film,
  Image as ImageIcon,
  ListTree,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSession } from '@/features/auth/useSession'
import { useMediaViewer } from '@/features/media/useMediaViewer'
import { BOARD_ISSUES } from '@/features/board/useBoard'
import { JiraHtml } from '@/components/JiraHtml'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import {
  fieldLabel,
  isJiraField,
  jiraKeyOf,
  useTicketFields,
  type BuiltinFieldId,
} from '@/features/settings/ticketFields'
import { useChildren } from '@/features/tree/useTree'
import { workPrompt } from '@/features/workspace/prompt'
import { LauncherOutline } from '@/features/workspace/LauncherOutline'
import { launcherName, useLauncher, type LauncherId } from '@/features/workspace/launcher'
import { useProjects } from '@/features/workspace/repos'
import { fieldsUsed, pickProject, PROJECT_FIELD, type FieldValues } from '@/features/workspace/routing'
import { api, ApiError, type IssueSummary, type Person, type Worktree } from '@/lib/api'
import { copyText, useCopyPopup } from '@/lib/clipboard'
import { mediaUrl } from '@/lib/html'
import { formatDay, isOverdue, timeAgo } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { CommentEditor } from './CommentEditor'
import { DescriptionEditor } from './DescriptionEditor'
import { Icon } from './IssueList'
import { isWideValue } from './fieldValue'
import { JiraFieldValue } from './JiraFieldValue'
import { TimeTracker } from '@/features/timer/TimeTracker'
import { StatusMenu } from '@/features/transitions/StatusMenu'
import { useTicketMoves } from '@/features/transitions/movesContext'
import { StatusPill } from './StatusPill'
import { TicketKey } from './TicketKey'
import { TicketActionsContext } from './ticketActions'
import { useIssueDetail } from './useIssueDetail'

/** What is kept of one ticket: reloaded by the refresh button */
const TICKET_QUERIES = ['issue', 'field-values', 'routing-values', 'transitions', 'edit-meta', 'children']
/** The lists the ticket's own fields (status, priority, summary…) are read from */
const LIST_QUERIES = ['issues', 'search', 'tree-roots', 'children', BOARD_ISSUES]

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-full')}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  )
}

function PersonLabel({ person }: { person: Person | null | undefined }) {
  if (!person) return <span className="text-muted-foreground">Unassigned</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      {person.avatarUrl && <img src={person.avatarUrl} alt="" className="size-5 rounded-full" />}
      <span className="truncate">{person.displayName}</span>
    </span>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** The attachments that can be looked at in the viewer */
function mediaKind(mimeType: string): 'image' | 'video' | null {
  if (mimeType.startsWith('video/')) return 'video'
  // An SVG can carry scripts of its own: it stays a file
  if (mimeType.startsWith('image/') && !mimeType.startsWith('image/svg')) return 'image'
  return null
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</h2>
}

export function IssueDetail({
  issue,
  site,
  onOpenIssue,
  onOpenAsTree,
  isTreeRoot,
}: {
  issue: IssueSummary
  site: string
  /** Opens a child ticket, in the side view when `side` is true */
  onOpenIssue: (issue: IssueSummary, side: boolean) => void
  /** Shows this ticket and its children in the Tree view */
  onOpenAsTree: (issue: IssueSummary) => void
  /** Already a root of the tree, so the button only needs to bring the tree up */
  isTreeRoot: boolean
}) {
  const { data: detail, error, isPending } = useIssueDetail(issue.key, issue.updated)
  const children = useChildren(issue.key, issue.canHaveChildren)
  const childIssues = children.data?.issues ?? []
  // Collapsed by default: long threads would push everything else off screen
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [commenting, setCommenting] = useState(false)
  const [editingComment, setEditingComment] = useState<string | null>(null)
  // Jira only lets people edit their own comments
  const myAccountId = useSession().data?.accountId

  // Worktree + the chosen app (VS Code or herdr), in the folder of the project the ticket belongs to
  // The project the ticket belongs to says where to work: the metadata that identify projects are
  // read off the ticket ahead of the click, so the button can say where it goes
  const projects = useProjects((s) => s.projects)
  const routingFields = fieldsUsed(projects)
  const queryClient = useQueryClient()
  const routingValues = (fields: string[]) => ({
    queryKey: ['routing-values', issue.key, issue.updated, fields.join(',')],
    queryFn: () => api.getFieldValues(issue.key, fields),
    staleTime: 60_000,
  })
  // The Jira project is already known, the rest comes from Jira
  const projectOf = (fetched: FieldValues) => pickProject(projects, { ...fetched, [PROJECT_FIELD]: [issue.projectKey] })
  const routing = useQuery({ ...routingValues(routingFields), enabled: routingFields.length > 0 })
  const target = routingFields.length === 0 || routing.data ? projectOf(routing.data ?? {}) : undefined

  const { linkRepo } = useContext(TicketActionsContext)
  const moves = useTicketMoves()

  const isOfTicket = (key: readonly unknown[]) => TICKET_QUERIES.includes(key[0] as string) && key[1] === issue.key
  const refreshing = useIsFetching({ predicate: (q) => isOfTicket(q.queryKey) }) > 0
  // Asks Jira again for everything shown about the ticket, and for the lists that hold its summary fields
  const refresh = () => {
    void queryClient.invalidateQueries({ predicate: (q) => isOfTicket(q.queryKey) })
    void queryClient.invalidateQueries({ predicate: (q) => LIST_QUERIES.includes(q.queryKey[0] as string) })
  }
  const app = useLauncher((s) => s.app)
  const appName = launcherName(app)
  const startWork = useMutation<
    { worktree: Worktree; app: LauncherId; promptSent: boolean; alreadyOpen: boolean },
    ApiError
  >({
    mutationFn: async () => {
      const values = routingFields.length > 0 ? await queryClient.fetchQuery(routingValues(routingFields)) : {}
      const project = projectOf(values)
      if (!project) {
        throw new ApiError('unexpected', 'No project in the settings has the metadata of this ticket. Add one, or change its metadata.')
      }
      const worktree = await api.createWorktree(project.path, issue.key)
      if (app === 'herdr') {
        // Claude Code is started there with the prompt, so there is nothing to paste
        const launch = await api.openInHerdr(worktree.folder, issue.key, workPrompt(issue, site))
        return { worktree, app, promptSent: launch.promptSent, alreadyOpen: launch.alreadyOpen }
      }
      await api.openInVscode(worktree.folder)
      return { worktree, app, promptSent: false, alreadyOpen: false }
    },
  })
  const copyPopup = useCopyPopup()

  // The big title scrolled under the top row: the row shows the title itself from then on
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [titleScrolled, setTitleScrolled] = useState(false)
  useEffect(() => {
    const title = titleRef.current
    if (!title) return
    // What scrolls is the pane around the ticket; the top row covers its first 45px
    const observer = new IntersectionObserver(([entry]) => setTitleScrolled(!entry.isIntersecting), {
      root: title.closest('main, aside'),
      rootMargin: '-45px 0px 0px 0px',
    })
    observer.observe(title)
    return () => observer.disconnect()
  }, [])

  // For VS Code the prompt is copied first, on the click itself: the clipboard is only reachable
  // while this window has the focus, and the app takes it as soon as it opens
  const onStartWork = (anchor: Element) => {
    // No project for this ticket (none at all, or none with its metadata): the settings offer to add one for it
    const resolved = routingFields.length === 0 || !!routing.data
    if (projects.length === 0 || (resolved && !target)) return linkRepo(issue.projectKey)
    if (app === 'vscode') void copyText(workPrompt(issue, site)).then((ok) => ok && copyPopup.show(anchor))
    startWork.mutate()
  }

  // Which fields to show, and in what order, is chosen in the settings
  const shownFields = useTicketFields((s) => s.fields).filter((f) => f.visible)

  // Fields of the user's Jira (custom ones included) are read live: again whenever the ticket changes
  const jiraKeys = shownFields.filter((f) => isJiraField(f.id)).map((f) => jiraKeyOf(f.id))
  const jiraValues = useQuery({
    queryKey: ['field-values', issue.key, issue.updated, jiraKeys.join(',')],
    queryFn: () => api.getFieldValues(issue.key, jiraKeys),
    enabled: jiraKeys.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })

  const fieldValues: Record<BuiltinFieldId, ReactNode> = {
    status: <StatusMenu issue={issue} />,
    priority: issue.priority?.name ?? '—',
    due: issue.dueDate ? (
      <span className={cn(isOverdue(issue.dueDate) && 'font-medium text-destructive')}>
        {formatDay(issue.dueDate)}
      </span>
    ) : (
      '—'
    ),
    assignee: <PersonLabel person={detail?.assignee} />,
    reporter: <PersonLabel person={detail?.reporter} />,
    updated: timeAgo(issue.updated),
    // Nothing until the detail has loaded, so a dash doesn't flash before the real value
    labels: detail ? (
      detail.labels.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {detail.labels.map((label) => (
            <span key={label} className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {label}
            </span>
          ))}
        </span>
      ) : (
        '—'
      )
    ) : null,
    project: issue.projectKey,
    created: detail ? (
      <span title={new Date(detail.created).toLocaleString()}>{timeAgo(detail.created)}</span>
    ) : null,
  }

  // Newest first: the latest comment is usually what you came for
  const comments = detail ? [...detail.comments].reverse() : []

  return (
    // The padding is here rather than on the pane that scrolls: a row that sticks at the top then sticks flush with it
    <div className="px-6 pb-16 pt-4">
      <div className="mx-auto max-w-3xl">
        {/*
          Stays at the top while the ticket scrolls, on one row: the key, the title once the big one has scrolled away
          (it shrinks to what is left), and the buttons. It reaches over the sides' padding (-mx-6) so that nothing shows
          around it.
        */}
        <div
          className={cn(
            // 45px, border included: the height of the search bar of the sidebar, so that their bottom borders line up
            'sticky top-0 z-10 -mx-6 box-border flex h-[45px] items-center bg-background px-6',
            titleScrolled && 'border-b shadow-sm',
          )}
        >
          <div className="flex w-full items-center gap-2 text-sm text-muted-foreground">
            <TicketKey issueKey={issue.key} className="font-medium" />
            <span>·</span>
            <span className="shrink-0">{issue.issueType.name}</span>
            {detail?.parent && (
              <>
                <span>·</span>
                <TicketKey
                  issueKey={detail.parent.key}
                  title={`${detail.parent.summary}\nClick to copy · Ctrl+click to open in the side view`}
                />
              </>
            )}
            {titleScrolled && (
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={issue.summary}>
                {issue.summary}
              </span>
            )}
            <div className="ml-auto flex shrink-0 gap-1">
              <Button
                variant="outline"
                size="icon"
                title={
                  projects.length === 0
                    ? 'Set up a project to start working'
                    : target
                      ? `Start working in ${target.name} (${target.path}): worktree and ${appName}`
                      : routing.isPending && routingFields.length > 0
                        ? `Start working: worktree and ${appName}`
                        : 'No project has the metadata of this ticket yet: see the settings'
                }
                aria-label="Start working on this ticket"
                disabled={startWork.isPending}
                onClick={(e) => onStartWork(e.currentTarget)}
              >
                {startWork.isPending ? <Spinner /> : <LauncherOutline id={app} className="size-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                title="Edit metadata"
                aria-label="Edit metadata"
                onClick={() => moves.edit([issue])}
              >
                <SlidersHorizontal className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                title="Refresh this ticket"
                aria-label="Refresh this ticket"
                disabled={refreshing}
                onClick={refresh}
              >
                <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
              </Button>
              {childIssues.length > 0 && (
                <Button
                  variant="outline"
                  size="icon"
                  title={isTreeRoot ? 'Show in tree' : 'Open as tree'}
                  aria-label={isTreeRoot ? 'Show in tree' : 'Open as tree'}
                  onClick={() => onOpenAsTree(issue)}
                >
                  <ListTree className="size-3.5" />
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                title="Open in Jira"
                aria-label="Open in Jira"
                onClick={() => openUrl(issue.url)}
              >
                <ExternalLink className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
        <h1 ref={titleRef} className="mt-2 text-xl font-semibold">
          {issue.summary}
        </h1>

        {copyPopup.popup}

        <div role="status" className="empty:hidden">
          {startWork.isPending && (
            <p className="mt-2 text-xs text-muted-foreground">Setting up the worktree and opening {appName}…</p>
          )}
          {startWork.data && (
            <p className="mt-2 text-xs text-muted-foreground">
              Worktree {startWork.data.worktree.created ? 'created' : 'already there'} at {startWork.data.worktree.path}.{' '}
              {startWork.data.app === 'herdr' ? (
                startWork.data.alreadyOpen ? (
                  'It is already open in herdr: showing it instead of opening another.'
                ) : startWork.data.promptSent ? (
                  'Claude Code was started in herdr with the prompt.'
                ) : (
                  <>
                    herdr couldn't hand the prompt to Claude Code.{' '}
                    <button
                      type="button"
                      className="underline hover:text-foreground"
                      onClick={(e) => {
                        const anchor = e.currentTarget
                        void copyText(workPrompt(issue, site)).then((ok) => ok && copyPopup.show(anchor))
                      }}
                    >
                      Copy it
                    </button>{' '}
                    to paste there.
                  </>
                )
              ) : (
                'The prompt for Claude Code is on your clipboard.'
              )}
            </p>
          )}
          {startWork.error && <p className="mt-2 text-xs text-destructive">{startWork.error.message}</p>}
        </div>

        {shownFields.length > 0 && (
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {shownFields.map((field) => {
              if (!isJiraField(field.id)) {
                return (
                  <Field key={field.id} label={fieldLabel(field)}>
                    {fieldValues[field.id as BuiltinFieldId]}
                  </Field>
                )
              }
              const values = jiraValues.data?.[jiraKeyOf(field.id)]
              return (
                <Field key={field.id} label={fieldLabel(field)} wide={!!values && isWideValue(values)}>
                  {jiraValues.error ? (
                    <span className="text-destructive" title={jiraValues.error.message}>
                      Unavailable
                    </span>
                  ) : values ? (
                    <JiraFieldValue values={values} />
                  ) : null}
                </Field>
              )
            })}
          </dl>
        )}

        <TimeTracker issueKey={issue.key} />

        {isPending && (
          <div className="mt-8 flex justify-center">
            <Spinner className="size-5" />
          </div>
        )}
        {error && <p className="mt-8 text-sm text-destructive">{error.message}</p>}

        {detail && (
          <>
            <section className="group/description mt-8">
              <div className="mb-2 flex items-center gap-1">
                <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</h2>
                {!editingDescription && (
                  <button
                    onClick={() => setEditingDescription(true)}
                    title="Edit description"
                    aria-label="Edit description"
                    className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/description:opacity-100"
                  >
                    <Pencil className="size-3" />
                  </button>
                )}
              </div>
              {editingDescription ? (
                <DescriptionEditor issueKey={issue.key} onDone={() => setEditingDescription(false)} />
              ) : detail.descriptionHtml ? (
                <JiraHtml html={detail.descriptionHtml} site={site} attachments={detail.attachments} />
              ) : (
                <p className="text-sm text-muted-foreground">No description.</p>
              )}
            </section>

            {childIssues.length > 0 && (
              <section className="mt-8">
                <SectionTitle>
                  Children · {childIssues.length}
                  {children.data?.hasMore && '+'}
                </SectionTitle>
                <ul className="-mx-2">
                  {childIssues.map((child) => (
                    <li key={child.id}>
                      <button
                        // Ctrl/Cmd+click opens the child in the side view
                        onClick={(e) => onOpenIssue(child, e.ctrlKey || e.metaKey)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
                      >
                        <Icon url={child.issueType.iconUrl} />
                        <TicketKey
                          issueKey={child.key}
                          nested
                          className="shrink-0 text-xs font-medium text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{child.summary}</span>
                        <StatusPill status={child.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {detail.attachments.length > 0 && (
              <section className="mt-8">
                <SectionTitle>Attachments · {detail.attachments.length}</SectionTitle>
                <ul className="space-y-1">
                  {detail.attachments.map((a) => {
                    const kind = mediaKind(a.mimeType)
                    const Kind = kind === 'video' ? Film : kind === 'image' ? ImageIcon : Paperclip
                    const original = `${site}/rest/api/3/attachment/content/${a.id}`
                    return (
                      <li key={a.id} className="flex items-center gap-1">
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
                          title={kind ? 'Look at it here' : 'Open it in the browser'}
                          // A picture or a video is looked at here; any other file goes to the browser
                          onClick={() =>
                            kind
                              ? useMediaViewer
                                  .getState()
                                  .open({ kind, src: mediaUrl(`/rest/api/3/attachment/content/${a.id}`), title: a.filename })
                              : openUrl(original)
                          }
                        >
                          <Kind className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{a.filename}</span>
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatSize(a.size)}</span>
                        </button>
                        {kind && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="Open in the browser"
                            aria-label={`Open ${a.filename} in the browser`}
                            onClick={() => openUrl(original)}
                          >
                            <ExternalLink />
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            <section className="mt-8">
              <div className="mb-2 flex items-center">
                <button
                  onClick={() => setCommentsOpen((open) => !open)}
                  aria-expanded={commentsOpen}
                  className="-ml-1 flex items-center gap-1 rounded px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className={cn('size-4 transition-transform', commentsOpen && 'rotate-90')} />
                  Comments · {comments.length}
                </button>
                {!commenting && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      // The new comment is the point, so the thread opens with the editor
                      setCommentsOpen(true)
                      setCommenting(true)
                    }}
                  >
                    <MessageSquarePlus />
                    Add comment
                  </Button>
                )}
              </div>
              {commenting && <CommentEditor issueKey={issue.key} onDone={() => setCommenting(false)} />}
              {commentsOpen && comments.length === 0 && !commenting && (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              )}
              <ul className="space-y-5">
                {/* Not rendered while collapsed, so their images aren't fetched either */}
                {(commentsOpen ? comments : []).map((c) => (
                  <li key={c.id} className="group/comment flex gap-3">
                    {c.author?.avatarUrl ? (
                      <img src={c.author.avatarUrl} alt="" className="mt-0.5 size-7 shrink-0 rounded-full" />
                    ) : (
                      <div className="mt-0.5 size-7 shrink-0 rounded-full bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 text-sm">
                        <span className="font-medium">{c.author?.displayName ?? 'Unknown'}</span>
                        <span className="text-xs text-muted-foreground" title={new Date(c.created).toLocaleString()}>
                          {timeAgo(c.created)}
                          {c.updated !== c.created && ' · edited'}
                        </span>
                        {editingComment !== c.id && myAccountId && c.author?.accountId === myAccountId && (
                          <button
                            onClick={() => setEditingComment(c.id)}
                            title="Edit comment"
                            aria-label="Edit comment"
                            className="self-center rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/comment:opacity-100"
                          >
                            <Pencil className="size-3" />
                          </button>
                        )}
                      </div>
                      {editingComment === c.id ? (
                        <div className="mt-2">
                          <CommentEditor issueKey={issue.key} commentId={c.id} onDone={() => setEditingComment(null)} />
                        </div>
                      ) : (
                        <JiraHtml html={c.bodyHtml} site={site} attachments={detail.attachments} className="mt-1" />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
