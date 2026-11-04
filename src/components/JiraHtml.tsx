import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { prepareJiraHtml } from '@/lib/html'
import { cn } from '@/lib/utils'

function settle(img: HTMLImageElement) {
  const wrap = img.closest<HTMLElement>('.jira-img-wrap')
  if (wrap) wrap.dataset.state = img.naturalWidth > 0 ? 'loaded' : 'error'
}

/** Renders Jira-rendered HTML (sanitized). Links open in the system browser. */
export function JiraHtml({ html, site, className }: { html: string; site: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const prepared = useMemo(() => prepareJiraHtml(html, site), [html, site])

  // Image load/error events don't bubble, so listen in the capture phase
  useEffect(() => {
    const root = ref.current
    if (!root) return
    // Cached images may already be done before we start listening
    for (const img of root.querySelectorAll('img')) if (img.complete) settle(img)
    const onDone = (e: Event) => {
      if (e.target instanceof HTMLImageElement) settle(e.target)
    }
    root.addEventListener('load', onDone, true)
    root.addEventListener('error', onDone, true)
    return () => {
      root.removeEventListener('load', onDone, true)
      root.removeEventListener('error', onDone, true)
    }
  }, [prepared])

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a')
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
