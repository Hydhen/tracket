import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { useMediaViewer } from '@/features/media/useMediaViewer'
import { prepareJiraHtml, type AttachmentRef } from '@/lib/html'
import { cn } from '@/lib/utils'

function settle(img: HTMLImageElement) {
  const wrap = img.closest<HTMLElement>('.jira-img-wrap')
  if (wrap) wrap.dataset.state = img.naturalWidth > 0 ? 'loaded' : 'error'
}

/** A video that can't be played shows a link to open it instead */
function failVideo(video: HTMLVideoElement) {
  video.closest<HTMLElement>('.jira-video-wrap')?.setAttribute('data-state', 'error')
}

/**
 * Renders Jira-rendered HTML (sanitized). Links open in the system browser; a picture or a video opens full size in
 * the viewer, to zoom into and to play in full screen.
 */
export function JiraHtml({
  html,
  site,
  attachments,
  className,
}: {
  html: string
  site: string
  /** The files attached to the ticket: they say what a picture or a video embedded in the text is */
  attachments?: AttachmentRef[]
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const prepared = useMemo(() => prepareJiraHtml(html, site, attachments), [html, site, attachments])

  // Image load/error events don't bubble, so listen in the capture phase
  useEffect(() => {
    const root = ref.current
    if (!root) return
    // Cached images may already be done before we start listening
    for (const img of root.querySelectorAll('img')) if (img.complete) settle(img)
    const onDone = (e: Event) => {
      if (e.target instanceof HTMLImageElement) settle(e.target)
      else if (e.target instanceof HTMLVideoElement && e.type === 'error') failVideo(e.target)
    }
    root.addEventListener('load', onDone, true)
    root.addEventListener('error', onDone, true)
    return () => {
      root.removeEventListener('load', onDone, true)
      root.removeEventListener('error', onDone, true)
    }
  }, [prepared])

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement

    const expand = target.closest('.jira-expand')
    if (expand) {
      e.preventDefault()
      const video = expand.parentElement?.querySelector('video')
      if (video) {
        video.pause()
        useMediaViewer.getState().open({
          kind: 'video',
          src: video.currentSrc || video.src,
          title: video.title,
          startAt: video.currentTime,
        })
      }
      return
    }

    // A picture, even one that links to the attachment, is looked at here rather than in the browser
    const image = target.closest<HTMLImageElement>('.jira-img-wrap[data-state="loaded"] img')
    if (image) {
      e.preventDefault()
      const full = image.dataset.full
      useMediaViewer.getState().open({
        kind: 'image',
        src: full ?? image.currentSrc ?? image.src,
        fallback: full ? image.currentSrc || image.src : undefined,
        title: image.alt || undefined,
      })
      return
    }

    const anchor = target.closest('a')
    if (!anchor) return
    e.preventDefault()
    const href = anchor.getAttribute('href')
    if (href && /^https?:/i.test(href)) openUrl(href)
  }

  return (
    <div
      ref={ref}
      className={cn(
        'jira-html prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-pre:my-2',
        className,
      )}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: prepared }}
    />
  )
}
