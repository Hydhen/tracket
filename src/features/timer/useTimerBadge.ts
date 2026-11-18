import { useEffect } from 'react'
import { api } from '@/lib/api'
import { isRunning, useTimers } from './timerStore'

/** Keeps a red dot on the app's icon in the taskbar for as long as at least one timer is running. */
export function useTimerBadge() {
  const running = useTimers((s) => Object.values(s.timers).some(isRunning))

  useEffect(() => {
    api.setTimerBadge(running).catch((error) => console.error('Could not change the taskbar icon', error))
  }, [running])
}
