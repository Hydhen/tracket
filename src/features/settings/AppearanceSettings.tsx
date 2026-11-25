import { ThemeSelect } from '@/components/ThemeSelect'

export function AppearanceSettings() {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Theme</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        System follows Windows, light or dark. The fun themes are looks of their own: they are for fun, and don't
        promise the contrast of the standard ones.
      </p>
      <ThemeSelect className="mt-3" />
    </div>
  )
}
