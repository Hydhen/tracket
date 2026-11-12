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
  | 'unexpected'

export class ApiError extends Error {
  kind: ApiErrorKind

  constructor(kind: ApiErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

// Rust commands reject with `{ kind, message }`; turn that into a real Error
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (e) {
    const err = e as { kind?: ApiErrorKind; message?: string }
    throw new ApiError(err.kind ?? 'unexpected', err.message ?? String(e))
  }
}

export const api = {
  login: (site: string, email: string, token: string) =>
    call<Session>('login', { site, email, token }),
  currentSession: () => call<Session | null>('current_session'),
  logout: () => call<void>('logout'),
  searchIssues: (jql: string, limit?: number) => call<IssueList>('search_issues', { jql, limit }),
  getIssue: (key: string) => call<IssueDetail>('get_issue', { key }),
  /** The description as Jira wiki markup, for editing */
  getDescriptionSource: (key: string) => call<string>('get_description_source', { key }),
  getTransitions: (key: string) => call<Transition[]>('get_transitions', { key }),
  /** `changes` are the values of the fields the transition asked for */
  transitionIssue: (key: string, transitionId: string, changes: FieldChange[] = []) =>
    call<void>('transition_issue', { key, transitionId, changes }),
  updateDescription: (key: string, text: string) => call<void>('update_description', { key, text }),
  /** `text` is Jira wiki markup */
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
  /** People assignable in every one of the projects */
  searchAssignableUsers: (projectKeys: string[], query: string) =>
    call<User[]>('search_assignable_users', { projectKeys, query }),
  /** People who can see the ticket, so who a comment on it can mention */
  searchMentionableUsers: (key: string, query: string) =>
    call<User[]>('search_mentionable_users', { key, query }),
  /** Checks a folder is a git repository; gives its main working tree and the branch new work starts from */
  checkRepo: (path: string) => call<RepoInfo>('check_repo', { path }),
  /** `<repo>/.claude/worktrees/<key>` on a branch named `<key>`, reused when it exists */
  createWorktree: (repo: string, key: string) => call<Worktree>('create_worktree', { repo, key }),
  openInVscode: (path: string) => call<void>('open_in_vscode', { path }),
  /** A herdr space named `name` in `folder`, running Claude Code with `prompt` as its first message */
  openInHerdr: (folder: string, name: string, prompt: string) =>
    call<HerdrLaunch>('open_in_herdr', { folder, name, prompt }),
  /** `started` in Jira's timestamp format, see `jiraTimestamp` */
  /** Shrinks the window to the timer pill (always on top), or puts it back */
  setMini: (on: boolean) => call<void>(on ? 'enter_mini' : 'leave_mini'),
  addWorklog: (key: string, seconds: number, started: string, comment?: string) =>
    call<void>('add_worklog', { key, seconds, started, comment }),
}
