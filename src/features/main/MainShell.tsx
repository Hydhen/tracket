import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ChevronDown, ChevronRight, Columns2, Plus, RefreshCw, Rows2, Search, Settings } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useGroupRef } from 'react-resizable-panels'
import { Spinner } from '@/components/Spinner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { AssignPicker } from '@/features/assign/AssignPicker'
import { BoardView } from '@/features/board/BoardView'
import { BulkEditDialog } from '@/features/bulk/BulkEditDialog'
import { MediaViewer } from '@/features/media/MediaViewer'
import { IssueDetail } from '@/features/issues/IssueDetail'
import { IssueList } from '@/features/issues/IssueList'
import { TicketActionsContext } from '@/features/issues/ticketActions'
import { useIssues, viewJql, type ListView } from '@/features/issues/useIssues'
import { CommandPalette } from '@/features/search/CommandPalette'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { TimerChip } from '@/features/timer/TimerChip'
import { TimersView } from '@/features/timer/TimersView'
import { useTimerBadge } from '@/features/timer/useTimerBadge'
import { useUpdates } from '@/features/update/updateStore'
import { UpdateNotice } from '@/features/update/UpdateNotice'
import { WhatsNew } from '@/features/whatsnew/WhatsNew'
import { TicketMovesContext } from '@/features/transitions/movesContext'
import { MoveToast } from '@/features/transitions/MoveToast'
import { StatusGraphOverlay } from '@/features/transitions/StatusGraphOverlay'
import { TransitionInputDialog } from '@/features/transitions/TransitionInputDialog'
import { useMovesController } from '@/features/transitions/useMovesController'
import { IssueTree } from '@/features/tree/IssueTree'
import { useRootIssues, useTreeState } from '@/features/tree/useTree'
import { AgentsDropBand } from '@/features/sprocket/AgentsDropBand'
import { AgentsTabButton } from '@/features/sprocket/AgentsTab'
import { useAgentsTabShown, useAgentsTickets } from '@/features/sprocket/useSprocket'
import { SprocketLayer } from '@/features/sprocket/SprocketLayer'
import { api, type IssueSummary, type Session } from '@/lib/api'
import { appStorage } from '@/lib/storage'
import { cn } from '@/lib/utils'

const VIEW_KEY = 'tracket-view'
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/

/**
 * 'timers' has no tab: the sidebar's timer summary leads to it, and it isn't restored on launch.
 * 'board' puts a Jira board in the main pane, with the Open list kept in the sidebar to take tickets into.
 * 'agents' is the Open list cut down to the tickets a Sprocket agent works on (signed in to Sprocket only).
 */
type View = ListView | 'tree' | 'board' | 'agents' | 'timers'

const VIEWS: { id: View; label: string; empty: string }[] = [
  { id: 'open', label: 'Open', empty: 'Nothing assigned to you. Enjoy the quiet.' },
  { id: 'closed', label: 'Closed', empty: 'No closed or resolved tickets assigned to you.' },
  { id: 'tree', label: 'Tree', empty: '' },
  { id: 'board', label: 'Board', empty: 'Nothing assigned to you yet. Drag tickets here from the board.' },
  { id: 'agents', label: 'Agents', empty: 'No agent works on your tickets. Drag tickets onto Hand to agents to start one.' },
]

function loadView(): View {
  try {
    const saved = appStorage.getItem(VIEW_KEY)
    return saved === 'closed' || saved === 'tree' || saved === 'board' || saved === 'agents' ? saved : 'open'
  } catch {
    return 'open'
  }
}

/** How the main view and the side view share the pane: next to each other, or one above the other */
type SideLayout = 'columns' | 'rows'

/** Each time the side view opens it follows the window's shape: side by side when wide, stacked when tall */
function layoutForWindow(): SideLayout {
  return window.innerHeight > window.innerWidth ? 'rows' : 'columns'
}

/**
 * The round buttons on the divider. While the pointer is over the divider's grab area the resize library forces its
 * resize cursor on every element with `*:hover { cursor: … !important }`; the important `hover:` variant is more
 * specific than that rule, so these keep the pointer.
 */
const SIDE_BUTTON =
  'flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground hover:cursor-pointer! hover:bg-accent hover:text-foreground'

