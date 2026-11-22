import BadgeBase, { type BadgeSize } from './BadgeBase'
import { BRAND } from '@/lib/brand'

// Gold crown. Tutor plan featured, parent plan parent_featured.
// English label only (PR-15): icon + "Featured", the same size and style as
// Verified. A tutor card no longer adds the FeaturedTag pill.

export default function FeaturedBadge({
  size = 'sm',
  showLabel = false,
  showUrdu = true,
}: {
  size?: BadgeSize
  showLabel?: boolean
  showUrdu?: boolean
}) {
  return (
    <BadgeBase
      size={size}
      showLabel={showLabel}
      showUrdu={showUrdu}
      colour={BRAND.gold}
      labelColour={BRAND.goldInk}
      label="Featured"
      title="Featured member"
    >
      <g stroke="none">
        <path d="M5.4 8.0 L8.3 11.2 L12 5.9 L15.7 11.2 L18.6 8.0 L17.4 15.0 L6.6 15.0 z" />
        <rect x="6.6" y="16.1" width="10.8" height="1.9" rx="0.5" />
      </g>
    </BadgeBase>
  )
}
