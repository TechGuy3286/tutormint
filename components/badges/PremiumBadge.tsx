import BadgeBase, { type BadgeSize } from './BadgeBase'

// Navy lightning bolt. Tutor plans premium and featured.

export default function PremiumBadge({
  size = 'sm',
  showLabel = false,
}: {
  size?: BadgeSize
  showLabel?: boolean
}) {
  return (
    <BadgeBase
      size={size}
      showLabel={showLabel}
      colour="#1E293B"
      label="Premium"
      title="Premium member"
    >
      <path
        d="M13.9 4.6 L7.4 13.4 h3.5 L10.1 19.4 L16.6 10.6 h-3.5 z"
        stroke="none"
      />
    </BadgeBase>
  )
}
