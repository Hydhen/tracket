import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { persistStorage } from '@/lib/storage'
import { MAX_CONDITIONS, PROJECT_FIELD, sameWhen, type Condition, type WorkProject } from './routing'

export const PROJECT_KEY = /^[A-Z][A-Z0-9_]*$/
const FIELD_KEY = /^[A-Za-z0-9_]+$/

interface ProjectsState {
  projects: WorkProject[]
  /** Adds a project, replacing the one identified by the same metadata */
  link: (project: Omit<WorkProject, 'id'>) => void
  unlink: (id: string) => void
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

const jiraProject = (key: string): Condition => ({ field: PROJECT_FIELD, name: 'Jira project', value: key })

function sanitize(raw: unknown): WorkProject[] {
  if (!Array.isArray(raw)) return []
  const projects: WorkProject[] = []
  for (const item of raw as Partial<WorkProject>[]) {
    if (!item || !isText(item.id) || !isText(item.path)) continue
    const when = (Array.isArray(item.when) ? item.when : [])
      .filter((c): c is Condition => !!c && FIELD_KEY.test(c.field ?? '') && isText(c.value))
      .slice(0, MAX_CONDITIONS)
      .map((c) => ({ field: c.field, name: isText(c.name) ? c.name : c.field, value: c.value.trim() }))
    // Without metadata nothing says which tickets belong to it
    if (when.length === 0) continue
    projects.push({ id: item.id, name: isText(item.name) ? item.name.trim() : when[0].value, when, path: item.path })
  }
  return projects
}

export const useProjects = create<ProjectsState>()(
  persist(
    (set) => ({
      projects: [],
      link: (project) =>
        set((s) => ({
          projects: [
            ...s.projects.filter((p) => !sameWhen(p.when, project.when)),
            { ...project, id: crypto.randomUUID() },
          ],
        })),
      unlink: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
    }),
    {
      name: 'tracket-repos',
      storage: persistStorage,
      version: 3,
      partialize: (s) => ({ projects: s.projects }),
      // Before, a Jira project (and later also up to 2 fields) was linked to a repository: it is now
      // a project identified by metadata, the Jira project being one of them
      migrate: (persisted, version) => {
        const old = persisted as {
          repos?: Record<string, unknown>
          rules?: { project?: string; when?: Condition[]; path?: string }[]
        }
        if (version <= 1) {
          return {
            projects: Object.entries(old.repos ?? {}).map(([key, path]) => ({
              id: crypto.randomUUID(),
              name: key,
              when: [jiraProject(key)],
              path: String(path),
            })),
          }
        }
        if (version === 2) {
          return {
            projects: (old.rules ?? []).map((rule) => {
              const when = Array.isArray(rule.when) ? rule.when : []
              return {
                id: crypto.randomUUID(),
                name: when[0]?.value ?? rule.project ?? '',
                // Two fields already identify it: the Jira project can't be added to them
                when: when.length < MAX_CONDITIONS ? [jiraProject(rule.project ?? ''), ...when] : when,
                path: String(rule.path),
              }
            }),
          }
        }
        return persisted as { projects: WorkProject[] }
      },
      // Keep only well-formed entries, in case the stored data was edited by hand
      merge: (persisted, current) => ({
        ...current,
        projects: sanitize((persisted as { projects?: unknown } | undefined)?.projects),
      }),
    },
  ),
)
