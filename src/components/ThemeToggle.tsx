import { Monitor, Moon, Palette, Sun } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { getThemePreference, setThemePreference, type ThemePreference } from '@/lib/theme'
import { themeDef, type StandardThemeId } from '@/lib/themes'

const CYCLE: readonly StandardThemeId[] = ['system', 'light', 'dark']
const ICON = { system: Monitor, light: Sun, dark: Moon }

/** The standard theme after this one. A fun theme goes back to the start of the cycle. */
const next = (preference: ThemePreference): StandardThemeId => {
  const at = CYCLE.findIndex((id) => id === preference)
  return CYCLE[(at + 1) % CYCLE.length]
}

/** Cycles System → Light → Dark. */
export function ThemeToggle() {
  const [preference, setPreference] = useState(getThemePreference)
  const Icon = preference in ICON ? ICON[preference as StandardThemeId] : Palette
  const after = next(preference)

  return (
    <Button
      variant="ghost"
      size="icon"
      title={`Theme: ${themeDef(preference).label} (click for ${themeDef(after).label})`}
      onClick={() => {
        setThemePreference(after)
        setPreference(after)
      }}
    >
      <Icon className="size-4" />
    </Button>
  )
}
