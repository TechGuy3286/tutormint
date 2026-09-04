import Avatar from '@/components/Avatar'
import VerifiedBadge from '@/components/badges/VerifiedBadge'

// The tutor's own card, side by side: as it appears now, and as it would
// appear Verified.
//
// This is the argument the packages table cannot make. A tutor already knows
// what their card looks like in search results; showing the same card with the
// badge on it says more than a feature row reading "Verified badge: yes".
//
// It carries NO PRICE. The price is three inches below in the plan table the
// tutor chose to open, and repeating it here would put a second price on a page
// that only needs one.
//
// Deliberately not a live TutorCard: that component takes a full directory row
// and a viewer, and rendering two of them here would mean either faking data or
// dragging the whole card's action buttons onto a pricing page. This is a
// likeness of the part that changes.

export default function VerifiedPreview({ name, city }: { name: string; city: string | null }) {
  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 className="text-sm font-black text-tm-navy">How parents see you</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card name={name} city={city} verified={false} />
        <Card name={name} city={city} verified />
      </div>

      <p className="text-[11px] leading-relaxed text-gray-500">
        The badge appears once your profile reaches 100% and your video is approved. Parents filter
        for it, and Verified tutors are listed above tutors without a plan.
      </p>
    </section>
  )
}

function Card({ name, city, verified }: { name: string; city: string | null; verified: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        verified ? 'border-tm-green-deep/30 bg-tm-tint-green' : 'border-gray-200 bg-tm-bg'
      }`}
    >
      <p className="pb-2 text-[10px] font-black uppercase tracking-wider text-gray-500">
        {verified ? 'With Verified' : 'Your card today'}
      </p>
      <div className="flex items-center gap-3">
        <Avatar name={name} decorative ring="border border-gray-200" className="h-10 w-10 text-xs" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-xs font-black text-tm-navy">{name}</span>
            {verified && <VerifiedBadge size="sm" />}
          </span>
          <span className="block truncate text-[11px] text-gray-500">
            {city ?? 'Your city'} · {verified ? 'Listed above free tutors' : 'Listed below Verified tutors'}
          </span>
        </span>
      </div>
    </div>
  )
}
