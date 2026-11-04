import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ChevronRight, Plus, RefreshCw, Search, Settings } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Spinner } from '@/components/Spinner'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { BulkEditDialog } from '@/features/bulk/BulkEditDialog'
import { IssueDetail } from '@/features/issues/IssueDetail'
import { IssueList } from '@/features/issues/IssueList'
import { TicketActionsContext } from '@/features/issues/ticketActions'
import { useIssues, viewJql, type ListView } from '@/features/issues/useIssues'
import { CommandPalette } from '@/features/search/CommandPalette'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { TimerChip } from '@/features/timer/TimerChip'
import { TimersView } from '@/features/timer/TimersView'
import { useUpdates } from '@/features/update/updateStore'
import { UpdateNotice } from '@/features/update/UpdateNotice'
import { TicketMovesContext } from '@/features/transitions/movesContext'
import { MoveToast } from '@/features/transitions/MoveToast'
import { StatusGraphOverlay } from '@/features/transitions/StatusGraphOverlay'
import { TransitionInputDialog } from '@/features/transitions/TransitionInputDialog'
import { useMovesController } from '@/features/transitions/useMovesController'
import { IssueTree } from '@/features/tree/IssueTree'
import { useRootIssues, useTreeState } from '@/features/tree/useTree'
import { api, type IssueSummary, type Session } from '@/lib/api'
import { appStorage } from '@/lib/storage'
import { cn } from '@/lib/utils'

const VIEW_KEY = 'tracket-view'
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/

/** 'timers' has no tab: the sidebar's timer summary leads to it, and it isn't restored on launch */
type View = ListView | 'tree' | 'timers'

const VIEWS: { id: View; label: string; empty: string }[] = [
  { id: 'open', label: 'Open', empty: 'Nothing assigned to you. Enjoy the quiet.' },
  { id: 'closed', label: 'Closed', empty: 'No closed or resolved tickets assigned to you.' },
  { id: 'tree', label: 'Tree', empty: '' },
]

function loadView(): View {
  try {
    const saved = appStorage.getItem(VIEW_KEY)
    return saved === 'closed' || saved === 'tree' ? saved : 'open'
  } catch {
    return 'open'
  }
}

