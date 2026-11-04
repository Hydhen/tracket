import { invoke } from '@tauri-apps/api/core'
import { createJSONStorage } from 'zustand/middleware'

/**
 * Where settings, timers and other remembered state live.
 *
 * The webview's localStorage belongs to one origin, so the installed app and `tauri dev` (which are served from
 * different origins) could never share it. The state is kept in one JSON file on the Rust side instead, read by
 * every build, and mirrored here so reads stay synchronous: `loadStorage` must finish before anything reads it.
 */

const PREFIX = 'tracket-'
/** Set in this origin's localStorage once its old content has been moved to the file */
const MIGRATED = 'tracket-storage-migrated'

const inTauri = '__TAURI_INTERNALS__' in window
const cache = new Map<string, string>()

const save = (key: string, value: string | null) => {
  invoke('storage_set', { key, value }).catch((error) => console.error('Could not save', key, error))
}

/**
 * Moves what an earlier version kept in localStorage into the file, once. Only the installed app does it:
 * it holds the configuration worth keeping, whereas a dev build's old localStorage is just test data.
 */
function migrateLocalStorage() {
  if (import.meta.env.DEV) return
  try {
    if (localStorage.getItem(MIGRATED)) return
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) && k !== MIGRATED)
    for (const key of keys) {
      const value = localStorage.getItem(key)
      if (value === null) continue
      cache.set(key, value)
      save(key, value)
      localStorage.removeItem(key)
    }
    localStorage.setItem(MIGRATED, '1')
  } catch {
    // storage unavailable: nothing to migrate
  }
}

export async function loadStorage() {
  if (!inTauri) return
  const stored = await invoke<Record<string, string>>('storage_load')
  for (const [key, value] of Object.entries(stored)) cache.set(key, value)
  migrateLocalStorage()
}

export const appStorage = {
  getItem: (key: string): string | null => (inTauri ? (cache.get(key) ?? null) : localStorage.getItem(key)),
  setItem: (key: string, value: string): void => {
    if (!inTauri) return localStorage.setItem(key, value)
    cache.set(key, value)
    save(key, value)
  },
  removeItem: (key: string): void => {
    if (!inTauri) return localStorage.removeItem(key)
    cache.delete(key)
    save(key, null)
  },
}

/** For zustand's `persist`: JSON in the shared file */
export const persistStorage = createJSONStorage(() => appStorage)
