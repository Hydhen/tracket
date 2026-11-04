import DOMPurify from 'dompurify'

// The `jira://` scheme is served by the Rust side with the stored credentials.
// WebView2 on Windows exposes custom schemes as http://<scheme>.localhost.
const MEDIA_BASE = /Windows/i.test(navigator.userAgent) ? 'http://jira.localhost' : 'jira://localhost'

/**
 * Sanitizes Jira-rendered HTML and makes it displayable:
 * - images on the Jira site go through the authenticated `jira://` proxy
 * - links become absolute so they can be opened in the system browser
 */
export function prepareJiraHtml(html: string, site: string): string {
  const siteOrigin = new URL(site).origin
  const body = DOMPurify.sanitize(html, {
    RETURN_DOM: true,
    FORBID_TAGS: ['style'],
    FORBID_ATTR: ['srcset'],
  }) as HTMLElement

  for (const img of body.querySelectorAll('img')) {
    const src = img.getAttribute('src')
    if (!src) continue
    let url: URL
    try {
      url = new URL(src, site)
    } catch {
      img.remove()
      continue
    }
    if (url.origin === siteOrigin) img.setAttribute('src', `${MEDIA_BASE}${url.pathname}${url.search}`)

    // Inline emoji/icons stay as they are; real images get a wrapper that shows a loader.
    // JiraHtml flips `data-state` to loaded/error once the browser has settled.
    if (img.classList.contains('emoji') || url.pathname.startsWith('/images/icons/')) continue
    const wrap = document.createElement('span')
    wrap.className = 'jira-img-wrap'
    wrap.dataset.state = 'loading'
    img.replaceWith(wrap)
    wrap.append(img)
  }

  for (const a of body.querySelectorAll('a[href]')) {
    try {
      a.setAttribute('href', new URL(a.getAttribute('href')!, site).href)
    } catch {
      a.removeAttribute('href')
    }
  }

  return body.innerHTML
}
