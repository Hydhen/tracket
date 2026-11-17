import { Maximize, Minimize, Minus, Plus, ScanSearch, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useMediaViewer, type MediaItem } from './useMediaViewer'

const MAX_SCALE = 10
const STEP = 1.25
const clamp = (scale: number) => Math.min(MAX_SCALE, Math.max(1, scale))

interface View {
  /** 1 is the picture fitted to the window */
  scale: number
  /** Where the picture was dragged to, in pixels from the centre */
  x: number
  y: number
}
const FIT: View = { scale: 1, x: 0, y: 0 }

/** The room a video keeps for its own controls at the bottom: a drag there isn't a pan */
const VIDEO_CONTROLS_PX = 56

const TOOL = 'text-inherit hover:bg-white/15 hover:text-white'

function Viewer({ item }: { item: MediaItem }) {
  const close = useMediaViewer((s) => s.close)
  const [view, setView] = useState(FIT)
  const [panning, setPanning] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [src, setSrc] = useState(item.src)
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const drag = useRef<{ x: number; y: number; from: View; moved: boolean } | null>(null)
  // A drag that moved is not a click: it must not close the viewer
  const swallowClick = useRef(false)
  const canFullscreen = document.fullscreenEnabled === true

  // Both only use state setters and refs read when called, so the listeners below can be set up once
  /** Zooms by `factor`, keeping what is under (cx, cy) — in pixels from the centre — where it is. */
  const zoomAt = useCallback((factor: number, cx = 0, cy = 0) => {
    setView((v) => {
      const scale = clamp(v.scale * factor)
      if (scale === 1) return FIT
      const k = scale / v.scale
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
    })
  }, [])

  /** Where a pointer is, in pixels from the centre of the stage */
  const fromCentre = useCallback((clientX: number, clientY: number) => {
    const rect = stage.current?.getBoundingClientRect()
    return rect ? { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) } : { x: 0, y: 0 }
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void root.current?.requestFullscreen?.()
  }

  // The picture at its real size: as many times larger than fitted as it has pixels to spare
  const actualSize = () => {
    const el = image.current
    if (!el || !el.clientWidth) return
    setView({ scale: clamp(el.naturalWidth / el.clientWidth), x: 0, y: 0 })
  }

  useEffect(() => {
    const el = root.current
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Nothing else may react to it: a dialog or a drag underneath isn't what is being closed
        e.stopPropagation()
        if (document.fullscreenElement) void document.exitFullscreen()
        else close()
      } else if (e.key === '+' || e.key === '=') zoomAt(STEP)
      else if (e.key === '-') zoomAt(1 / STEP)
      else if (e.key === '0') setView(FIT)
    }
    const onFullscreen = () => setFullscreen(document.fullscreenElement === el)
    // Captured, so that it comes before the window's own handlers
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('fullscreenchange', onFullscreen)
      if (document.fullscreenElement === el) void document.exitFullscreen()
    }
  }, [close, zoomAt])

  // The wheel zooms where the pointer is. A listener that isn't passive can stop the page behind from scrolling
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const at = fromCentre(e.clientX, e.clientY)
      zoomAt(Math.exp(-e.deltaY * 0.002), at.x, at.y)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, fromCentre])

  // The video carries on from where the page's own player was
  const onLoadedMetadata = () => {
    if (item.startAt && video.current) video.current.currentTime = item.startAt
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || view.scale === 1) return
    const el = video.current
    if (el && e.clientY > el.getBoundingClientRect().bottom - VIDEO_CONTROLS_PX) return
    drag.current = { x: e.clientX, y: e.clientY, from: view, moved: false }
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) {
      d.moved = true
      setPanning(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setView({ scale: d.from.scale, x: d.from.x + dx, y: d.from.y + dy })
  }
  const onPointerEnd = () => {
    if (drag.current?.moved) swallowClick.current = true
    drag.current = null
    setPanning(false)
  }

  const onDoubleClick = (e: MouseEvent) => {
    if (view.scale > 1) return setView(FIT)
    const at = fromCentre(e.clientX, e.clientY)
    zoomAt(2.5, at.x, at.y)
  }

  const zoomed = view.scale > 1
  const style = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    transition: panning ? 'none' : 'transform 90ms ease-out',
  }

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={item.title || (item.kind === 'image' ? 'Picture' : 'Video')}
      // Dark whatever the theme, like the drag overlay: pictures and videos read best on it
      className="fixed inset-0 z-[60] flex flex-col bg-black/90 text-[#f4f4f5] backdrop-blur-[2px]"
    >
      <div className="flex items-center gap-1 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm text-[#d4d4d8]">{item.title}</span>
        <Button
          variant="ghost"
          size="icon"
          className={TOOL}
          title="Zoom out (-)"
          aria-label="Zoom out"
          disabled={!zoomed}
          onClick={() => zoomAt(1 / STEP)}
        >
          <Minus className="size-4" />
        </Button>
        <button
          type="button"
          title="Fit to the window (0)"
          aria-label="Fit to the window"
          onClick={() => setView(FIT)}
          className="min-w-12 rounded-md px-1.5 py-1 text-center text-xs tabular-nums text-[#d4d4d8] hover:bg-white/15"
        >
          {Math.round(view.scale * 100)}%
        </button>
        <Button
          variant="ghost"
          size="icon"
          className={TOOL}
          title="Zoom in (+)"
          aria-label="Zoom in"
          disabled={view.scale >= MAX_SCALE}
          onClick={() => zoomAt(STEP)}
        >
          <Plus className="size-4" />
        </Button>
        {item.kind === 'image' && (
          <Button variant="ghost" size="icon" className={TOOL} title="Actual size" aria-label="Actual size" onClick={actualSize}>
            <ScanSearch className="size-4" />
          </Button>
        )}
        {canFullscreen && (
          <Button
            variant="ghost"
            size="icon"
            className={TOOL}
            title={fullscreen ? 'Leave full screen' : 'Full screen'}
            aria-label={fullscreen ? 'Leave full screen' : 'Full screen'}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </Button>
        )}
        <Button variant="ghost" size="icon" className={TOOL} title="Close (Esc)" aria-label="Close" onClick={close}>
          <X className="size-4" />
        </Button>
      </div>

      <div
        ref={stage}
        className={cn(
          'relative flex min-h-0 flex-1 select-none items-center justify-center overflow-hidden p-4 pt-0',
          zoomed && (panning ? 'cursor-grabbing' : 'cursor-grab'),
        )}
        // The empty space around the picture closes the viewer, as in any lightbox
        onClick={(e) => {
          if (swallowClick.current) {
            swallowClick.current = false
            return
          }
          if (e.target === e.currentTarget) close()
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {item.kind === 'image' ? (
          <img
            ref={image}
            src={src}
            alt={item.title ?? ''}
            draggable={false}
            style={style}
            onDoubleClick={onDoubleClick}
            // Not a picture after all (a link to a document): what it was a thumbnail of
            onError={() => item.fallback && src !== item.fallback && setSrc(item.fallback)}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <video
            ref={video}
            src={src}
            controls
            autoPlay
            playsInline
            style={style}
            onLoadedMetadata={onLoadedMetadata}
            className="max-h-full max-w-full rounded bg-black"
          />
        )}
      </div>
    </div>
  )
}

/** Shows a picture or a video full size, to zoom into and to play in full screen. Rendered once, by the app. */
export function MediaViewer() {
  const item = useMediaViewer((s) => s.item)
  // A new item starts from a fresh view
  return item ? createPortal(<Viewer key={item.src} item={item} />, document.body) : null
}
