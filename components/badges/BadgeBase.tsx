import type { ReactNode } from 'react'

// Shared shell for the four badges, so they cannot drift apart.
//
// Matches design/reference/badge-set.jpeg: a flat coloured circle, a white
// glyph, and a subtle diagonal shade across the lower-right that gives the
// disc a little depth without a gradient.
//
// Pure inline SVG -- no icon font, no image request, and it renders inside the
// server-rendered HTML, which matters because badges appear on /browse/tutors
// and /tutor/[slug], the platform's organic-search surface.

export type BadgeSize = 'sm' | 'md'

const DIMENSION: Record<BadgeSize, number> = { sm: 18, md: 24 }

export default function BadgeBase({
  size = 'sm',
  showLabel = false,
  colour,
  label,
  title,
  labelClassName,
  children,
}: {
  size?: BadgeSize
  showLabel?: boolean
  colour: string
  label: string
  /** Tooltip / accessible name. Defaults to the label. */
  title?: string
  labelClassName?: string
  /** The white glyph, drawn on a 24x24 viewBox. */
  children: ReactNode
}) {
  const px = DIMENSION[size]
  const accessibleName = title ?? label

  return (
    <span
      className="inline-flex items-center gap-1.5 align-middle"
      title={accessibleName}
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        role="img"
        aria-label={accessibleName}
        className="shrink-0 drop-shadow-sm"
      >
        <defs>
          {/* Named per badge colour so two badges on one card never collide. */}
          <clipPath id={`badge-clip-${label}`}>
            <circle cx="12" cy="12" r="11" />
          </clipPath>
        </defs>
        <circle cx="12" cy="12" r="11" fill={colour} />
        <path
          d="M24 0 L24 24 L0 24 Z"
          fill="#000000"
          opacity="0.08"
          clipPath={`url(#badge-clip-${label})`}
        />
        <g fill="#FFFFFF" stroke="#FFFFFF">
          {children}
        </g>
      </svg>
      {showLabel && (
        <span
          className={
            labelClassName ??
            'text-[11px] font-bold leading-none whitespace-nowrap'
          }
          style={{ color: colour }}
        >
          {label}
        </span>
      )}
    </span>
  )
}
