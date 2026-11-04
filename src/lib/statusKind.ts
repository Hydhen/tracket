import type { IssueSummary } from '@/lib/api'

/**
 * Jira only has three status categories, but a "done" status is either the final one (Fermée,
 * closed) or an intermediate one (Résolu, resolved), and the UI tells them apart.
 */
export type StatusKind = 'open' | 'active' | 'resolved' | 'closed'

const RESOLVED = /r[ée]solu|resolved/i

export const isResolvedName = (name: string) => RESOLVED.test(name)

export function statusKind(status: IssueSummary['status']): StatusKind {
  if (status.category === 'indeterminate') return 'active'
  if (status.category === 'new') return 'open'
  return isResolvedName(status.name) ? 'resolved' : 'closed'
}

/** Colours of a status wherever it is drawn as a node: dot, glow when hovered, tint when hovered. */
export const STATUS_COLORS: Record<StatusKind, { dot: string; glow: string; tint: string }> = {
  open: { dot: '#b4b4ba', glow: '#d4d4d8', tint: '#2a2a2f' },
  active: { dot: '#7db4ff', glow: '#7db4ff', tint: '#12264a' },
  resolved: { dot: '#5ee38d', glow: '#5ee38d', tint: '#0f2e1c' },
  closed: { dot: '#2f8f5b', glow: '#3fbf7a', tint: '#0c2a1b' },
}
