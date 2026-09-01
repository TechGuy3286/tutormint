// The small gold pill that sits on the corner of a featured tutor's card or a
// featured parent's job. Distinct from FeaturedBadge: the badge says who the
// member is, the tag makes the card itself stand out in a list.
//
// It is the visible half of what a Featured plan buys, so it must never be
// rendered from anything but a granted entitlement. When a plan expires the
// tag disappears the same day -- no grace period.

export default function FeaturedTag({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-tm-gold px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-tm-navy ${className}`}
    >
      Featured
    </span>
  )
}
