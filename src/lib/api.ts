import { invoke } from '@tauri-apps/api/core'

export interface Session {
  site: string
  email: string
  accountId: string
  displayName: string
  avatarUrl: string | null
}

export interface Named {
  name: string
  iconUrl: string | null
}

export interface IssueSummary {
  id: string
  key: string
  summary: string
  status: { id: string; name: string; category: 'new' | 'indeterminate' | 'done' }
  priority: Named | null
  issueType: Named
  /** False for sub-tasks */
  canHaveChildren: boolean
  projectKey: string
  assignee: Person | null
  parentKey: string | null
  /** YYYY-MM-DD */
  dueDate: string | null
  /** ISO 8601 */
  updated: string
  url: string
}

/** A move an issue can make from its current status */
export interface Transition {
  id: string
  name: string
  to: IssueSummary['status']
  /** What Jira insists on before this move (a resolution, a comment…), as editors to show */
  required: EditField[]
  /** The other fields of the move's screen: Jira's workflow can insist on some without saying so */
  optional: EditField[]
  /** Names of required fields that can't be filled in here: the move has to be made in Jira */
  unsupported: string[]
}

export interface RepoInfo {
  /** Root of the main working tree */
  root: string
  /** What new branches start from, e.g. `origin/main` */
  baseRef: string
  /** Where the folder given sits in the repository (`packages/api`), empty at its root */
  subpath: string
}

export interface HerdrLaunch {
  /** False when herdr started Claude Code but couldn't hand it the prompt, or when nothing was started (see `alreadyOpen`) */
  promptSent: boolean
  /** True when a space with Claude Code running was already open in the worktree: it was only brought to the front. A space without Claude Code gets a first tab that starts it (false) */
  alreadyOpen: boolean
}

export interface Worktree {
  /** The worktree itself: the whole repository, on the ticket's branch */
  path: string
  /** What to open: the project's folder inside the worktree */
  folder: string
  /** False when it already existed and was reused */
  created: boolean
}

/** What to do when the ticket's usual worktree folder can't just be used */
export type WorktreeStrategy =
  | { kind: 'reuse' }
  | { kind: 'replace' }
  /** Create it as `<base>/<repo>/<key>` */
  | { kind: 'elsewhere'; base: string }

export interface WorktreeConflict {
  /** `leftover`: a folder git doesn't know as a worktree. `branchElsewhere`: the branch is checked out in another worktree */
  kind: 'leftover' | 'branchElsewhere'
  /** The usual location, `<repo>/.claude/worktrees/<key>` */
  path: string
  /** Where git has the branch checked out, when it does */
  registeredAt: string | null
  /** A few names of what is in the usual folder */
  leftover: string[]
  /** Why each way out can't be taken, when it can't */
  replaceBlocked: string | null
  elsewhereBlocked: string | null
}

export type WorktreeOutcome =
  | { status: 'ready'; worktree: Worktree }
  | { status: 'conflict'; conflict: WorktreeConflict }

/** A value a field can take, e.g. one of the priorities of a project */
export interface Choice {
  id: string
  name: string
  iconUrl: string | null
}

/** A field of the user's Jira that a ticket's details can show */
export interface FieldRef {
  /** `customfield_10000`, `fixVersions`… */
  key: string
  /** As named in the user's Jira */
  name: string
}

/** What a field holds, which decides the editor it gets */
export type FieldKind =
  | 'choice'
  | 'choices'
  | 'text'
  /** Several lines; only on the screen of a transition (also the comment it asks for) */
  | 'longText'
  | 'number'
  /** A duration logged as work; only on the screen of a transition */
  | 'timeSpent'
  | 'date'
  | 'user'
  | 'users'
  | 'labels'
  | 'parent'

/** A field of an issue the current user can change, as Jira describes it (custom fields included) */
export interface EditField {
  /** `priority`, `labels`, `customfield_10000`… */
  key: string
  /** As named in the user's Jira */
  name: string
  kind: FieldKind
  /** What the issue accepts, for the kinds that pick from a list */
  choices: Choice[]
}

export interface User {
  accountId: string
  displayName: string
  avatarUrl: string | null
}

/** One change to make to a field of an issue; the fields not mentioned stay as they are */
export type FieldChange = { key: string } & (
  | { op: 'setChoice'; id: string }
  /** Empty text clears the field */
  | { op: 'setText'; text: string }
  | { op: 'setNumber'; number: number | null }
  /** YYYY-MM-DD */
  | { op: 'setDate'; day: string | null }
  /** `accountId: null` unassigns */
  | { op: 'setUser'; accountId: string | null }
  | { op: 'setParent'; issueKey: string }
  /** While moving a ticket */
  | { op: 'addComment'; text: string }
  | { op: 'addWorklog'; seconds: number }
  /** Labels are words, choices are option ids, users are account ids */
  | { op: 'modify'; items: 'labels' | 'choices' | 'users'; add: string[]; remove: string[] }
)

export interface IssueList {
  issues: IssueSummary[]
  hasMore: boolean
}

