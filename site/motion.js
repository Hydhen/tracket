// The page's motion, with GSAP (vendor/, served from this site). Skipped entirely with reduced motion.
;(() => {
  const { gsap, ScrollTrigger } = window
  if (!gsap || !ScrollTrigger || !document.documentElement.classList.contains('js')) return
  window.__motion = true
  gsap.registerPlugin(ScrollTrigger)

  const $ = (selector, from = document) => from.querySelector(selector)
  const $$ = (selector, from = document) => [...from.querySelectorAll(selector)]

  /* ---------- The demo: tickets, picked up one after another ---------- */

  const TICKETS = [
    { key: 'ABC-123', title: 'Export fails when the file name has an accent', seconds: 47 * 60 + 12 },
    { key: 'ABC-124', title: 'Add a retry to the nightly sync', seconds: 65 * 60 + 38 },
    { key: 'ABC-125', title: 'The settings dialog flashes white in dark mode', seconds: 23 * 60 + 40 },
  ]

  const stage = $('.stage')
  const keyEl = $('.stage__key', stage)
  const titleEl = $('.stage__title', stage)
  const clockBox = $('.clock', stage)
  const clockEl = $('[data-clock]', stage)
  const toastEl = $('.stage__toast', stage)
  const thumb = $('.rail__thumb', stage)
  const stops = $$('.rail__stop', stage)
  const shell = $('.stage__shell', stage)
  const cmdEl = $('.stage__cmd', stage)
  const opensEl = $('.stage__opens', stage)

  const pad = (n) => String(n).padStart(2, '0')
  const showClock = (s) => {
    clockEl.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
  }
  const spoken = (s) => {
    const h = Math.floor(s / 3600)
    const m = Math.round((s % 3600) / 60)
    return h ? `${h} h ${m} min` : `${m} min`
  }
  const setStage = (at, name) => {
    stops.forEach((stop, i) => stop.classList.toggle('is-active', i === at))
    thumb.dataset.stage = name
  }

  let chars = []
  const setKey = (text) => {
    keyEl.textContent = ''
    chars = [...text].map((c) => {
      const span = document.createElement('span')
      span.className = 'ch'
      span.textContent = c
      keyEl.append(span)
      return span
    })
  }

  // Everything back to "just assigned", and hidden, ready for the ticket to arrive
  const prepare = (ticket) => {
    setKey(ticket.key)
    titleEl.textContent = ticket.title
    toastEl.textContent = `Logged ${spoken(ticket.seconds)} to ${ticket.key}`
    cmdEl.textContent = ''
    clockBox.classList.remove('is-running')
    showClock(0)
    setStage(0, 'todo')
    gsap.set(thumb, { '--i': 0 })
    gsap.set(chars, { opacity: 0, yPercent: 45 })
    gsap.set(titleEl, { opacity: 0, y: 10 })
    gsap.set(shell, { opacity: 0 })
    gsap.set(opensEl, { opacity: 0, x: -8 })
    gsap.set(toastEl, { opacity: 0, y: 8 })
  }

  let current = null
  let onScreen = true

  const run = (index) => {
    const ticket = TICKETS[index]
    const command = `git worktree add .claude/worktrees/${ticket.key}`
    const time = { s: 0 }
    const typed = { n: 0 }
    const leaving = [...chars, titleEl, shell, toastEl]

    const tl = gsap.timeline({
      paused: !onScreen,
      onComplete: () => {
        const next = (index + 1) % TICKETS.length
        prepare(TICKETS[next])
        current = run(next)
      },
    })

    tl
      // The ticket arrives
      .to(chars, { opacity: 1, yPercent: 0, duration: 0.7, stagger: 0.05, ease: 'power3.out' }, 0)
      .to(titleEl, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.35)
      // It is picked up: it moves to "In progress" and its timer starts
      .add(() => {
        setStage(1, 'doing')
        clockBox.classList.add('is-running')
      }, 1.4)
      .to(thumb, { '--i': 1, duration: 0.7, ease: 'power3.inOut' }, 1.4)
      // Time passes, much faster than it does for you
      .to(time, { s: ticket.seconds, duration: 3.6, ease: 'power2.inOut', onUpdate: () => showClock(Math.round(time.s)) }, 1.7)
      // Its worktree is created
      .to(shell, { opacity: 1, duration: 0.3 }, 2.0)
      .to(
        typed,
        {
          n: command.length,
          duration: 1.5,
          ease: 'none',
          onStart: () => cmdEl.classList.add('is-typing'),
          onUpdate: () => (cmdEl.textContent = command.slice(0, Math.round(typed.n))),
          onComplete: () => cmdEl.classList.remove('is-typing'),
        },
        2.2,
      )
      .to(opensEl, { opacity: 1, x: 0, duration: 0.5, ease: 'power3.out' }, 3.8)
      // The work is done: the timer stops, the time is logged, the ticket moves to Done
      .add(() => clockBox.classList.remove('is-running'), 5.3)
      .to(toastEl, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 5.4)
      .add(() => setStage(2, 'done'), 6.2)
      .to(thumb, { '--i': 2, duration: 0.7, ease: 'power3.inOut' }, 6.2)
      // Then the next one
      .to(leaving, { opacity: 0, y: -10, duration: 0.5, ease: 'power2.in' }, 9.2)
      .to(thumb, { '--i': 0, duration: 0.5, ease: 'power2.inOut' }, 9.3)
      .add(() => setStage(0, 'todo'), 9.3)
      .to({}, { duration: 0.4 })

    return tl
  }

  // The demo only plays while it can be seen
  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting
      current?.paused(!onScreen)
    },
    { threshold: 0.2 },
  ).observe(stage)

  /* ---------- Entrance ---------- */

  prepare(TICKETS[0])

  const lines = $$('.line > span')
  gsap.set(lines, { yPercent: 105, opacity: 1 })
  gsap.set('[data-intro]', { y: 24 })

  gsap
    .timeline({ defaults: { ease: 'power3.out' } })
    .to('.facts', { opacity: 1, y: 0, duration: 0.6 }, 0)
    .to(lines, { yPercent: 0, duration: 1, stagger: 0.12 }, 0.1)
    .to('.lead', { opacity: 1, y: 0, duration: 0.8 }, 0.55)
    .to('.hero .buttons, .hero .small', { opacity: 1, y: 0, duration: 0.7, stagger: 0.1 }, 0.75)
    .to('.stage', { opacity: 1, y: 0, duration: 0.9 }, 0.9)
    .add(() => {
      current = run(0)
    }, 1.0)

  /* ---------- Reading the page ---------- */

  // The page is a ticket too: the bar goes from to do, through in progress, to done as you read
  gsap.to('.progress__fill', {
    clipPath: 'inset(0 0% 0 0)',
    ease: 'none',
    scrollTrigger: { trigger: document.documentElement, start: 'top top', end: 'bottom bottom', scrub: 0.3 },
  })

  gsap.set('.reveal', { y: 28 })
  ScrollTrigger.batch('.reveal', {
    start: 'top 90%',
    once: true,
    onEnter: (elements) =>
      gsap.to(elements, { opacity: 1, y: 0, duration: 0.8, stagger: 0.09, ease: 'power3.out', overwrite: true }),
  })

  // Fonts change the height of the page: measure again once they are in
  document.fonts?.ready.then(() => ScrollTrigger.refresh())
})()
