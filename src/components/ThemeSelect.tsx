import { Monitor, Moon, Palette, Sun, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { getThemePreference, setThemePreference } from '@/lib/theme'
import { DEFAULT_THEME, THEMES, themeDef, type ThemeId } from '@/lib/themes'
import { cn } from '@/lib/utils'
import { isBuilt } from '@/themes'

const ICONS: Partial<Record<ThemeId, LucideIcon>> = { system: Monitor, light: Sun, dark: Moon }

const GROUPS = [
  { id: 'standard', label: 'Standard' },
  { id: 'fun', label: 'Fun' },
] as const

/**
 * The one place to choose the theme, System, Light, Dark and the fun ones alike. It is a native select, so the
 * keyboard and the screen readers have it for free: as a field in the settings, or as an icon (the select itself
 * is over it, see-through) in the sidebar.
 */
export function ThemeSelect({ variant = 'field', className }: { variant?: 'field' | 'icon'; className?: string }) {
  const [saved, setSaved] = useState(getThemePreference)
  // A theme this version lists but hasn't built is shown as the default
  const preference = isBuilt(saved) ? saved : DEFAULT_THEME
  const Icon = ICONS[preference] ?? Palette
  const label = themeDef(preference).label

  const select = (
    <select
      aria-label="Theme"
      title={variant === 'icon' ? `Theme: ${label}` : undefined}
      value={preference}
      onChange={(e) => {
        const next = e.target.value as ThemeId
        setThemePreference(next)
        setSaved(next)
      }}
      className={cn(
        variant === 'icon'
          ? 'absolute inset-0 size-full cursor-pointer opacity-0'
          : 'h-8 min-w-48 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        variant === 'field' && className,
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

  if (variant === 'field') return select
  return (
    <span
      className={cn(
        'relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent focus-within:ring-3 focus-within:ring-ring/50',
        className,
      )}
    >
      <Icon className="size-4" />
      {select}
    </span>
  )
}