export interface Person {
  accountId: string | null
  displayName: string
  avatarUrl: string | null
}

export interface Board {
  id: number
  name: string
  /** `simple` is a team-managed project's board */
  kind: 'scrum' | 'kanban' | 'simple' | (string & {})
  projectKey: string | null
  projectName: string | null
}

export interface Project {
  key: string
  name: string
}

export interface BoardColumn {
  name: string
  /** Jira status ids shown in the column */
  statusIds: string[]
}

export interface Sprint {
  id: number
  name: string
  state: 'active' | 'future' | (string & {})
}

/** What to read from a board: all of it, its backlog, or one sprint */
export type BoardScope = { kind: 'board' } | { kind: 'backlog' } | { kind: 'sprint'; id: number }

export interface Attachment {
  id: string
  filename: string
  mimeType: string
  size: number
}

/** A comment ready to edit: its mentions are written `@Name` in `text`, `mentions` say who they are */
export interface CommentSource {
  text: string
  mentions: { accountId: string; displayName: string }[]
}

export interface Comment {
  id: string
  author: Person | null
  created: string
  updated: string
  /** Jira-rendered HTML: sanitize before display */
  bodyHtml: string
}

export interface IssueDetail {
  key: string
  /** Jira-rendered HTML: sanitize before display */
  descriptionHtml: string | null
  assignee: Person | null
  reporter: Person | null
  labels: string[]
  created: string
  parent: { key: string; summary: string } | null
  attachments: Attachment[]
  comments: Comment[]
}

export type ApiErrorKind =
  | 'invalidSite'
  | 'invalidCredentials'
  | 'forbidden'
  | 'invalidQuery'
  | 'notFound'
  | 'network'
  | 'keychain'
  | 'sprocket'
  | 'unexpected'

/** The connection to Sprocket, the companion app that runs agent workflows on tickets */
export interface SprocketSession {
  address: string
  /** False when Sprocket doesn't answer (closed, or its token changed) */
  reachable: boolean
  version: string | null
  agentsReady: boolean
  message: string | null
}

export interface SprocketWorkflow {
  id: string
  name: string
  description: string
}

export type SprocketRunState = 'running' | 'waiting' | 'passed' | 'failed' | 'cancelled' | 'interrupted'
export type SprocketJobState = 'running' | 'waiting' | 'done' | 'failed' | 'rejected' | 'stopped' | 'interrupted'

/** A run as Sprocket describes it; only what the ticket view shows */
/** A step of a Sprocket workflow; a condition holds its branches and a loop its steps. */
export interface SprocketStep {
  id: string
  kind: 'agent' | 'approval' | 'action' | 'condition' | 'forEach'
  agent: string | null
  then?: SprocketStep[]
  else?: SprocketStep[]
  steps?: SprocketStep[]
}

export interface SprocketRun {
  id: string
  workflowName: string
  number: number
  startedBy: string
  state: SprocketRunState
  startedAt: string
  steps: SprocketStep[]
  jobs: { id: string; stepId: string; state: SprocketJobState; attempt: number }[]
  /** Pending only */
  approvals: { id: string; kind: 'gate' | 'tool'; jobId: string | null; summary: string; toolName: string | null }[]
  /** Whether its workflow has a board (older Sprocket versions: absent) */
  board?: boolean
  /** The run's board, oldest first: notes by its agents (with their agent type) and by people */
  notes?: { id: number; at: string; author: string; agent: string | null; to: string | null; body: string }[]
}

export class ApiError extends Error {
  kind: ApiErrorKind

