import { displayValue, isShortValue } from './fieldValue'

/**
 * The value of a field of the user's Jira, whatever it holds: a few short items are chips like
 * labels, a single short one is plain text, long text keeps its line breaks and scrolls.
 */
export function JiraFieldValue({ values }: { values: string[] }) {
  if (values.length === 0) return <>—</>

  if (values.length > 1 && values.every(isShortValue)) {
    return (
      <span className="flex flex-wrap gap-1">
        {values.map((value) => (
          <span key={value} className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {displayValue(value)}
          </span>
        ))}
      </span>
    )
  }

  return (
    <div className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
      {values.map(displayValue).join('\n')}
    </div>
  )
}
