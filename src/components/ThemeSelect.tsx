import { useSyncExternalStore } from 'react'
import { getThemePreference, setThemePreference, subscribeTheme } from '@/lib/theme'
import { DEFAULT_THEME, THEMES, type ThemeId } from '@/lib/themes'
import { cn } from '@/lib/utils'
import { isBuilt } from '@/themes'

const GROUPS = [
  { id: 'standard', label: 'Standard' },
  { id: 'fun', label: 'Fun' },
] as const

/**
 * The one place to choose the theme, System, Light, Dark and the fun ones alike (in the Appearance settings). It is a
 * native select, so the keyboard and the screen readers have it for free.
 */
export function ThemeSelect({ className }: { className?: string }) {
  const saved = useSyncExternalStore(subscribeTheme, getThemePreference)
  // A theme this version lists but hasn't built is shown as the default
  const preference = isBuilt(saved) ? saved : DEFAULT_THEME

  return (
    <select
      aria-label="Theme"
      value={preference}
      onChange={(e) => {
        setThemePreference(e.target.value as ThemeId)
      }}
      className={cn(
        'h-8 min-w-48 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
    >
      {GROUPS.map((group) => {
        const themes = THEMES.filter((t) => t.group === group.id && isBuilt(t.id))
        return themes.length === 0 ? null : (
          <optgroup key={group.id} label={group.label}>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </optgroup>
        )
      })}
    </select>
  )
}
