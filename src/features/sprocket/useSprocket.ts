import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api, type ApiError, type IssueSummary, type SprocketRun, type SprocketSession, type SprocketTicket, type SprocketWorkflow } from '@/lib/api'
import { persistStorage } from '@/lib/storage'

/** The connection to Sprocket, checked with it every minute (it may be closed, or opened since). */
export function useSprocketSession() {
  return useQuery<SprocketSession | null, ApiError>({
    queryKey: ['sprocket-session'],
    queryFn: api.sprocketSession,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

type Toggle = 'section' | 'button' | 'tab' | 'notify'

interface SprocketPrefs {
  /** The run, its stages and approvals, under the ticket's fields */
  section: boolean
  /** The Agents button next to Start working */
  button: boolean
  /** The Agents tab in the sidebar: your tickets an agent works on */
  tab: boolean
  /** A Windows notification when an agent needs you (an approval) or a run fails */
  notify: boolean
  /** The workflow pre-selected for a Jira project's tickets, by project key */
  defaults: Record<string, string>
  set: (prefs: Partial<Record<Toggle, boolean>>) => void
  setDefault: (project: string, workflow: string | null) => void
}

export const useSprocketPrefs = create<SprocketPrefs>()(
  persist(
    (set) => ({
      section: true,
      button: true,
      tab: true,
      notify: true,
      defaults: {},
      set: (prefs) => set(prefs),
      setDefault: (project, workflow) =>
        set((s) => {
          const defaults = { ...s.defaults }
          if (workflow) defaults[project] = workflow
          else delete defaults[project]
          return { defaults }
        }),
    }),
    {
      name: 'tracket-sprocket',
      storage: persistStorage,
      version: 1,
      partialize: ({ section, button, tab, notify, defaults }) => ({ section, button, tab, notify, defaults }),
    },
  ),
)

/** Signed in, and Sprocket answers: only then do the Agents parts show. */
export function useSprocketReady() {
  const session = useSprocketSession().data
  return !!session?.reachable
}

/** The workflows Sprocket offers in Tracket, those that run requests ("Ask an agent") included. */
export function useSprocketWorkflows(enabled: boolean) {
  return useQuery<SprocketWorkflow[], ApiError>({
    queryKey: ['sprocket-workflows'],
    queryFn: api.sprocketWorkflows,
    enabled,
    staleTime: 60_000,
  })
}

/** The workflows to start as they are, and the one "Ask an agent" starts with what you write. */
export function splitWorkflows(workflows: SprocketWorkflow[] | undefined) {
  const list = workflows ?? []
  return { plain: list.filter((w) => !w.forRequests), ask: list.find((w) => w.forRequests) }
}

/** The project's default workflow, while Sprocket still offers it. */
export function defaultWorkflow(workflows: SprocketWorkflow[] | undefined, defaults: Record<string, string>, project: string) {
  const id = defaults[project]
  return id ? (workflows ?? []).find((w) => w.id === id && !w.forRequests) : undefined
}

const active = (run: SprocketRun) => run.state === 'running' || run.state === 'waiting'

/** The ticket's runs: every few seconds while one is going, rarely otherwise. */
export function useTicketRuns(key: string, enabled: boolean) {
  return useQuery<SprocketRun[], ApiError>({
    queryKey: ['sprocket-runs', key],
    queryFn: () => api.sprocketRuns(key),
    enabled,
    refetchInterval: (query) => ((query.state.data ?? []).some(active) ? 4_000 : 60_000),
  })
}

/**
 * Every ticket's latest run, in a few words, for the rows, the Agents tab, the drag targets and the notifications:
 * one query for the whole app, asked only while signed in to a Sprocket that answers.
 */
export function useSprocketTickets() {
  const ready = useSprocketReady()
  const query = useQuery<SprocketTicket[], ApiError>({
    queryKey: ['sprocket-tickets'],
    queryFn: api.sprocketTickets,
    enabled: ready,
    refetchInterval: (q) => ((q.state.data ?? []).some((t) => t.state === 'running' || t.state === 'waiting') ? 8_000 : 30_000),
    retry: false,
  })
  const byKey = new Map<string, SprocketTicket>()
  if (ready) for (const t of query.data ?? []) byKey.set(t.ticketKey, t)
  return { byKey, loaded: ready && query.isSuccess }
}

export type AgentTone = 'lit' | 'run' | 'fail'

/**
 * What a ticket's row says about its latest run; null once it is over (passed or cancelled). A run that waits for
 * you, failed, or was interrupted needs you: those light the Agents tab's dot.
 */
export function agentStatus(t: SprocketTicket | undefined): { label: string; tone: AgentTone; needsYou: boolean } | null {
  switch (t?.state) {
    case 'waiting':
      return { label: 'Needs you', tone: 'lit', needsYou: true }
    case 'running':
      return { label: 'Agent running', tone: 'run', needsYou: false }
    case 'failed':
      return { label: 'Run failed', tone: 'fail', needsYou: true }
    case 'interrupted':
      return { label: 'Run interrupted', tone: 'lit', needsYou: true }
    default:
      return null
  }
}

export const TONE_COLOR: Record<AgentTone, string> = { lit: 'var(--sp-lit)', run: 'var(--sp-run)', fail: 'var(--sp-fail)' }

/** Whether the Agents tab shows: signed in to Sprocket, and not turned off in Settings › Sprocket. */
export function useAgentsTabShown() {
  const ready = useSprocketReady()
  const tab = useSprocketPrefs((s) => s.tab)
  return ready && tab
}

/**
 * The tickets the Agents tab lists: those whose latest run is going or needs you. The tab's dot comes from the
 * same list, so it never lights for a ticket the tab doesn't show.
 */
export function useAgentsTickets(issues: IssueSummary[]) {
  const { byKey } = useSprocketTickets()
  const listed = issues.filter((i) => agentStatus(byKey.get(i.key)))
  const needsYou = listed.some((i) => agentStatus(byKey.get(i.key))?.needsYou)
  return { listed, needsYou }
}

/** A comment a Sprocket action posted: it ends with "Posted by Sprocket · <workflow> #<n>" (the dash may be lost). */
export const isFromSprocket = (html: string | null | undefined) => !!html && /Posted by Sprocket\b/.test(html)
