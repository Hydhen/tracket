const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** Dates and times as the user reads them; anything else as it is. */
export function displayValue(text: string): string {
  const day = DATE.exec(text)
  if (day) {
    const date = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
    return date.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  if (DATE_TIME.test(text) && !Number.isNaN(Date.parse(text))) return new Date(text).toLocaleString()
  return text
}

export const isShortValue = (text: string) => text.length <= 40 && !text.includes('\n')

/** Long text (release notes, descriptions…) needs more room than a tile of the grid. */
export const isWideValue = (values: string[]) => values.some((v) => v.length > 60 || v.includes('\n'))
