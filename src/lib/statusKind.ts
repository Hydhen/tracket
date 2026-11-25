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

/**
 * Colours of a status wherever it is drawn as a node: dot, glow when hovered, tint when hovered. They are the
 * theme's own (`--kind-*` in index.css), so they are CSS values rather than hex ones.
 */
export const STATUS_COLORS: Record<StatusKind, { dot: string; glow: string; tint: string }> = {
  open: { dot: 'var(--kind-open)', glow: 'var(--kind-open-glow)', tint: 'var(--kind-open-tint)' },
  active: { dot: 'var(--kind-active)', glow: 'var(--kind-active-glow)', tint: 'var(--kind-active-tint)' },
  resolved: { dot: 'var(--kind-resolved)', glow: 'var(--kind-resolved-glow)', tint: 'var(--kind-resolved-tint)' },
  closed: { dot: 'var(--kind-closed)', glow: 'var(--kind-closed-glow)', tint: 'var(--kind-closed-tint)' },
}
