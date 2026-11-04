/** A working day and week as Jira counts them by default: `2d` is 16 hours, `1w` is 5 days. */
const HOURS_PER_DAY = 8
const DAYS_PER_WEEK = 5

/** `1h 30m`, `45m`, `2h`. Never rounds below a minute, which is all Jira keeps. */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return [h && `${h}h`, (m || !h) && `${m}m`].filter(Boolean).join(' ')
}

/** `1:05:09` for a running clock. */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(total / 3600)}:${p(Math.floor(total / 60) % 60)}:${p(total % 60)}`
}

/**
 * Reads what a person types for a duration: `1h 30m`, `1.5h`, `2d`, `1w 2d`, `90m`, `1:30`, or a
 * bare number of minutes. Days are working days of 8 hours, weeks of 5 days, as in Jira. Gives
 * seconds rounded to the minute, or null when it isn't understood.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase()
  if (!text) return null

  const clock = /^(\d+):([0-5]?\d)$/.exec(text)
  if (clock) return (Number(clock[1]) * 60 + Number(clock[2])) * 60
  if (/^\d+$/.test(text)) return Number(text) * 60

  const UNIT_SECONDS: Record<string, number> = {
    w: DAYS_PER_WEEK * HOURS_PER_DAY * 3600,
    d: HOURS_PER_DAY * 3600,
    h: 3600,
    m: 60,
  }
  let seconds = 0
  let found = false
  // Units can be spelled out (`2 days`, `3 hrs`, `10 min`); what follows must not be another letter
  const rest = text.replace(
    /(\d+(?:[.,]\d+)?)\s*(w(?:eeks?)?|d(?:ays?)?|h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?)(?![a-z])/g,
    (_, n: string, unit: string) => {
      found = true
      seconds += Number.parseFloat(n.replace(',', '.')) * UNIT_SECONDS[unit[0]]
      return ''
    },
  )
  if (!found || rest.trim() !== '') return null
  return Math.round(seconds / 60) * 60
}

/** Local time in the format Jira wants for a worklog start: `2026-10-29T14:05:00.000+0100`. */
export function jiraTimestamp(date: Date): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    `${p(date.getFullYear(), 4)}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}` +
    `${sign}${p(Math.floor(Math.abs(offset) / 60))}${p(Math.abs(offset) % 60)}`
  )
}
