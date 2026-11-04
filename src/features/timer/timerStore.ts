import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { persistStorage } from '@/lib/storage'

/** A stopwatch on one ticket. Running when `startedAt` is set; the clock keeps going while the app is closed. */
export interface Timer {
  /** Time banked from earlier runs, in ms */
  elapsedMs: number
  /** Epoch ms of the current run, null when paused */
  startedAt: number | null
}

export const elapsedOf = (timer: Timer, now: number) =>
  timer.elapsedMs + (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt))

interface TimerState {
  timers: Record<string, Timer>
  /** Starts or resumes. Tickets are worked on in parallel, so the others keep running */
  start: (key: string) => void
  pause: (key: string) => void
  /** Pauses every running timer, keeping the time */
  pauseAll: () => void
  discard: (key: string) => void
}

const bank = (timer: Timer, now: number): Timer => ({ elapsedMs: elapsedOf(timer, now), startedAt: null })

export const isRunning = (timer: Timer | undefined) => timer?.startedAt != null

export const useTimers = create<TimerState>()(
  persist(
    (set) => ({
      timers: {},
      start: (key) =>
        set(({ timers }) => {
          if (isRunning(timers[key])) return { timers }
          return { timers: { ...timers, [key]: { elapsedMs: timers[key]?.elapsedMs ?? 0, startedAt: Date.now() } } }
        }),
      pause: (key) =>
        set(({ timers }) => {
          const timer = timers[key]
          if (!timer || timer.startedAt === null) return { timers }
          return { timers: { ...timers, [key]: bank(timer, Date.now()) } }
        }),
      pauseAll: () =>
        set(({ timers }) => {
          const now = Date.now()
          const next: Record<string, Timer> = {}
          for (const [k, t] of Object.entries(timers)) next[k] = t.startedAt === null ? t : bank(t, now)
          return { timers: next }
        }),
      discard: (key) =>
        set(({ timers }) => {
          const { [key]: _gone, ...rest } = timers
          return { timers: rest }
        }),
    }),
    {
      name: 'tracket-timers',
      storage: persistStorage,
      version: 1,
      partialize: (s) => ({ timers: s.timers }),
      // Stored data can be damaged by hand: keep only well-formed timers
      merge: (persisted, current) => {
        const stored = (persisted as { timers?: Record<string, Partial<Timer>> } | undefined)?.timers ?? {}
        const timers: Record<string, Timer> = {}
        for (const [key, t] of Object.entries(stored)) {
          if (typeof t?.elapsedMs !== 'number' || !Number.isFinite(t.elapsedMs) || t.elapsedMs < 0) continue
          const startedAt = typeof t.startedAt === 'number' && Number.isFinite(t.startedAt) ? t.startedAt : null
          timers[key] = { elapsedMs: t.elapsedMs, startedAt }
        }
        return { ...current, timers }
      },
    },
  ),
)

/** The current time, refreshed every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}