function Message({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">{children}</div>
}

export function MainShell({ session }: { session: Session }) {
  const [selectedKey, setSelectedKey] = useState<string>()
  const [sideKey, setSideKey] = useState<string>()
  // A red dot on the taskbar icon while a timer runs, also when the window is the small pill
  useTimerBadge()
  const [savedView, setView] = useState(loadView)
  // The Agents tab exists only while signed in to Sprocket: without it, its list is the Open one
  const agentsShown = useAgentsTabShown()
  const view = savedView === 'agents' && !agentsShown ? 'open' : savedView
  const isAgents = view === 'agents'
  const [sideLayout, setSideLayout] = useState<SideLayout>(layoutForWindow)
  const stacked = sideLayout === 'rows'
  // Double-clicking the divider between the main and side views evens them out
  const splitRef = useGroupRef()
  const isTree = view === 'tree'
  const isTimers = view === 'timers'
  const isBoard = view === 'board'
  // The board's sidebar is the Open list, to take tickets into
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

  // Switches the layout of the side view that is open; the next one to open starts from the window's shape again
  const toggleSideLayout = () => setSideLayout(stacked ? 'columns' : 'rows')

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
  const agentsTickets = useAgentsTickets(issues)
  // What the sidebar lists: the Agents tab shows the tickets an agent works on
  const listed = isAgents ? agentsTickets.listed : issues
  const known = [...issues, ...extras.filter((e) => !issues.some((i) => i.key === e.key))]
  // Fall back to the first issue when nothing is selected or the selection left the list.
  // The board fills the main pane: a ticket opens beside it, in the side view.
  const selected = isBoard
    ? undefined
    : (known.find((i) => i.key === selectedKey) ?? (isList ? listed[0] : undefined))
  // The side view only shows while its issue is known and differs from the main one
  const side = known.find((i) => i.key === sideKey && i.key !== selected?.key)

  // The side view opening picks its layout from the window's shape (adjusted while rendering, so it never shows the old layout first)
  const [sideShown, setSideShown] = useState(false)
  if (!!side !== sideShown) {
    setSideShown(!!side)
    if (side) setSideLayout(layoutForWindow())
  }

  // Tickets moved to another status: the copies kept in state follow, the query caches are patched by the controller
  const movesController = useMovesController({
    selected,
    me: { accountId: session.accountId, displayName: session.displayName, avatarUrl: session.avatarUrl },
    patchLocal: (patches) =>
      setExtras((prev) => prev.map((e) => (patches[e.key] ? { ...e, ...patches[e.key] } : e))),
  })
  const { moves, overlay, assignPicker, boardDrag, toast, confirm, assignConfirm, editing, input } = movesController
  const assignedToMe = assignConfirm?.to.accountId === session.accountId

  // Opening another ticket (in the main or the side view) closes the "Assign to…" view: it was for the tickets
  // that were dragged, which are no longer what is in front of the person
  const { cancel: closeAssignPicker } = assignPicker
  useEffect(() => {
    closeAssignPicker()
  }, [selected?.key, side?.key, closeAssignPicker])
  const [dropHover, setDropHover] = useState(false)

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
      <div className="flex h-full bg-background text-foreground">
        <aside data-part="sidebar" className="flex w-96 flex-col border-r">
          <button
            onClick={() => setPalette('open')}
            className="flex h-[45px] items-center gap-2 border-b px-4 text-left text-sm text-muted-foreground hover:bg-accent"
          >
            <Search className="size-4" />
            <span>Search tickets…</span>
            <kbd className="ml-auto rounded border px-1.5 text-xs">Ctrl K</kbd>
          </button>

          <div className="flex items-center gap-2 border-b px-4 py-1.5">
            <div role="tablist" aria-label="Ticket view" className="flex rounded-md bg-muted p-0.5">
              {VIEWS.filter((v) => v.id !== 'agents' || agentsShown).map((v) =>
                v.id === 'agents' ? (
                  <AgentsTabButton
                    key={v.id}
                    selected={isAgents}
                    needsYou={agentsTickets.needsYou}
                    onPick={() => changeView('agents')}
                    dragged={moves.dragging.size > 0 ? overlay.issues : null}
                    onDropped={overlay.close}
                  />
                ) : (
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
                ),
              )}
            </div>
            {isList && data && (
              <span className="text-xs text-muted-foreground">
                {listed.length}
                {data.hasMore && !isAgents ? '+' : ''}
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

          {isBoard && (
            <div data-part="drop-hint" className="border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
              Drop board tickets here to take them. Drag one out onto the board to give it back.
            </div>
          )}

          <div className="relative flex min-h-0 flex-1 flex-col">
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
          ) : listed.length === 0 ? (
            <Message>{VIEWS.find((v) => v.id === view)?.empty}</Message>
          ) : (
            <div className={cn('flex min-h-0 flex-1 flex-col', isPlaceholderData && 'opacity-50')}>
              <IssueList
                issues={listed}
                selectedKey={selected?.key}
                sideKey={side?.key}
                // The board has the main pane: a ticket of the list opens beside it
                onSelect={isBoard ? setSideKey : select}
                onOpenSide={setSideKey}
              />
            </div>
          )}

          {boardDrag.active && (
            <div
              onDragOver={(e) => {
                e.preventDefault() // makes the list a valid drop target
                e.dataTransfer.dropEffect = 'move'
                setDropHover(true)
              }}
              onDragLeave={(e) => {
                // Leaving for a child doesn't count
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHover(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDropHover(false)
                boardDrag.drop()
              }}
              className={cn(
                'absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed bg-background/80 p-6 text-center text-sm font-medium backdrop-blur-[2px] transition-colors',
                dropHover ? 'border-primary bg-primary/10 text-foreground' : 'border-muted-foreground/40 text-muted-foreground',
              )}
            >
              <span data-part="drop-hint" className="pointer-events-none">
                Drop to assign to you
              </span>
            </div>
          )}
          </div>

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
            <Button variant="ghost" size="icon" title="Settings" onClick={() => openSettings()}>
              <Settings className="size-4" />
            </Button>
          </div>
        </aside>

        {/* Re-keyed when the side view opens/closes so the split starts at 50% / 50% */}
        {/* The overlay and the toast belong to the detail pane only: the list stays visible and droppable-from */}
        <div className="relative flex min-w-0 flex-1">
          <ResizablePanelGroup
            groupRef={splitRef}
            key={side ? `split-${sideLayout}` : 'single'}
            orientation={stacked ? 'vertical' : 'horizontal'}
            className="min-w-0 flex-1"
          >
            <ResizablePanel id="main" defaultSize="50%" minSize="25%">
              {isBoard ? (
                <main className="h-full min-w-0">
                  <BoardView
                    me={session.accountId}
                    myIssues={issues}
                    openKey={side?.key}
                    onOpen={(issue) => openFromTree(issue, true)}
                  />
                </main>
              ) : (
                <main className="h-full overflow-auto">
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
              )}
            </ResizablePanel>
            {side && (
              <>
                <ResizableHandle withHandle onDoubleClick={() => splitRef.current?.setLayout({ main: 50, side: 50 })} />
                {/*
                  A sibling of the divider, not a child: the resize library treats any pointer-down
                  on a child of the divider as a drag start, so the button would never get its click.
                  The library also only sees this button as covering the divider when the pointer
                  target is an HTML element, so the SVG icon ignores the pointer (otherwise the
                  resize cursor and drag come back over the icon itself).
                  The zero-size wrapper adds no space to the layout; the buttons straddle the divider.
                */}
                <div className={cn('relative z-20 shrink-0', stacked ? 'h-0 w-full' : 'w-0')}>
                  <div
                    className={cn(
                      'absolute flex gap-1',
                      stacked ? 'right-3 top-0 -translate-y-1/2 flex-row-reverse' : 'left-0 top-3 -translate-x-1/2 flex-col',
                    )}
                  >
                    <button
                      title="Close side view"
                      aria-label="Close side view"
                      onClick={() => setSideKey(undefined)}
                      className={SIDE_BUTTON}
                    >
                      {stacked ? (
                        <ChevronDown className="pointer-events-none size-3.5" />
                      ) : (
                        <ChevronRight className="pointer-events-none size-3.5" />
                      )}
                    </button>
                    <button
                      title={stacked ? 'Put the side view beside the main one' : 'Put the side view below the main one'}
                      aria-label={stacked ? 'Split vertically' : 'Split horizontally'}
                      onClick={toggleSideLayout}
                      className={SIDE_BUTTON}
                    >
                      {stacked ? (
                        <Columns2 className="pointer-events-none size-3" />
                      ) : (
                        <Rows2 className="pointer-events-none size-3" />
                      )}
                    </button>
                  </div>
                </div>
                <ResizablePanel id="side" defaultSize="50%" minSize="25%">
                  <aside className="h-full overflow-auto">
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

        <StatusGraphOverlay
          open={overlay.open}
          issues={overlay.issues}
          onDrop={overlay.onDrop}
          onEdit={overlay.onEdit}
          onAssign={overlay.onAssign}
          onUnassign={overlay.onUnassign}
          extra={<AgentsDropBand issues={overlay.issues} onDone={overlay.close} />}
        />
        {assignPicker.issues && (
          <AssignPicker issues={assignPicker.issues} onPick={assignPicker.pick} onCancel={assignPicker.cancel} />
        )}
        <MoveToast toast={toast} onUndo={movesController.undo} onDismiss={movesController.dismissToast} />
        <SprocketLayer />
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

        {assignConfirm && (
          <ConfirmDialog
            title={assignedToMe ? 'Take over from someone else?' : `Reassign to ${assignConfirm.to.displayName}?`}
            confirmLabel={assignedToMe ? 'Assign to me' : `Assign to ${assignConfirm.to.displayName}`}
            onConfirm={movesController.confirmAssign}
            onCancel={movesController.cancelAssign}
          >
            {assignConfirm.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <p>
              Assigning {assignConfirm.issues.length > 1 ? 'them' : 'it'} to {assignedToMe ? 'you' : assignConfirm.to.displayName} replaces who has{' '}
              {assignConfirm.issues.length > 1 ? 'them' : 'it'} now.
            </p>
          </ConfirmDialog>
        )}

        {input && (
          <TransitionInputDialog
            issues={input.issues}
            target={input.target}
            input={input.needed}
            me={{ accountId: session.accountId, displayName: session.displayName }}
            remembered={input.remembered}
            onRemember={movesController.rememberInput}
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

        <MediaViewer />

        <WhatsNew />

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
