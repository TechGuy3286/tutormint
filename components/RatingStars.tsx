import Link from 'next/link'

import {
  hasRatings,
  NO_REVIEWS_YET,
  ratingAriaLabel,
  ratingCountText,
  ratingNumber,
  starFills,
  type StarFill,
} from '@/lib/ratingStarsCore'

// The ONE rating display (owner, 23 Nov 2026 — PR-19; rules lib/ratingStarsCore).
// Five stars always — filled gold (tm-star #F5B301), empty light grey, half for
// .5 — then "4.6 (12 ratings)". With an average (`count` given) and no ratings
// yet it shows the existing "No reviews yet" text, no empty stars. Without
// `count` it is ONE rating (a review, "You rated", a notification): stars + "4.0".
//
// Server-safe (no hooks): used on cached public pages and in client components
// alike. The stars are aria-hidden fills; the label on the wrapper carries the
// rating for a screen reader, the number beside them for everyone else.

const SIZE = { xs: 11, sm: 13, md: 15, lg: 18 } as const
const TEXT = { xs: 'text-[10px]', sm: 'text-[11px]', md: 'text-xs', lg: 'text-sm' } as const

const POINTS = '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26'

function StarGlyph({ fill, px }: { fill: StarFill; px: number }) {
  const empty = <polygon points={POINTS} className="fill-gray-200 stroke-gray-200" strokeWidth={1} strokeLinejoin="round" />
  const full = <polygon points={POINTS} className="fill-tm-star stroke-tm-star" strokeWidth={1} strokeLinejoin="round" />
  if (fill !== 'half') {
    return (
      <svg width={px} height={px} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-star={fill} className="shrink-0">
        {fill === 'full' ? full : empty}
      </svg>
    )
  }
  return (
    <span className="relative inline-block shrink-0" style={{ width: px, height: px }} data-star="half" aria-hidden="true">
      <svg width={px} height={px} viewBox="0 0 24 24" focusable="false" className="absolute inset-0">
        {empty}
      </svg>
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: px / 2 }}>
        <svg width={px} height={px} viewBox="0 0 24 24" focusable="false">
          {full}
        </svg>
      </span>
    </span>
  )
}

export default function RatingStars({
  rating,
  count,
  size = 'sm',
  prefix,
  countHref,
  hideWhenNone = false,
  className = '',
}: {
  rating: number | string | null | undefined
  /** How many ratings the average rests on. Omit for a single rating. */
  count?: number | null
  size?: keyof typeof SIZE
  /** Words before the stars, e.g. "You rated" (also leads the label). */
  prefix?: string
  /** The count links here (a profile's #reviews). */
  countHref?: string
  /** Show nothing at all (not "No reviews yet") when there are no ratings — compact link lists. */
  hideWhenNone?: boolean
  className?: string
}) {
  const isAverage = count !== undefined
  if (isAverage && !hasRatings(count)) {
    if (hideWhenNone) return null
    return (
      <span className={`${TEXT[size]} font-normal text-gray-500 ${className}`} data-rating="none">
        {NO_REVIEWS_YET}
      </span>
    )
  }
  const n = isAverage ? Number(count) : null
  const px = SIZE[size]
  const label = ratingAriaLabel(rating, n, prefix)
  // With a link inside, the wrapper cannot be role="img" (it would hide the
  // link): the label is then visually-hidden text and the link names itself.
  const linked = !!countHref && n !== null
  return (
    <span
      role={linked ? undefined : 'img'}
      aria-label={linked ? undefined : label}
      className={`inline-flex items-center gap-1.5 ${TEXT[size]} ${className}`}
      data-rating={ratingNumber(rating)}
    >
      {linked && <span className="sr-only">{label}</span>}
      {prefix && <span className="font-black text-tm-navy" aria-hidden="true">{prefix}</span>}
      <span className="inline-flex items-center gap-px" aria-hidden="true">
        {starFills(rating).map((f, i) => (
          <StarGlyph key={i} fill={f} px={px} />
        ))}
      </span>
      <span className="font-bold text-slate-700">
        <span aria-hidden="true">{ratingNumber(rating)}</span>
        {n !== null && (
          <>
            {' '}
            {linked ? (
              <Link href={countHref!} prefetch={false} aria-label="Read the reviews" className="font-normal text-gray-500 hover:underline">
                {ratingCountText(n)}
              </Link>
            ) : (
              <span aria-hidden="true" className="font-normal text-gray-500">{ratingCountText(n)}</span>
            )}
          </>
        )}
      </span>
    </span>
  )
}