function Message({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">{children}</div>
}

export function MainShell({ session }: { session: Session }) {
  const [selectedKey, setSelectedKey] = useState<string>()
  const [sideKey, setSideKey] = useState<string>()
  const [view, setView] = useState(loadView)
  const isTree = view === 'tree'
  const isTimers = view === 'timers'
  const isList = !isTree && !isTimers
  // The tree and the timers have their own data; the open list still backs search suggestions and the key prefix
  const { data, error, isPending, isFetching, isPlaceholderData, refetch } = useIssues(
    viewJql(view === 'closed' ? 'closed' : 'open'),
  )

  const queryClient = useQueryClient()

  // Looks for a new version once the first screen is up (unless the person turned that off in Settings > About)
  const autoUpdates = useUpdates((s) => s.auto)
  const checkForUpdate = useUpdates((s) => s.check)
  useEffect(() => {
    // A dev build must not offer to replace itself with the installed app's releases
    if (!autoUpdates || import.meta.env.DEV) return
    const id = setTimeout(() => void checkForUpdate(false), 5000)
    return () => clearTimeout(id)
  }, [autoUpdates, checkForUpdate])
  const tree = useTreeState()
  const rootsQuery = useRootIssues(tree.roots)
  const isTreeQuery = (key: readonly unknown[]) => ['tree-roots', 'children', 'grandchildren'].includes(key[0] as string)
  const treeFetching = useIsFetching({ predicate: (q) => isTreeQuery(q.queryKey) }) > 0
  const refreshTree = () => queryClient.invalidateQueries({ predicate: (q) => isTreeQuery(q.queryKey) })

  const changeView = (next: View) => {
    if (next === view) return
    setView(next)
    setSideKey(undefined)
    try {
      if (next !== 'timers') appStorage.setItem(VIEW_KEY, next)
    } catch {
      // the choice still applies for this session
    }
  }

  // What the palette is for: opening a ticket, or picking a root for the tree
  const [palette, setPalette] = useState<'open' | 'tree' | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Set when the settings open from a ticket whose project has no repository yet
  const [settingsProject, setSettingsProject] = useState<string>()
  const openSettings = (project?: string) => {
    setSettingsProject(project)
    setSettingsOpen(true)
  }

  // Tickets opened from search that aren't in the current list
  const [extras, setExtras] = useState<IssueSummary[]>([])

  const issues = data?.issues ?? []
  const known = [...issues, ...extras.filter((e) => !issues.some((i) => i.key === e.key))]
  // Fall back to the first issue when nothing is selected or the selection left the list
  const selected = known.find((i) => i.key === selectedKey) ?? (isList ? issues[0] : undefined)
  // The side view only shows while its issue is known and differs from the main one
  const side = known.find((i) => i.key === sideKey && i.key !== selected?.key)

  // Tickets moved to another status: the copies kept in state follow, the query caches are patched by the controller
  const movesController = useMovesController({
    selected,
    patchLocal: (patches) =>
      setExtras((prev) => prev.map((e) => (patches[e.key] ? { ...e, ...patches[e.key] } : e))),
  })
  const { moves, overlay, toast, confirm, editing, input } = movesController

  // Selecting the issue shown in the side view swaps the two
  const select = (key: string) => {
    if (side && key === side.key) setSideKey(selected?.key)
    setSelectedKey(key)
  }

  const openFromSearch = (issue: IssueSummary, { side: inSide }: { side: boolean }) => {
    setExtras((prev) => [issue, ...prev.filter((e) => e.key !== issue.key)].slice(0, 10))
    if (inSide) setSideKey(issue.key)
    else select(issue.key)
    setPalette(null)
  }

  const addToTree = (issue: IssueSummary) => {
    tree.addRoot(issue.key)
    setPalette(null)
  }

  // Tickets picked in the tree may not be in the assigned list
  const openFromTree = (issue: IssueSummary, inSide: boolean) => {
    setExtras((prev) => [issue, ...prev.filter((e) => e.key !== issue.key)].slice(0, 10))
    if (inSide) setSideKey(issue.key)
    else select(issue.key)
  }

  // Roots the ticket in the tree (unfolded) and brings the Tree view up, keeping it selected
  const openAsTree = (issue: IssueSummary) => {
    openFromTree(issue, false)
    tree.addRoot(issue.key)
    changeView('tree')
  }

  // A ticket by key: in the side view or the main one when the app can load it, the browser otherwise
  const openByKey = async (key: string, inSide: boolean) => {
    const browse = () => openUrl(`${session.site}/browse/${key}`)
    if (!ISSUE_KEY.test(key)) return browse()

    let issue = known.find((i) => i.key === key)
    if (!issue) {
      const jql = `key = "${key}"`
      try {
        // Same cache entry as the search palette's
        const found = await queryClient.fetchQuery({
          queryKey: ['search', jql],
          queryFn: () => api.searchIssues(jql, 1),
          staleTime: 60_000,
        })
        issue = found.issues[0]
      } catch {
        // not loadable (no access, offline…): the browser will say why
      }
    }
    if (issue) openFromTree(issue, inSide)
    else browse()
  }

  // Ctrl+K anywhere, or "/" when not typing in a field
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable]')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((open) => (open ? null : 'open'))
      } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setPalette('open')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <TicketActionsContext.Provider value={{ openInSide: (key) => openByKey(key, true), linkRepo: openSettings }}>
    <TicketMovesContext.Provider value={moves}>
      <div className="flex h-screen bg-background text-foreground">
        <aside className="flex w-96 flex-col border-r">
          <button
            onClick={() => setPalette('open')}
            className="flex items-center gap-2 border-b px-4 py-3 text-left text-sm text-muted-foreground hover:bg-accent"
          >
            <Search className="size-4" />
            <span>Search tickets…</span>
            <kbd className="ml-auto rounded border px-1.5 text-xs">Ctrl K</kbd>
          </button>

          <div className="flex items-center gap-2 border-b px-4 py-1.5">
            <div role="tablist" aria-label="Ticket view" className="flex rounded-md bg-muted p-0.5">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  role="tab"
                  aria-selected={view === v.id}
                  onClick={() => changeView(v.id)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground',
                    view === v.id && 'bg-background text-foreground shadow-sm',
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
            {isList && data && (
              <span className="text-xs text-muted-foreground">
                {issues.length}
                {data.hasMore ? '+' : ''}
              </span>
            )}
            {isTree && (
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7"
                title="Add a ticket to the tree"
                onClick={() => setPalette('tree')}
              >
                <Plus className="size-3.5" />
              </Button>
            )}
            {!isTimers && (
              <Button
                variant="ghost"
                size="icon"
                className={cn('size-7', !isTree && 'ml-auto')}
                title="Refresh"
                onClick={() => (isTree ? refreshTree() : refetch())}
                disabled={isTree ? treeFetching : isFetching}
              >
                <RefreshCw className={cn('size-3.5', (isTree ? treeFetching : isFetching) && 'animate-spin')} />
              </Button>
            )}
          </div>

          {isTimers ? (
            <TimersView
              selectedKey={selected?.key}
              sideKey={side?.key}
              onOpen={(issue, inSide) => openFromTree(issue, inSide)}
            />
          ) : isTree ? (
            rootsQuery.error && !rootsQuery.data ? (
              <Message>
                <p className="text-destructive">{rootsQuery.error.message}</p>
                <Button variant="outline" size="sm" onClick={() => rootsQuery.refetch()}>
                  Retry
                </Button>
              </Message>
            ) : (
              <IssueTree
                roots={tree.roots}
                rootIssues={rootsQuery.data?.issues ?? []}
                loading={rootsQuery.isFetching}
                expanded={tree.expanded}
                selectedKey={selected?.key}
                sideKey={side?.key}
                onToggle={tree.toggle}
                onSelect={(issue) => openFromTree(issue, false)}
                onOpenSide={(issue) => openFromTree(issue, true)}
                onRemoveRoot={tree.removeRoot}
                onAdd={() => setPalette('tree')}
              />
            )
          ) : isPending ? (
            <Message>
              <Spinner className="size-5" />
            </Message>
          ) : error && !data ? (
            <Message>
              <p className="text-destructive">{error.message}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </Message>
          ) : issues.length === 0 ? (
            <Message>{VIEWS.find((v) => v.id === view)?.empty}</Message>
          ) : (
            <div className={cn('flex min-h-0 flex-1 flex-col', isPlaceholderData && 'opacity-50')}>
              <IssueList
                issues={issues}
                selectedKey={selected?.key}
                sideKey={side?.key}
                onSelect={select}
                onOpenSide={setSideKey}
              />
            </div>
          )}

          {isList && error && data && (
            <div className="border-t bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
              Couldn't refresh: {error.message}
            </div>
          )}

          <TimerChip active={isTimers} onOpen={() => changeView('timers')} />

          <div className="flex items-center gap-2 border-t px-4 py-3">
            {session.avatarUrl && <img src={session.avatarUrl} alt="" className="size-7 rounded-full" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{session.displayName}</div>
              <div className="truncate text-xs text-muted-foreground">{session.site.replace('https://', '')}</div>
            </div>
            <ThemeToggle />
            <Button variant="ghost" size="icon" title="Settings" onClick={() => openSettings()}>
              <Settings className="size-4" />
            </Button>
          </div>
        </aside>

        {/* Re-keyed when the side view opens/closes so the split starts at 50% / 50% */}
        {/* The overlay and the toast belong to the detail pane only: the list stays visible and droppable-from */}
        <div className="relative flex min-w-0 flex-1">
          <ResizablePanelGroup key={side ? 'split' : 'single'} orientation="horizontal" className="min-w-0 flex-1">
            <ResizablePanel id="main" defaultSize="50%" minSize="25%">
              <main className="h-full overflow-auto p-6">
                {selected && (
                  <IssueDetail
                    key={selected.key}
                    issue={selected}
                    site={session.site}
                    onOpenIssue={openFromTree}
                    onOpenAsTree={openAsTree}
                    isTreeRoot={tree.roots.includes(selected.key)}
                  />
                )}
              </main>
            </ResizablePanel>
            {side && (
              <>
                <ResizableHandle withHandle />
                {/*
                  A sibling of the divider, not a child: the resize library treats any pointer-down
                  on a child of the divider as a drag start, so the button would never get its click.
                  The library also only sees this button as covering the divider when the pointer
                  target is an HTML element, so the SVG icon ignores the pointer (otherwise the
                  resize cursor and drag come back over the icon itself).
                  The zero-width wrapper adds no space to the layout; the button straddles the divider.
                */}
                <div className="relative z-20 w-0 shrink-0">
                  <button
                    title="Close side view"
                    aria-label="Close side view"
                    onClick={() => setSideKey(undefined)}
                    className="absolute left-0 top-3 flex size-5 -translate-x-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <ChevronRight className="pointer-events-none size-3.5" />
                  </button>
                </div>
                <ResizablePanel id="side" defaultSize="50%" minSize="25%">
                  <aside className="h-full overflow-auto p-6">
                    <IssueDetail
                      key={side.key}
                      issue={side}
                      site={session.site}
                      onOpenIssue={openFromTree}
                      onOpenAsTree={openAsTree}
                      isTreeRoot={tree.roots.includes(side.key)}
                    />
                  </aside>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>

        <StatusGraphOverlay open={overlay.open} issues={overlay.issues} onDrop={overlay.onDrop} onEdit={overlay.onEdit} />
        <MoveToast toast={toast} onUndo={movesController.undo} onDismiss={movesController.dismissToast} />
        <UpdateNotice />
        </div>

        {confirm && (
          <ConfirmDialog
            title={`Move to ${confirm.target.name} anyway?`}
            confirmLabel={`Move to ${confirm.target.name}`}
            onConfirm={movesController.confirmMove}
            onCancel={movesController.cancelMove}
          >
            {confirm.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </ConfirmDialog>
        )}

        {input && (
          <TransitionInputDialog
            issues={input.issues}
            target={input.target}
            input={input.needed}
            me={{ accountId: session.accountId, displayName: session.displayName }}
            onSubmit={movesController.submitInput}
            onCancel={movesController.cancelInput}
          />
        )}

        {editing && (
          <BulkEditDialog
            issues={editing}
            me={{ accountId: session.accountId, displayName: session.displayName }}
            onApply={movesController.applyEdits}
            onCancel={movesController.cancelEdit}
          />
        )}

        {settingsOpen && <SettingsDialog linkProject={settingsProject} site={session.site.replace('https://', '')} onClose={() => setSettingsOpen(false)} />}

        {palette && (
          <CommandPalette
            mode={palette}
            myIssues={issues}
            keyPrefix={issues[0]?.key.split('-')[0]}
            onPick={palette === 'tree' ? addToTree : openFromSearch}
            onClose={() => setPalette(null)}
          />
        )}
      </div>
    </TicketMovesContext.Provider>
    </TicketActionsContext.Provider>
  )
}
