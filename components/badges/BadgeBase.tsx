import type { ReactNode } from 'react'
import { BRAND } from '@/lib/brand'

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
  showUrdu = true,
  colour,
  labelColour,
  label,
  urdu,
  title,
  labelClassName,
  children,
}: {
  size?: BadgeSize
  showLabel?: boolean
  /** Whether the Urdu line under the label renders (default true). The tutor's
   *  OWN dashboard header card passes false to drop the Urdu badge lines there
   *  only (PR106-B §1); every other surface keeps it. */
  showUrdu?: boolean
  colour: string
  /** Text colour for the label. Defaults to `colour`; the gold badge
      overrides it: tm-gold on a light ground is 2.05:1. */
  labelColour?: string
  label: string
  /** The Urdu rendering of the label, shown underneath the English one when the
      label is visible (CLAUDE.md: every member-facing label is plain English with
      Urdu beneath). Icon-only badges (showLabel=false) keep only the English
      accessible name. */
  urdu?: string
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
          fill={BRAND.black}
          opacity="0.08"
          clipPath={`url(#badge-clip-${label})`}
        />
        <g fill={BRAND.white} stroke={BRAND.white}>
          {children}
        </g>
      </svg>
      {showLabel && (
        <span className="inline-flex flex-col leading-none" style={{ color: labelColour ?? colour }}>
          <span className={labelClassName ?? 'text-[11px] font-bold leading-none whitespace-nowrap'}>
            {label}
          </span>
          {urdu && showUrdu && (
            <span lang="ur" dir="rtl" className="mt-0.5 text-[10px] font-semibold leading-none whitespace-nowrap opacity-90">
              {urdu}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
