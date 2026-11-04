import { Monitor, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { getThemePreference, setThemePreference, type ThemePreference } from '@/lib/theme'

const NEXT: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' }
const ICON = { system: Monitor, light: Sun, dark: Moon }

/** Cycles System → Light → Dark. */
export function ThemeToggle() {
  const [preference, setPreference] = useState(getThemePreference)
  const Icon = ICON[preference]

  return (
    <Button
      variant="ghost"
      size="icon"
      title={`Theme: ${LABEL[preference]} (click for ${LABEL[NEXT[preference]]})`}
      onClick={() => {
        const next = NEXT[preference]
        setThemePreference(next)
        setPreference(next)
      }}
    >
      <Icon className="size-4" />
    </Button>
  )
}
