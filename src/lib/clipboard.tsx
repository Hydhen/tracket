import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** How long the "Copied!" popup stays; its fade-out (see `.copied-popup`) lasts as long */
const POPUP_MS = 2000

const COPIED_LABELS: Record<string, string> = {
  fr: 'Copié !',
  de: 'Kopiert!',
  es: '¡Copiado!',
  it: 'Copiato!',
  pt: 'Copiado!',
  nl: 'Gekopieerd!',
}

/** "Copied!" in the language of the system, English when there's no translation. */
export function copiedLabel(language: string = navigator.language): string {
  return COPIED_LABELS[language.slice(0, 2).toLowerCase()] ?? 'Copied!'
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard API unavailable or refused: fall back to the legacy command
    const area = document.createElement('textarea')
    area.value = text
    area.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(area)
    area.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      area.remove()
    }
  }
}

/**
 * A small "Copied!" popup that appears next to whatever was copied, then fades out over two
 * seconds. Call `show` with the element to point at and render `popup` anywhere in the component.
 * It is drawn at the page level, so no scrolling list or truncated row can clip it.
 */
export function useCopyPopup() {
  const [popup, setPopup] = useState<{ id: number; x: number; y: number; above: boolean } | null>(null)
  const timer = useRef<number>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const show = (anchor: Element) => {
    const rect = anchor.getBoundingClientRect()
    // Below the element, or above it when there is no room left under it
    const above = rect.bottom + 40 > window.innerHeight
    setPopup((previous) => ({
      // A new id restarts the animation when copying again before the last one faded
      id: (previous?.id ?? 0) + 1,
      x: Math.min(Math.max(rect.left + rect.width / 2, 48), window.innerWidth - 48),
      y: above ? rect.top - 6 : rect.bottom + 6,
      above,
    }))
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPopup(null), POPUP_MS)
  }

  const element =
    popup &&
    createPortal(
      <div
        key={popup.id}
        role="status"
        className="copied-popup pointer-events-none fixed z-[60] rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md"
        style={{
          left: popup.x,
          top: popup.y,
          transform: popup.above ? 'translate(-50%, -100%)' : 'translateX(-50%)',
        }}
      >
        {copiedLabel()}
      </div>,
      document.body,
    )

  return { show, popup: element }
}
