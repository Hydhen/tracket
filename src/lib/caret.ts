/** What decides where text breaks and how big it is: copied to the measuring copy of a textarea */
const COPIED = [
  'boxSizing',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontFamily',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textTransform',
  'textIndent',
  'tabSize',
] as const

/**
 * Where the caret is in a textarea, in pixels from the textarea's top-left corner as it is on screen (scroll
 * included), with the height of a line. A textarea can't say, so the text before the caret is laid out in an
 * invisible copy of it and the position of what follows is read there.
 */
export function caretPosition(field: HTMLTextAreaElement, index: number) {
  const style = getComputedStyle(field)
  const copy = document.createElement('div')
  for (const property of COPIED) copy.style[property] = style[property]
  copy.style.position = 'absolute'
  copy.style.visibility = 'hidden'
  copy.style.top = '0'
  copy.style.left = '-9999px'
  copy.style.whiteSpace = 'pre-wrap'
  copy.style.overflowWrap = 'break-word'
  copy.style.overflow = 'hidden'
  copy.style.boxSizing = 'border-box'
  copy.style.width = `${field.offsetWidth}px`
  // A scrollbar takes room from the text, so it takes the same room here
  const scrollbar = field.offsetWidth - field.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
  copy.style.paddingRight = `${parseFloat(style.paddingRight) + Math.max(0, scrollbar)}px`

  copy.textContent = field.value.slice(0, index)
  const marker = document.createElement('span')
  // Something to measure when the caret is at the end of the text
  marker.textContent = field.value.slice(index) || '.'
  copy.appendChild(marker)
  document.body.appendChild(copy)

  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4
  const position = {
    left: marker.offsetLeft - field.scrollLeft,
    top: marker.offsetTop - field.scrollTop,
    lineHeight,
  }
  document.body.removeChild(copy)
  return position
}
