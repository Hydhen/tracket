import { cn } from '@/lib/utils'
import { LauncherLogo } from './LauncherLogo'
import { LAUNCHERS, useLauncher } from './launcher'
import { ProjectsSettings } from './ProjectsSettings'

/**
 * Everything the "Start working" button of a ticket uses: the app it opens the worktree in, and
 * the projects that say which folder a ticket's worktree is made in.
 */
export function QuickStartSettings({ initialProject }: { initialProject?: string }) {
  const { app, setApp } = useLauncher()

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quick start</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        The button at the top of a ticket creates a git worktree named after it and opens it for you to work on.
      </p>

      <h4 className="mt-5 text-sm font-semibold">Open it in</h4>
      <div role="radiogroup" aria-label="App to open the worktree in" className="mt-2 grid gap-2 sm:grid-cols-2">
        {LAUNCHERS.map((launcher) => (
          <label
            key={launcher.id}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-md border p-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
              app === launcher.id ? 'border-ring bg-accent/50 ring-1 ring-ring' : 'hover:bg-accent/30',
            )}
          >
            <input
              type="radio"
              name="launcher"
              checked={app === launcher.id}
              onChange={() => setApp(launcher.id)}
              className="sr-only"
            />
            <LauncherLogo id={launcher.id} className="size-8 shrink-0 rounded-md" />
            <span>
              <span className="block text-sm font-medium">{launcher.name}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{launcher.detail}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="mt-6 border-t pt-4">
        <ProjectsSettings initialProject={initialProject} />
      </div>
    </div>
  )
}
