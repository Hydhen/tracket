import { cn } from '@/lib/utils'

/** The chevrons of the logo (see `.spinner` in index.css): the light passes from one to the next. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg role="img" aria-label="Loading" viewBox="212 290 628 444" className={cn('spinner size-4', className)}>
      <path d="M262 340 L392 512 L262 684" />
      <path d="M458 340 L588 512 L458 684" />
      <path d="M654 340 L784 512 L654 684" />
    </svg>
  )
}
