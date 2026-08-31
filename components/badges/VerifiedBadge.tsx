import BadgeBase, { type BadgeSize } from './BadgeBase'

// Green check. Earned by a tutor with a finished profile and an active
// verified-or-higher plan; by a parent whose CNIC and address are approved.
//
// Never render this directly from a plan code -- ask lib/entitlements.ts.
// "Never show a badge the entitlements layer hasn't granted."

export default function VerifiedBadge({
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
      colour="#059669"
      label="Verified"
      title="Verified member"
    >
      <path
        d="M7.1 12.2 L10.5 15.6 L17.0 8.8"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BadgeBase>
  )
}
