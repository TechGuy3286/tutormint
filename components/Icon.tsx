// One sprite icon (owner, 6 Oct 2026, item 14).
//
// Draws a lucide icon from public/icons.svg with <use>, instead of inlining the
// paths on every card. Same stroke attributes as lucide-react's components (24px
// box, stroke 2, round caps/joins), so it looks identical; `size` and
// `className` behave the same way. The sprite is one cacheable file, fetched
// once, so twelve cards no longer carry twelve copies of the same paths in the
// HTML. Server- and client-safe (no hooks).
//
// Names are the lucide icon names in scripts/build-icon-sprite.mjs (ICONS);
// adding one means adding it there and re-running the script.

export type IconName =
  | 'map-pin'
  | 'building-2'
  | 'graduation-cap'
  | 'wallet'
  | 'clock'
  | 'file-text'
  | 'send'
  | 'heart'
  | 'shield-check'
  | 'user-round'
  | 'book-open'
  | 'briefcase'
  | 'play'
  | 'message-circle'
  | 'star'
  | 'eye'
  | 'handshake'
  | 'badge-check'
  | 'x'
  | 'house'
  | 'wifi'
  | 'users'
  | 'monitor-smartphone'
  | 'refresh-cw'
  | 'copy'

export default function Icon({
  name,
  size = 14,
  className = '',
  fill = 'none',
  title,
}: {
  name: IconName
  size?: number
  className?: string
  /** 'currentColor' for a filled heart/star; 'none' (default) for an outline. */
  fill?: string
  /** An accessible name when the icon stands alone; omitted = decorative. */
  title?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <use href={`/icons.svg#${name}`} />
    </svg>
  )
}
