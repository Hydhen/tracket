const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "2 hours ago", "yesterday"… */
export function timeAgo(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit)
  }
  return 'just now'
}

/** Parses a `YYYY-MM-DD` date as local midnight (new Date(str) would be UTC). */
function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatDay(day: string): string {
  return parseDay(day).toLocaleDateString('en', { day: 'numeric', month: 'short' })
}

export function isOverdue(day: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return parseDay(day) < today
}
