import { getCurrentWindow } from '@tauri-apps/api/window'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { TimerNotch } from '@/features/timer/TimerNotch'
import { cn } from '@/lib/utils'

const inTauri = '__TAURI_INTERNALS__' in window

/** The logo's chevrons, still, in the spinner's colours. */
function Mark() {
  return (
    <svg aria-hidden viewBox="212 290 628 444" className="spinner-mark h-3.5 w-auto">
      <path d="M262 340 L392 512 L262 684" />
      <path d="M458 340 L588 512 L458 684" />
      <path d="M654 340 L784 512 L654 684" />
    </svg>
  )
}

function ControlButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex h-full w-11.5 items-center justify-center text-muted-foreground transition-colors hover:text-foreground',
        danger ? 'hover:bg-red-600 hover:text-white' : 'hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The window has no native title bar (see `decorations` in tauri.conf.json): this is it. The bar drags
 * the window and maximises it on a double click (`data-tauri-drag-region`); its right end has the usual
 * three buttons.
 */
export function TitleBar() {
  const [title, setTitle] = useState('Tracket')
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!inTauri) return
    const win = getCurrentWindow()
    // "Tracket Dev" in the development build, as its own config says
    win.title().then(setTitle).catch(() => {})
    const sync = () => win.isMaximized().then(setMaximized).catch(() => {})
    void sync()
    const unlisten = win.onResized(sync)
    return () => void unlisten.then((off) => off())
  }, [])

  if (!inTauri) return null
  const win = getCurrentWindow()

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-9 shrink-0 select-none items-center border-b bg-background text-foreground"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3.5">
        {/* Children of the drag region are not draggable unless they say so */}
        <span data-tauri-drag-region className="pointer-events-none flex items-center">
          <Mark />
        </span>
        <span data-tauri-drag-region className="pointer-events-none text-xs font-medium text-muted-foreground">
          {title}
        </span>
      </div>

      <TimerNotch />

      <div className="relative ml-auto flex h-full">
        <ControlButton label="Minimize" onClick={() => void win.minimize()}>
          <Minus className="size-4" />
        </ControlButton>
        <ControlButton label={maximized ? 'Restore' : 'Maximize'} onClick={() => void win.toggleMaximize()}>
          {maximized ? <Copy className="size-3 -scale-x-100" /> : <Square className="size-3" />}
        </ControlButton>
        <ControlButton label="Close" danger onClick={() => void win.close()}>
          <X className="size-4" />
        </ControlButton>
      </div>
    </div>
  )
}
