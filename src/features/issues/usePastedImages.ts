import { useRef, type ClipboardEvent } from 'react'
import { api } from '@/lib/api'

/** The pictures Jira shows inline, by the extension each is attached with */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** `image-20261118-153045123`: the moment it was pasted, so two pastes never share a name */
function stamp(now: Date): string {
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`
  return `image-${day}-${time}`
}

/**
 * Pictures pasted into a wiki markup text box. A pasted picture is written as `!name!` and kept here; it is only
 * attached to the ticket by `attach`, when the text is posted, so cancelling leaves nothing on the ticket.
 */
export function usePastedImages(issueKey: string) {
  const pending = useRef(new Map<string, File>())

  /**
   * Pastes the pictures of the clipboard into the text, as markup. Returns false and leaves the paste alone when
   * there is none, or when the clipboard also has text (copying cells or a web page brings along a picture too).
   */
  const paste = (e: ClipboardEvent<HTMLTextAreaElement>, text: string, setText: (text: string) => void): boolean => {
    const images = Array.from(e.clipboardData.files).filter((file) => file.type in EXTENSIONS)
    if (images.length === 0 || e.clipboardData.getData('text/plain')) return false
    e.preventDefault()

    const markup = images.map((file) => {
      let name = `${stamp(new Date())}.${EXTENSIONS[file.type]}`
      for (let n = 2; pending.current.has(name) || text.includes(`!${name}`); n++) {
        name = `${stamp(new Date())}-${n}.${EXTENSIONS[file.type]}`
      }
      pending.current.set(name, file)
      return `!${name}!`
    })

    const field = e.currentTarget
    const inserted = markup.join('\n')
    const { selectionStart: start, selectionEnd: end } = field
    setText(text.slice(0, start) + inserted + text.slice(end))
    // The text box only takes the new text on the next render
    requestAnimationFrame(() => {
      field.focus()
      field.setSelectionRange(start + inserted.length, start + inserted.length)
    })
    return true
  }

  /** Attaches the pictures the text still shows; one that was attached isn't attached again if posting is retried */
  const attach = async (text: string) => {
    for (const [name, file] of [...pending.current]) {
      if (!text.includes(`!${name}`)) continue
      await api.uploadAttachment(issueKey, name, new Uint8Array(await file.arrayBuffer()))
      pending.current.delete(name)
    }
  }

  return { paste, attach }
}
