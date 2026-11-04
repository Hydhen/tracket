// Loaded in <head>, so it runs before the first paint. It only decides whether the page is going to be animated:
// without motion (reduced-motion setting, or scripts that don't load) the page is simply its own finished state.
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
if (!calm) {
  const root = document.documentElement
  root.classList.add('js')
  // If the animation script never starts (blocked, offline), show the page as it is
  setTimeout(() => {
    if (!window.__motion) root.classList.remove('js')
  }, 3500)
}
