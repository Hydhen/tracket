/**
 * The release notes, read from CHANGELOG.md. Changesets writes that file (see .changeset/README.md); the app carries it
 * from the build it was made in, so the notes of a version are the ones of the app that shows them.
 */

export type ChangeKind = 'major' | 'minor' | 'patch'

/** One change, cut where a person stops reading: the headline says it, the detail is for whoever wants more. */
export interface Change {
  headline: string
  detail: string
}

export interface Release {
  version: string
  changes: Record<ChangeKind, Change[]>
}

const KINDS: Record<string, ChangeKind> = { 'Major Changes': 'major', 'Minor Changes': 'minor', 'Patch Changes': 'patch' }

/**
 * What Changesets puts before the sentence of each entry: the pull request, the commit and who to thank, as
 * `[#13](…) [`3d73201`](…) Thanks [@name](…)! - `. None of it is for the people who use the app.
 */
const BOILERPLATE =
  /^(?:\[#\d+\]\([^)]*\)\s*)?(?:\[`[0-9a-f]+`\]\([^)]*\)\s*)?(?:Thanks \[@[^\]]+\]\([^)]*\)!\s*)?-?\s*/

/** The first sentence: up to a full stop that is followed by a new sentence (so "e.g. a priority" isn't cut). */
const FIRST_SENTENCE = /^(.+?[.!?])(?=\s+[A-Z“"‘']|$)\s*(.*)$/s

function toChange(raw: string): Change | null {
  const text = raw
    .replace(BOILERPLATE, '')
    // Links read as their text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || text.startsWith('Updated dependencies')) return null
  const sentence = FIRST_SENTENCE.exec(text)
  return sentence ? { headline: sentence[1], detail: sentence[2] } : { headline: text, detail: '' }
}

/** The releases in the file, newest first as the file has them. Whatever isn't a release or an entry is ignored. */
export function parseChangelog(source: string): Release[] {
  const releases: Release[] = []
  const entries: { release: Release; kind: ChangeKind; raw: string[] }[] = []
  let release: Release | undefined
  let kind: ChangeKind | undefined
  let entry: string[] | undefined

  for (const line of source.split(/\r?\n/)) {
    const heading = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
    if (heading?.[1] === '##') {
      release = { version: heading[2], changes: { major: [], minor: [], patch: [] } }
      releases.push(release)
      kind = undefined
      entry = undefined
    } else if (heading?.[1] === '###') {
      kind = KINDS[heading[2]]
      entry = undefined
    } else if (release && kind && line.startsWith('- ')) {
      entry = [line.slice(2)]
      entries.push({ release, kind, raw: entry })
    } else if (entry && /^\s+\S/.test(line)) {
      // The rest of an entry that goes on over several lines
      entry.push(line.trim())
    } else if (line.trim() !== '') {
      entry = undefined
    }
  }

  for (const { release, kind, raw } of entries) {
    const change = toChange(raw.join(' '))
    if (change) release.changes[kind].push(change)
  }
  return releases.filter((r) => Object.values(r.changes).some((list) => list.length > 0))
}
