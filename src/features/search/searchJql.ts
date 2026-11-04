const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/
const WORD = /[\p{L}\p{N}_]+/gu

/**
 * Issue types offered as filters. Jira resolves these standard names whatever the site's
 * language (e.g. "Task" also matches a type displayed as "Tâche").
 */
export const ISSUE_TYPES = ['Epic', 'Story', 'Task', 'Bug', 'Sub-task'] as const
export type IssueType = (typeof ISSUE_TYPES)[number]

/**
 * Turns what the user typed into JQL, or null when there is nothing searchable.
 *
 * Free text is reduced to plain words (Lucene operators would make Jira reject the
 * query), and the last word is a prefix match so results appear while typing.
 * `keyPrefix` is the project key to assume when only digits are typed (e.g. "26524").
 * `issueType` narrows the results to one type.
 */
export function buildSearchJql(input: string, keyPrefix?: string, issueType?: IssueType | null): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const clauses: string[] = []

  if (ISSUE_KEY.test(trimmed)) {
    clauses.push(`key = "${trimmed.toUpperCase()}"`)
  } else if (/^\d+$/.test(trimmed) && keyPrefix) {
    clauses.push(`key = "${keyPrefix}-${trimmed}"`)
  }

  const words = trimmed.match(WORD) ?? []
  if (words.length > 0) {
    words[words.length - 1] += '*'
    clauses.push(`text ~ "${words.join(' ')}"`)
  }

  if (clauses.length === 0) return null
  const match = clauses.join(' OR ')
  const filtered = issueType ? `(${match}) AND ${typeClause(issueType)}` : match
  return `${filtered} ORDER BY updated DESC`
}

/** My open tickets of one type: what the palette suggests when a type is picked and nothing typed. */
export function buildSuggestionJql(issueType: IssueType): string {
  return `assignee = currentUser() AND statusCategory != Done AND ${typeClause(issueType)} ORDER BY updated DESC`
}

// `issueType` only ever comes from ISSUE_TYPES, so it is safe inside the query
const typeClause = (issueType: IssueType) => `issuetype = "${issueType}"`
