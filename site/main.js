// Loaded in <head>, so it runs before the first paint: the demo only starts at "To do" when it is going to move.
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
if (!calm) document.documentElement.classList.add('js')

document.addEventListener('DOMContentLoaded', () => {
  const stage = document.querySelector('.stage')
  const clock = stage?.querySelector('[data-clock]')
  if (!stage || !clock || calm) return

  const pad = (n) => String(n).padStart(2, '0')
  const show = (seconds) => {
    clock.textContent = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
  }
  show(0)

  // The ticket is picked up: it moves to "In progress" and its timer starts
  setTimeout(() => {
    stage.classList.add('is-live')
    const startedAt = Date.now()
    setInterval(() => show(Math.floor((Date.now() - startedAt) / 1000)), 500)
  }, 1000)
})
