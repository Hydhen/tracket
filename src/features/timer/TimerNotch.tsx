import { Minimize2 } from 'lucide-react'
import { useState } from 'react'
import { formatClock } from './duration'
import { useMiniMode } from './miniMode'
import { RecordingDot } from './RecordingDot'
import { useTimerSummary } from './useTimerSummary'

/**
 * A rounded notch in the middle of the title bar while a timer runs: a red light and the time on the
 * running timers (added up when tickets are worked on in parallel). It slides away when they stop.
 * Pointing at it shows the button that shrinks the window to this notch alone. Dragging it moves the
 * window, like the rest of the bar.
 */
export function TimerNotch() {
  const { running, runningMs } = useTimerSummary()
  // While it slides out nothing is running: it keeps showing what it showed last
  const [held, setHeld] = useState({ ms: 0, count: 0 })
  const visible = running > 0
  if (visible && (held.ms !== runningMs || held.count !== running)) setHeld({ ms: runningMs, count: running })
  const ms = visible ? runningMs : held.ms
  const count = visible ? running : held.count

  return (
    <div className="pointer-events-none absolute inset-x-0 top-1.5 flex justify-center" aria-hidden={!visible}>
      <div className="timer-pill timer-notch pointer-events-auto" data-hidden={!visible} data-tauri-drag-region>
        {/* Children of the drag region are not draggable unless they say so */}
        <span data-tauri-drag-region className="pointer-events-none flex items-center gap-2" role="status" aria-live="off">
          <RecordingDot label={count > 1 ? `${count} timers running` : 'Timer running'} />
          <span className="text-xs font-medium tabular-nums">{formatClock(ms)}</span>
          {count > 1 && <span className="text-[0.6875rem] text-white/60">×{count}</span>}
        </span>
        <button
          type="button"
          className="timer-pill-action"
          title="Shrink to the notch"
          aria-label="Shrink the window to the timer notch"
          tabIndex={visible ? 0 : -1}
          onClick={() => void useMiniMode.getState().setMini(true)}
        >
          <Minimize2 className="size-3" />
        </button>
      </div>
    </div>
  )
}
