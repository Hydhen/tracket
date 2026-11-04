import { isRunning, useTimers } from './timerStore'

/** A red light with a soft pulse; still when the person prefers reduced motion. */
export function RecordingDot({ label }: { label: string }) {
  return (
    <span role="img" aria-label={label} title={label} className="relative flex size-2 shrink-0">
      <span className="absolute inline-flex size-full rounded-full bg-red-500 opacity-60 motion-safe:animate-ping" />
      <span className="relative size-2 rounded-full bg-red-500" />
    </span>
  )
}

/** Marks a ticket in a list when its timer is running. */
export function TimerDot({ issueKey }: { issueKey: string }) {
  const running = useTimers((s) => isRunning(s.timers[issueKey]))
  return running ? <RecordingDot label="Timer running" /> : null
}
