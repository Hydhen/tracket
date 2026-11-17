import DOMPurify from 'dompurify'

// The `jira://` scheme is served by the Rust side with the stored credentials.
// WebView2 on Windows exposes custom schemes as http://<scheme>.localhost.
const MEDIA_BASE = /Windows/i.test(navigator.userAgent) ? 'http://jira.localhost' : 'jira://localhost'

/** A path of the Jira site, as the webview loads it through the authenticated proxy. */
export const mediaUrl = (path: string) => `${MEDIA_BASE}${path}`

/** Where the files attached to a ticket are served from. */
const ATTACHMENT_PATH = /^\/(secure\/attachment\/|rest\/api\/\d+\/attachment\/content\/|download\/attachments?\/)/i
const VIDEO_NAME = /\.(mp4|m4v|webm|ogv|mov)(?![a-z0-9])/i

const EXPAND_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>'

const decoded = (text: string) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** What is known of a file attached to the ticket: enough to tell a video from a picture and to load it */
export interface AttachmentRef {
  id: string
  filename: string
  mimeType: string
}

const ATTACHMENT_ID = /\/(?:attachment|thumbnail)\/(?:(?:content|thumbnail)\/)?(\d+)(?:[/?]|$)/

/** The content of an attachment, as the webview loads it. */
const contentUrl = (id: string) => mediaUrl(`/rest/api/3/attachment/content/${id}`)

/**
 * The attachment a picture of the page stands for. Jira renders a file embedded in a description in several ways (its
 * content, a thumbnail, a link only the media service can follow…), so the id in the address is tried first, then the
 * file's name, which Jira also writes on it.
 */
function attachmentFor(img: Element, attachments: AttachmentRef[], site: string, siteOrigin: string) {
  if (attachments.length === 0) return undefined
  const src = img.getAttribute('src')
  if (src) {
    try {
      const url = new URL(src, site)
      const id = url.origin === siteOrigin ? ATTACHMENT_ID.exec(url.pathname)?.[1] : undefined
      const found = id ? attachments.find((a) => a.id === id) : undefined
      if (found) return found
    } catch {
      // not an address: the name may still say
    }
  }
  for (const name of [img.getAttribute('data-attachment-name'), img.getAttribute('alt')]) {
    // Jira keeps every upload of a name: the newest is the last
    const same = name ? attachments.filter((a) => a.filename === name) : []
    if (same.length > 0) return same[same.length - 1]
  }
  return undefined
}

/** What a link to a video attached to the ticket points at, or null when the link isn't one. */
function videoOf(a: Element, site: string, siteOrigin: string) {
  let url: URL
  try {
    url = new URL(a.getAttribute('href') ?? '', site)
  } catch {
    return null
  }
  const id = a.getAttribute('file-preview-id')
  const declared = a.getAttribute('file-preview-type') === 'video'
  const onSite = url.origin === siteOrigin && ATTACHMENT_PATH.test(url.pathname)
  const name = a.getAttribute('file-preview-title') || a.getAttribute('title') || ''
  if (!declared && !(onSite && VIDEO_NAME.test(`${decoded(url.pathname)} ${name}`))) return null

  // Always through the plain content address, whatever address Jira wrote: its `?stream=true` makes Jira send the
  // bytes itself rather than redirect to its media service, and the player waits on that until it gives up
  const attachmentId = id && /^\d+$/.test(id) ? id : onSite ? ATTACHMENT_ID.exec(url.pathname)?.[1] : undefined
  const src = attachmentId ? contentUrl(attachmentId) : onSite ? mediaUrl(url.pathname) : null
  if (!src) return null
  const filename = name.split(' attached to ')[0] || decoded(url.pathname.split('/').pop() ?? '') || 'video'
  return { src, href: url.href, filename }
}

/** A player for a video of the ticket, with a button to expand it and, if it can't be played, a link to open it. */
function videoBlock({ src, href, filename }: { src: string; href: string; filename: string }) {
  const wrap = document.createElement('span')
  wrap.className = 'jira-video-wrap'
  wrap.dataset.state = 'ok'

  const video = document.createElement('video')
  video.setAttribute('controls', '')
  video.setAttribute('preload', 'metadata')
  video.setAttribute('playsinline', '')
  video.setAttribute('src', src)
  video.setAttribute('title', filename)

  const expand = document.createElement('button')
  expand.type = 'button'
  expand.className = 'jira-expand'
  expand.title = 'Expand (zoom, full screen)'
  expand.setAttribute('aria-label', `Expand ${filename}`)
  expand.innerHTML = EXPAND_ICON

  const fallback = document.createElement('a')
  fallback.className = 'jira-video-fallback'
  fallback.setAttribute('href', href)
  fallback.textContent = `${filename} can't be played here: open it`

  wrap.append(video, expand, fallback)
  return wrap
}

/**
 * Jira embeds an attached video as a plugin (`<object type="video/mp4" data="/rest/api/3/attachment/content/…">` with
 * an `<embed>` inside), which the sanitizer removes. Each becomes a link to the video, marked as one, which the rest
 * of the preparation turns into a player.
 */
