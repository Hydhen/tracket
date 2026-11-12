import { getCurrentWindow } from '@tauri-apps/api/window'
import { Maximize2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import { formatClock } from './duration'
import { useMiniMode } from './miniMode'
import { RecordingDot } from './RecordingDot'
import { useTimerSummary } from './useTimerSummary'

/**
 * The whole window while it is mini: the timer in a round pill that stays on top of the other
 * windows. Drag it to move it; pointing at it shows the button that brings the app back.
 */
export function MiniNotch() {
  const { count, running, runningMs, totalMs } = useTimerSummary()

  // A drag region would also maximise the window on a double click
  const drag = (e: MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    void getCurrentWindow()
      .startDragging()
      .catch(() => {})
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center p-0.5">
      <div className="timer-pill mini-notch" onMouseDown={drag}>
        <span className="pointer-events-none flex items-center gap-2" role="status" aria-live="off">
          {count === 0 ? (
            <span className="text-sm text-white/60">No timer</span>
          ) : (
            <>
              {running > 0 ? (
                <RecordingDot label={running > 1 ? `${running} timers running` : 'Timer running'} />
              ) : (
                <span role="img" aria-label="Timers paused" title="Timers paused" className="size-2 rounded-full bg-white/35" />
              )}
              <span className="text-sm font-medium tabular-nums">{formatClock(running > 0 ? runningMs : totalMs)}</span>
              {running > 1 && <span className="text-xs text-white/60">×{running}</span>}
            </>
          )}
        </span>
        <button
          type="button"
          className="timer-pill-action"
          title="Back to the app"
          aria-label="Back to the app"
          onClick={() => void useMiniMode.getState().setMini(false)}
        >
          <Maximize2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
