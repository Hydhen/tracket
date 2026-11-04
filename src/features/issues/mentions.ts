/** A person picked from the mention list: what the text shows, and who Jira should notify */
export interface Mention {
  accountId: string
  displayName: string
}

/** The `@name` being typed just before the caret, or null. The `@` must start a word, so addresses don't count. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|\s)@(\S[^@\n]{0,39}|)$/.exec(text.slice(0, caret))
  if (!match) return null
  const query = match[1]
  return { start: caret - query.length - 1, query }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The text as Jira wiki markup: each `@Name` picked from the list becomes `[~accountid:…]`, which Jira shows as a
 * mention and notifies. A name edited afterwards is just text.
 */
export function withMentions(text: string, mentions: Mention[]): string {
  // The longest names first, so "@Ann Lee" isn't taken for "@Ann"
  const byLength = [...mentions].sort((a, b) => b.displayName.length - a.displayName.length)
  return byLength.reduce(
    (result, { accountId, displayName }) =>
      result.replace(
        new RegExp(`(^|\\s)@${escapeRegex(displayName)}(?![\\p{L}\\p{N}])`, 'gu'),
        (_, before: string) => `${before}[~accountid:${accountId}]`,
      ),
    text,
  )
}