function embedsToLinks(html: string, attachments: AttachmentRef[]): string {
  if (!/<(object|embed)/i.test(html)) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const videoAddress = (el: Element) =>
    el.getAttribute('data') ??
    el.getAttribute('src') ??
    el.querySelector('param[name="src"], param[name="data"]')?.getAttribute('value') ??
    el.querySelector('embed[src]')?.getAttribute('src') ??
    null

  // Objects first: the embed inside one is part of it
  for (const el of doc.querySelectorAll('object, embed')) {
    if (el.closest('object') && el.tagName === 'EMBED') continue
    const type = el.getAttribute('type') ?? el.querySelector('embed[type]')?.getAttribute('type') ?? ''
    const address = videoAddress(el)
    if (!type.startsWith('video/') || !address) continue

    const id = /\/attachment\/content\/(\d+)/.exec(address)?.[1]
    const name = attachments.find((a) => a.id === id)?.filename ?? 'video'
    const link = doc.createElement('a')
    link.setAttribute('href', address)
    link.setAttribute('file-preview-type', 'video')
    if (id) link.setAttribute('file-preview-id', id)
    link.setAttribute('file-preview-title', name)
    link.textContent = name
    // Jira wraps it in a block of its own
    const wrapper = el.parentElement?.classList.contains('embeddedObject') ? el.parentElement : el
    wrapper.replaceWith(link)
  }
  return doc.body.innerHTML
}

/**
 * Sanitizes Jira-rendered HTML and makes it displayable:
 * - images on the Jira site go through the authenticated `jira://` proxy
 * - links to attached videos become players, and so do the videos embedded in the page; `attachments` are the files of
 *   the ticket, which say what an embedded file is
 * - videos already in the page go through the proxy too
 * - links become absolute so they can be opened in the system browser
 */
export function prepareJiraHtml(html: string, site: string, attachments: AttachmentRef[] = []): string {
  const siteOrigin = new URL(site).origin
  const body = DOMPurify.sanitize(embedsToLinks(html, attachments), {
    RETURN_DOM: true,
    FORBID_TAGS: ['style'],
    FORBID_ATTR: ['srcset'],
    // How Jira says that a link is to a video, and which attachment it is
    ADD_ATTR: ['file-preview-type', 'file-preview-id', 'file-preview-title'],
  }) as HTMLElement

  // First, so the thumbnail Jira puts in such a link goes with it
  for (const a of body.querySelectorAll('a[href]')) {
    const video = videoOf(a, site, siteOrigin)
    if (video) a.replaceWith(videoBlock(video))
  }

  // An embedded video comes as a picture of it: the attachment it stands for says that it is a video
  for (const img of body.querySelectorAll('img')) {
    const attachment = attachmentFor(img, attachments, site, siteOrigin)
    if (!attachment?.mimeType.startsWith('video/')) continue
    const link = img.parentElement
    const target = link?.tagName === 'A' && link.children.length === 1 ? link : img
    target.replaceWith(
      videoBlock({
        src: contentUrl(attachment.id),
        href: `${siteOrigin}/rest/api/3/attachment/content/${attachment.id}`,
        filename: attachment.filename,
      }),
    )
  }

  for (const media of body.querySelectorAll('video[src], audio[src], source[src]')) {
    const src = media.getAttribute('src') ?? ''
    try {
      const url = new URL(src, site)
      if (url.origin === siteOrigin) media.setAttribute('src', mediaUrl(`${url.pathname}${url.search}`))
    } catch {
      media.removeAttribute('src')
    }
    if (media.tagName !== 'SOURCE') {
      media.setAttribute('controls', '')
      media.setAttribute('preload', 'metadata')
    }
  }

  for (const img of body.querySelectorAll('img')) {
    // An embedded picture Jira only gave to its media service (or no address at all) is loaded from its attachment
    const attachment = attachmentFor(img, attachments, site, siteOrigin)
    // Only a picture: the thumbnail of a document stays a thumbnail
    if (attachment?.mimeType.startsWith('image/')) {
      const given = img.getAttribute('src')
      let own = false
      try {
        own = !!given && new URL(given, site).origin === siteOrigin
      } catch {
        // no usable address
      }
      if (!own) img.setAttribute('src', contentUrl(attachment.id))
      img.dataset.full = contentUrl(attachment.id)
    }

    const src = img.getAttribute('src')
    if (!src) continue
    let url: URL
    try {
      url = new URL(src, site)
    } catch {
      img.remove()
      continue
    }
    if (url.origin === siteOrigin) img.setAttribute('src', mediaUrl(`${url.pathname}${url.search}`))

    // Inline emoji/icons stay as they are; real images get a wrapper that shows a loader.
    // JiraHtml flips `data-state` to loaded/error once the browser has settled.
    if (img.classList.contains('emoji') || url.pathname.startsWith('/images/icons/')) continue
    const wrap = document.createElement('span')
    wrap.className = 'jira-img-wrap'
    wrap.dataset.state = 'loading'
    img.replaceWith(wrap)
    wrap.append(img)

    // A thumbnail linking to the attachment: the viewer shows the attachment itself
    const link = wrap.closest('a[href]')
    if (link) {
      try {
        const target = new URL(link.getAttribute('href') ?? '', site)
        if (target.origin === siteOrigin && ATTACHMENT_PATH.test(target.pathname)) {
          img.dataset.full = mediaUrl(`${target.pathname}${target.search}`)
        }
      } catch {
        // not a link to follow
      }
    }
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
