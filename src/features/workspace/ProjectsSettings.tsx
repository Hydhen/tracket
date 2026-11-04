import { useQueries } from '@tanstack/react-query'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, Plus, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { editMetaQuery } from '@/features/bulk/sharedFields'
import { onePerProject, useIssues, viewJql } from '@/features/issues/useIssues'
import { useJiraFields } from '@/features/settings/useJiraFields'
import { api, type ApiError, type FieldRef } from '@/lib/api'
import { useProjects } from './repos'
import { MAX_CONDITIONS, PROJECT_FIELD, type Condition } from './routing'

// Fields the ticket details list leaves out (they have their own place there), plus the Jira
// project: all are things tickets are told apart by
const ALWAYS_OFFERED: FieldRef[] = [
  { key: PROJECT_FIELD, name: 'Jira project' },
  { key: 'issuetype', name: 'Issue type' },
  { key: 'labels', name: 'Labels' },
  { key: 'priority', name: 'Priority' },
]

const INPUT_CLASS =
  'rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

interface Draft {
  field: string
  value: string
}

/**
 * The projects to start working in. A project is identified by 1 or 2 metadata of a ticket (say
 * its component category and its component) and has a root folder: starting work on a ticket that
 * has them opens a worktree of that folder's repository. Which fields exist depends on the Jira
 * site, so they are read from it, not listed here.
 */
export function ProjectsSettings({ initialProject }: { initialProject?: string }) {
  const { projects, link, unlink } = useProjects()
  const [name, setName] = useState('')
  const [drafts, setDrafts] = useState<Draft[]>([{ field: initialProject ? PROJECT_FIELD : '', value: initialProject ?? '' }])
  const [path, setPath] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const jira = useJiraFields()
  const catalog = [...ALWAYS_OFFERED, ...jira.fields.filter((f) => !ALWAYS_OFFERED.some((x) => x.key === f.key))].sort(
    (a, b) => a.name.localeCompare(b.name),
  )

  // The values the site knows for a field, read off the open tickets (one per Jira project)
  const issues = useIssues(viewJql('open'))
  const sample = onePerProject(issues.data?.issues ?? [])
  const metas = useQueries({ queries: sample.map((i) => editMetaQuery(i.key)) })
  const suggestions = (field: string): string[] => {
    if (field === PROJECT_FIELD) return sample.map((i) => i.projectKey)
    const names = metas.flatMap((q) => q.data?.find((f) => f.key === field)?.choices.map((c) => c.name) ?? [])
    return [...new Set(names)].sort((a, b) => a.localeCompare(b))
  }

  const setDraft = (i: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, at) => (at === i ? { ...d, ...patch } : d)))

  const browse = async () => {
    const picked = await open({ directory: true, title: 'Root folder of the project' })
    if (typeof picked === 'string') {
      setPath(picked)
      setError(null)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (drafts.some((d) => !d.field || !d.value.trim())) return setError('Pick a field and give its value')
    if (!path.trim()) return setError('Pick the root folder of the project')

    const when: Condition[] = drafts.map((d) => ({
      field: d.field,
      name: catalog.find((f) => f.key === d.field)?.name ?? d.field,
      value: d.value.trim(),
    }))

    setChecking(true)
    setError(null)
    try {
      // Only checks that it is in a git repository: the folder is kept as it was given
      await api.checkRepo(path.trim())
      link({ name: name.trim() || when.map((c) => c.value).join(' · '), when, path: path.trim() })
      setName('')
      setDrafts([{ field: '', value: '' }])
      setPath('')
    } catch (err) {
      setError((err as ApiError).message ?? 'Could not check that folder')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div>
      <h4 className="text-sm font-semibold">Projects</h4>
      <p className="mt-1 text-sm text-muted-foreground">
        A project is a root folder (a git repository, or a folder inside one) and the 1 or 2 metadata that tell its
        tickets apart, such as a component category and a component. The button that starts working on a ticket opens
        a worktree named after it in the project the ticket belongs to. When several projects fit, the one
        with the most metadata wins.
      </p>

      {projects.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Project</th>
                <th className="px-3 py-2 text-left font-medium">A ticket belongs to it when</th>
                <th className="px-3 py-2 text-left font-medium">Root folder</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {projects.map((project) => (
                <tr key={project.id} className="align-top">
                  <td className="px-3 py-2 font-medium">{project.name}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1">
                      {project.when.map((c) => (
                        <span key={c.field} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {c.name} = <span className="font-medium">{c.value}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="min-w-44 px-3 py-2">
                    <div className="text-muted-foreground [overflow-wrap:anywhere]">{project.path}</div>
                  </td>
                  <td className="pr-2 pt-1.5">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title={`Remove ${project.name}`}
                      aria-label={`Remove ${project.name}`}
                      onClick={() => unlink(project.id)}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={submit} className="mt-4 space-y-3 rounded-md border bg-muted/20 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Add a project</div>

        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Project name"
            placeholder="Optional: the values below by default"
            className={`min-w-0 flex-1 ${INPUT_CLASS}`}
          />
        </div>

        {drafts.map((draft, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">{i === 0 ? 'Ticket has' : 'and'}</span>
            <select
              value={draft.field}
              onChange={(e) => setDraft(i, { field: e.target.value, value: '' })}
              aria-label={`Field of metadata ${i + 1}`}
              className={`max-w-48 ${INPUT_CLASS}`}
            >
              <option value="" disabled>
                {jira.loading ? 'Loading fields…' : 'Field…'}
              </option>
              {catalog.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">=</span>
            <input
              value={draft.value}
              onChange={(e) => setDraft(i, { value: e.target.value })}
              list={`project-values-${i}`}
              aria-label={`Value of metadata ${i + 1}`}
              placeholder="Value"
              className={`min-w-32 flex-1 ${INPUT_CLASS}`}
            />
            <datalist id={`project-values-${i}`}>
              {suggestions(draft.field).map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            {drafts.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove metadata ${i + 1}`}
                title="Remove this metadata"
                onClick={() => setDrafts((prev) => prev.filter((_, at) => at !== i))}
              >
                <X />
              </Button>
            )}
          </div>
        ))}
        {drafts.length < MAX_CONDITIONS && (
          <div className="pl-[4.5rem]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDrafts((prev) => [...prev, { field: '', value: '' }])}
            >
              <Plus className="size-3.5" />
              Another metadata
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-muted-foreground">Root folder</span>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            aria-label="Root folder of the project"
            placeholder="C:\dev\my-project"
            className={`min-w-0 flex-1 ${INPUT_CLASS}`}
          />
          <Button type="button" variant="outline" size="sm" onClick={browse}>
            <FolderOpen className="size-3.5" />
            Browse
          </Button>
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={checking}>
            {checking ? <Spinner /> : 'Add the project'}
          </Button>
        </div>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
