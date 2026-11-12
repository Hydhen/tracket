import { elapsedOf, isRunning, useNow, useTimers } from './timerStore'

/** What the timers add up to, ticking each second while one runs. */
export function useTimerSummary() {
  const timers = useTimers((s) => s.timers)
  const all = Object.values(timers)
  const running = all.filter(isRunning)
  const now = useNow(running.length > 0)
  const sum = (list: typeof all) => list.reduce((total, t) => total + elapsedOf(t, now), 0)
  return { count: all.length, running: running.length, runningMs: sum(running), totalMs: sum(all) }
}
