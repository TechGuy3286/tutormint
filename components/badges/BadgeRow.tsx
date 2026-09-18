import VerifiedBadge from './VerifiedBadge'
import PremiumBadge from './PremiumBadge'
import FeaturedBadge from './FeaturedBadge'
import type { BadgeName } from '@/lib/planBadges'
import type { BadgeSize } from './BadgeBase'

// Renders granted badges in the fixed order Verified -> Premium -> Featured.
//
// Takes the list the entitlements layer produced. It has no idea what a plan
// is and cannot invent a badge: an empty list renders nothing.

const ORDER: BadgeName[] = ['Verified', 'Premium', 'Featured']

// Desktop-only hover meaning for each badge (PR27 §2). The badge glyph already
// carries a label option; this adds the plain-English "what it means".
const TIP: Record<BadgeName, string> = {
  Verified: 'Verified tutor — identity and documents checked',
  Premium: 'Premium tutor',
  Featured: 'Featured tutor — shown at the top of search',
}

export default function BadgeRow({
  badges,
  size = 'sm',
  showLabel = false,
  className = '',
}: {
  badges: BadgeName[]
  size?: BadgeSize
  showLabel?: boolean
  className?: string
}) {
  const granted = ORDER.filter((b) => badges.includes(b))
  if (granted.length === 0) return null

  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {granted.map((b) => (
        <span key={b} className="relative inline-flex" data-tip={TIP[b]}>
          {b === 'Verified' ? (
            <VerifiedBadge size={size} showLabel={showLabel} />
          ) : b === 'Premium' ? (
            <PremiumBadge size={size} showLabel={showLabel} />
          ) : (
            <FeaturedBadge size={size} showLabel={showLabel} />
          )}
        </span>
      ))}
    </span>
  )
}
