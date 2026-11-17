import { useQueries } from '@tanstack/react-query'
import { FieldDefaultsEditor } from '@/features/bulk/FieldDefaultsEditor'
import { useResolveDefaults } from '@/features/bulk/defaultFields'
import { knownFields } from '@/features/bulk/sharedFields'
import { onePerProject, useIssues, viewJql } from '@/features/issues/useIssues'
import { transitionsQuery } from './transitions'

/**
 * The fields filled in, and the values they get, when a ticket is moved to a done status (Resolved, Done…). What a
 * move asks for depends on the workflow, so the fields to choose from are read from the moves your open tickets
 * (one per project) can make to a done status.
 */
export function ResolveDefaultsSettings() {
  const issues = useIssues(viewJql('open'))
  const sample = onePerProject(issues.data?.issues ?? [])
  const queries = useQueries({ queries: sample.map((i) => transitionsQuery(i.key)) })
  const loading = issues.isPending || queries.some((q) => q.isPending)
  const catalog = knownFields(
    queries.flatMap((q) =>
      (q.data ?? [])
        .filter((t) => t.to.category === 'done')
        // Time spent adds a worklog on every move: not something to repeat by default
        .map((t) => [...t.required, ...t.optional].filter((f) => f.kind !== 'timeSpent')),
    ),
  )

  return (
    <FieldDefaultsEditor
      title="Resolve defaults"
      intro="Values filled in when you move a ticket to a done status (Resolved, Done…), whichever way you move it. When they cover everything Jira asks for, the ticket moves without a dialog; otherwise the dialog opens with them filled in. A field that isn't on the move's screen is skipped, and so is a value the ticket doesn't accept."
      noneMessage="None: the move asks for what Jira needs, and nothing more."
      useDefaults={useResolveDefaults}
      catalog={catalog}
      loading={loading}
      loadingMessage="Reading the moves of your tickets…"
      emptyMessage={
        sample.length === 0
          ? 'No open ticket to read the fields of a move from.'
          : 'None of your open tickets can be moved straight to a done status, or Jira has no field to fill in for it.'
      }
      projectKeys={sample.map((i) => i.projectKey)}
    />
  )
}
