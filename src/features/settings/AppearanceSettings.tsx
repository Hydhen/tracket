import { useSyncExternalStore } from 'react'
import { ThemeSelect } from '@/components/ThemeSelect'
import { getThemeOption, getThemePreference, setThemeOption, subscribeTheme } from '@/lib/theme'
import { DEFAULT_THEME, themeDef, type ThemeId, type ThemeOption } from '@/lib/themes'
import { isBuilt } from '@/themes'

function OptionToggle({ theme, option }: { theme: ThemeId; option: ThemeOption }) {
  const on = useSyncExternalStore(subscribeTheme, () => getThemeOption(theme, option))
  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => setThemeOption(theme, option, e.target.checked)} />
        {option.label}
      </label>
      <p className="ml-6 text-xs text-muted-foreground">{option.hint}</p>
    </div>
  )
}

export function AppearanceSettings() {
  const saved = useSyncExternalStore(subscribeTheme, getThemePreference)
  // The same theme the select shows: one this version lists but hasn't built is the default
  const theme = isBuilt(saved) ? saved : DEFAULT_THEME
  const def = themeDef(theme)

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Theme</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        System follows Windows, light or dark. The fun themes are looks of their own: they are for fun, and don't
        promise the contrast of the standard ones.
      </p>
      <ThemeSelect className="mt-3" />

      {/* What the theme in use offers: nothing for the standard ones */}
      {def.options && def.options.length > 0 && (
        <>
          <h3 className="mt-8 text-xs font-medium uppercase tracking-wide text-muted-foreground">{def.label}</h3>
          <div className="mt-2 flex flex-col gap-3">
            {def.options.map((option) => (
              <OptionToggle key={option.id} theme={theme} option={option} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