  constructor(kind: ApiErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

// Rust commands reject with `{ kind, message }`; turn that into a real Error
function toApiError(e: unknown): ApiError {
  const err = e as { kind?: ApiErrorKind; message?: string }
  return new ApiError(err.kind ?? 'unexpected', err.message ?? String(e))
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (e) {
    throw toApiError(e)
  }
}

/** A call whose body is raw bytes (a file), with what else it needs in headers */
async function callWithBytes<T>(command: string, bytes: Uint8Array, headers: Record<string, string>): Promise<T> {
  try {
    return await invoke<T>(command, bytes, { headers })
  } catch (e) {
    throw toApiError(e)
  }
}

export const api = {
  login: (site: string, email: string, token: string) =>
    call<Session>('login', { site, email, token }),
  currentSession: () => call<Session | null>('current_session'),
  logout: () => call<void>('logout'),
  searchIssues: (jql: string, limit?: number) => call<IssueList>('search_issues', { jql, limit }),
  /** Jira Software boards (none on a site without it) */
  listBoards: () => call<Board[]>('list_boards'),
  listProjects: () => call<Project[]>('list_projects'),
  getBoardColumns: (boardId: number) => call<BoardColumn[]>('get_board_columns', { boardId }),
  /** Active and planned sprints; empty for a kanban board */
  getBoardSprints: (boardId: number) => call<Sprint[]>('get_board_sprints', { boardId }),
  getBoardIssues: (boardId: number, scope: BoardScope, jql?: string) =>
    call<IssueList>('get_board_issues', { boardId, scope, jql }),
  getIssue: (key: string) => call<IssueDetail>('get_issue', { key }),
  /** The description as Jira wiki markup, for editing */
  getDescriptionSource: (key: string) => call<string>('get_description_source', { key }),
  getTransitions: (key: string) => call<Transition[]>('get_transitions', { key }),
  /** `changes` are the values of the fields the transition asked for */
  transitionIssue: (key: string, transitionId: string, changes: FieldChange[] = []) =>
    call<void>('transition_issue', { key, transitionId, changes }),
  updateDescription: (key: string, text: string) => call<void>('update_description', { key, text }),
  /** `text` is Jira wiki markup */
  /** Attaches a picture to the ticket, so wiki markup can show it as `!filename!` */
  uploadAttachment: (key: string, filename: string, bytes: Uint8Array) =>
    callWithBytes<void>('upload_attachment', bytes, { key, filename }),
  addComment: (key: string, text: string) => call<void>('add_comment', { key, text }),
  getCommentSource: (key: string, id: string) => call<CommentSource>('get_comment_source', { key, id }),
  updateComment: (key: string, id: string, text: string) => call<void>('update_comment', { key, id, text }),
  /** The extra fields (custom ones included) the ticket's Jira offers to show */
  getTicketFields: (key: string) => call<FieldRef[]>('get_ticket_fields', { key }),
  /** What the ticket holds in those fields, as strings to display (empty when unset) */
  getFieldValues: (key: string, fields: string[]) =>
    call<Record<string, string[]>>('get_field_values', { key, fields }),
  getEditMeta: (key: string) => call<EditField[]>('get_edit_meta', { key }),
  updateIssueFields: (key: string, changes: FieldChange[]) =>
    call<void>('update_issue_fields', { key, changes }),
  /** Gives the ticket to a person; `null` unassigns it */
  assignIssue: (key: string, accountId: string | null) => call<void>('assign_issue', { key, accountId }),
  /** People assignable in every one of the projects */
  searchAssignableUsers: (projectKeys: string[], query: string) =>
    call<User[]>('search_assignable_users', { projectKeys, query }),
  /** People who can see the ticket, so who a comment on it can mention */
  searchMentionableUsers: (key: string, query: string) =>
    call<User[]>('search_mentionable_users', { key, query }),
  /** Checks a folder is a git repository; gives its main working tree and the branch new work starts from */
  checkRepo: (path: string) => call<RepoInfo>('check_repo', { path }),
  /**
   * `<repo>/.claude/worktrees/<key>` on a branch named `<key>`, reused when git lists it. When something is in the way
   * nothing is touched and the conflict comes back, unless `strategy` says what to do about it.
   */
  createWorktree: (repo: string, key: string, strategy?: WorktreeStrategy) =>
    call<WorktreeOutcome>('create_worktree', { repo, key, strategy: strategy ?? null }),
  /** The folders proposed for worktrees kept in the user's folder: herdr's own, and Tracket's */
  worktreeBases: () => call<{ herdr: string; tracket: string }>('worktree_bases'),
  openInVscode: (path: string) => call<void>('open_in_vscode', { path }),
  /** A herdr space named `name` in `folder`, running Claude Code with `prompt` as its first message */
  openInHerdr: (folder: string, name: string, prompt: string) =>
    call<HerdrLaunch>('open_in_herdr', { folder, name, prompt }),
  /** `started` in Jira's timestamp format, see `jiraTimestamp` */
  /** Shrinks the window to the timer pill (always on top), or puts it back */
  setMini: (on: boolean) => call<void>(on ? 'enter_mini' : 'leave_mini'),
  /** The red dot on the app's icon in the taskbar (Windows) */
  setTimerBadge: (running: boolean) => call<void>('set_timer_badge', { running }),
  addWorklog: (key: string, seconds: number, started: string, comment?: string) =>
    call<void>('add_worklog', { key, seconds, started, comment }),
  /** Without a token, Sprocket's own is used when it runs on this computer */
  sprocketSignIn: (address: string, token?: string) =>
    call<SprocketSession>('sprocket_sign_in', { address, token: token || null }),
  /** null when not signed in */
  sprocketSession: () => call<SprocketSession | null>('sprocket_session'),
  sprocketSignOut: () => call<void>('sprocket_sign_out'),
  sprocketWorkflows: () => call<SprocketWorkflow[]>('sprocket_workflows'),
  /** The ticket's runs, newest first */
  sprocketRuns: (key: string) => call<SprocketRun[]>('sprocket_runs', { key }),
  sprocketStartRun: (run: { workflow: string; key: string; title: string; url: string; folder: string; startedBy: string }) =>
    call<SprocketRun>('sprocket_start_run', { run }),
  sprocketDecide: (id: string, approve: boolean, by: string, reason?: string) =>
    call<void>('sprocket_decide', { id, approve, by, reason: reason || null }),
  sprocketPostNote: (runId: string, body: string, by: string, to?: string) =>
    call<void>('sprocket_post_note', { runId, body, by, to: to || null }),
}
