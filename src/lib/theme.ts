export type ThemePreference = 'system' | 'light' | 'dark'

import { getCurrentWindow } from '@tauri-apps/api/window'
import { appStorage } from './storage'

const STORAGE_KEY = 'tracket-theme'
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

export function getThemePreference(): ThemePreference {
  try {
    const stored = appStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // storage unavailable: fall back to the system theme
  }
  return 'system'
}

const inTauri = '__TAURI_INTERNALS__' in window
let nativeTheme: ThemePreference | undefined

/** The window's own chrome (title bar) follows the choice too; "system" hands it back to Windows. */
function syncNativeTheme(preference: ThemePreference) {
  if (!inTauri || preference === nativeTheme) return
  nativeTheme = preference
  getCurrentWindow()
    .setTheme(preference === 'system' ? null : preference)
    .catch(() => {
      // cosmetic only: the title bar keeps following Windows
      nativeTheme = undefined
    })
}

function apply() {
  const preference = getThemePreference()
  const dark = preference === 'dark' || (preference === 'system' && systemDark.matches)
  document.documentElement.classList.toggle('dark', dark)
  syncNativeTheme(preference)
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') appStorage.removeItem(STORAGE_KEY)
    else appStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // the choice still applies for this session
  }
  apply()
}

/** Applies the saved theme and keeps following the system one when set to "system". */
export function initTheme() {
  apply()
  systemDark.addEventListener('change', apply)
}
