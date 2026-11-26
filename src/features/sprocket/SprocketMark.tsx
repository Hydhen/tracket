/** Sprocket's mark: a ring in Tracket's three tones, brightening clockwise like Tracket's chevrons. */
export function SprocketMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="136 136 752 752"
      className={className}
      fill="none"
      strokeWidth="92"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M449.2 731.2 A228.0 228.0 0 0 1 290.8 456.8 M398.0 709.5 L351.0 790.9 M314.5 626.0 L233.1 673.0 M284.0 512.0 L190.0 512.0" stroke="#7A5E48" />
      <path d="M353.6 348.0 A228.0 228.0 0 0 1 670.4 348.0 M398.0 314.5 L351.0 233.1 M512.0 284.0 L512.0 190.0 M626.0 314.5 L673.0 233.1" stroke="#D08850" />
      <path d="M733.2 456.8 A228.0 228.0 0 0 1 574.8 731.2 M740.0 512.0 L834.0 512.0 M709.5 626.0 L790.9 673.0 M626.0 709.5 L673.0 790.9" stroke="#FFB27A" />
    </svg>
  )
}
