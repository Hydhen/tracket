import { getCurrentWindow } from '@tauri-apps/api/window'
import { appStorage } from './storage'
import { DEFAULT_THEME, isThemeId, themeDef, type ThemeId } from './themes'

/** What is saved, and what the picker sets: one of the themes of `themes.ts` (System, Light, Dark or a fun one) */
export type ThemePreference = ThemeId

const STORAGE_KEY = 'tracket-theme'
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

export function getThemePreference(): ThemePreference {
  try {
    const stored = appStorage.getItem(STORAGE_KEY)
    // Only what is known: a theme this version doesn't have (saved by a newer one) falls back to the system's
    if (isThemeId(stored)) return stored
  } catch {
    // storage unavailable: fall back to the system theme
  }
  return DEFAULT_THEME
}

const inTauri = '__TAURI_INTERNALS__' in window
let nativeTheme: 'light' | 'dark' | 'system' | undefined

/** The window's own chrome (title bar) follows the choice too; "system" hands it back to Windows. */
function syncNativeTheme(scheme: 'light' | 'dark' | 'system') {
  if (!inTauri || scheme === nativeTheme) return
  nativeTheme = scheme
  getCurrentWindow()
    .setTheme(scheme === 'system' ? null : scheme)
    .catch(() => {
      // cosmetic only: the title bar keeps following Windows
      nativeTheme = undefined
    })
}

/**
 * Puts the saved theme on the page. Dark is a class (the colours of the dark theme, and the `dark:` variants), and a
 * fun theme is on top of light or dark, whichever it says it is built on, whatever the system is. The fun theme itself
 * is the `data-theme` of the page, which its own rules answer to.
 */
function apply() {
  const theme = themeDef(getThemePreference())
  const root = document.documentElement
  const dark = theme.scheme === 'dark' || (theme.scheme === 'system' && systemDark.matches)
  root.classList.toggle('dark', dark)
  if (theme.group === 'fun') root.dataset.theme = theme.id
  else delete root.dataset.theme
  syncNativeTheme(theme.scheme)
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === DEFAULT_THEME) appStorage.removeItem(STORAGE_KEY)
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
