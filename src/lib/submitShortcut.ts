import type { KeyboardEvent } from 'react'

/** For a form's `onKeyDown`: Ctrl+Enter (Cmd+Enter on a Mac) submits it, from whichever field has the focus. */
export function submitOnCtrlEnter(submit: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    submit()
  }
}
