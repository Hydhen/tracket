import { openUrl } from '@tauri-apps/plugin-opener'
import type { MoveToast as MoveToastState } from './useMovesController'

/**
 * Bottom-centre message after tickets were moved: what happened, with Undo, and what went wrong.
 * The wrapper is a live region that is always mounted, so screen readers announce what appears in it.
 */
export function MoveToast({
  toast,
  onUndo,
  onDismiss,
}: {
  toast: MoveToastState | null
  onUndo: () => void
  onDismiss: () => void
}) {
  const movedLabel =
    toast && toast.moved.length > 0 ? (toast.moved.length > 1 ? `${toast.moved.length} tickets` : toast.moved[0].key) : null

  return (
    <div role="status" className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-4">
      {toast && (
        <div className="move-toast pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border bg-popover py-1 pl-4 pr-1.5 text-[13px] text-popover-foreground shadow-lg">
          <div className="min-w-0 py-2">
            {movedLabel && toast.to && (
              <div>
                {movedLabel} moved to {toast.to.name.toUpperCase()}
              </div>
            )}
            {toast.message && <div>{toast.message}</div>}
            {toast.errors.map((message) => (
              <div key={message} className="text-destructive">
                {message}
              </div>
            ))}
          </div>
          {movedLabel && (
            <button
              onClick={onUndo}
              className="h-11 shrink-0 rounded-lg px-3.5 text-[13px] font-semibold text-blue-600 hover:bg-accent dark:text-blue-300"
            >
              Undo
            </button>
          )}
          {toast.retry && (
            <button
              onClick={toast.retry}
              className="h-11 shrink-0 rounded-lg px-3.5 text-[13px] font-semibold text-blue-600 hover:bg-accent dark:text-blue-300"
            >
              Fill in details
            </button>
          )}
          {toast.failedUrl && (
            <button
              onClick={() => openUrl(toast.failedUrl!)}
              className="h-11 shrink-0 rounded-lg px-3.5 text-[13px] font-medium hover:bg-accent"
            >
              Open in Jira
            </button>
          )}
          {!movedLabel && (
            <button onClick={onDismiss} className="h-11 shrink-0 rounded-lg px-3.5 text-[13px] hover:bg-accent">
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  )
}
