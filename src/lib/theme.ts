import { getCurrentWindow } from '@tauri-apps/api/window'
import { appStorage } from './storage'
import { loadTheme } from '@/themes'
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
/** Counts the times a theme was applied, to tell a late one from the last one */
let applying = 0

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
async function apply() {
  const preference = getThemePreference()
  const theme = themeDef(preference)
  // A fun theme's rules come first: the page is never switched to a theme that has none yet. A later choice, made
  // while this one was loading, wins
  const turn = ++applying
  if (theme.group === 'fun') {
    await loadTheme(preference).catch((error) => console.error('Could not load the theme', preference, error))
    if (turn !== applying) return
  }
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
  void apply()
}

/**
 * Applies the saved theme and keeps following the system one when set to "system". Resolves once the page has the
 * theme: the app is shown after that, so that it never appears in another look first.
 */
export function initTheme() {
  systemDark.addEventListener('change', () => void apply())
  return apply()
}
