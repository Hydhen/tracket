import { useQueries } from '@tanstack/react-query'
import { onePerProject, useIssues, viewJql } from '@/features/issues/useIssues'
import { useBulkDefaults } from './defaultFields'
import { FieldDefaultsEditor } from './FieldDefaultsEditor'
import { editMetaQuery, knownFields } from './sharedFields'

/**
 * The fields the bulk edit dialog starts with, and what they are filled in with. Which fields exist
 * depends on the Jira site, so the ones to choose from are read from your open tickets (one per project).
 */
export function BulkEditSettings() {
  const issues = useIssues(viewJql('open'))
  const sample = onePerProject(issues.data?.issues ?? [])
  const metaQueries = useQueries({ queries: sample.map((i) => editMetaQuery(i.key)) })
  const loading = issues.isPending || metaQueries.some((q) => q.isPending)
  const catalog = knownFields(metaQueries.flatMap((q) => (q.data ? [q.data] : [])))

  return (
    <FieldDefaultsEditor
      title="Bulk edit"
      intro="Fields already added when you edit tickets together (drag tickets onto the edit zone), and the value each one starts with. A field the tickets don't all share is skipped, and so is a value they don't all accept. Drag a field by its handle to reorder them."
      noneMessage="None: the dialog starts empty."
      useDefaults={useBulkDefaults}
      catalog={catalog}
      loading={loading}
      loadingMessage="Reading the fields of your tickets…"
      emptyMessage={
        sample.length === 0
          ? 'No open ticket to read the available fields from.'
          : "Couldn't read the fields of your tickets."
      }
      projectKeys={sample.map((i) => i.projectKey)}
    />
  )
}
