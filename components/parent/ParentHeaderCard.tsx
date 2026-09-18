import Link from 'next/link'

import Avatar from '@/components/Avatar'
import NotVerifiedBadge from '@/components/badges/NotVerifiedBadge'

// The parent dashboard's minimal profile card (PR24 §1) — the same shape and
// style as the tutor dashboard's TutorHeaderCard, only the contents differ.
//
// What it holds, and nothing more:
//   • photo, name, city;
//   • the badge line — a red "Not verified" badge (with its Urdu line) when the
//     CNIC and address are not yet approved, a green "Verified" chip when they
//     are, and a "Featured" plan chip (no date) when a Featured plan is active —
//     with a small "Get verified" button at the RIGHT of that line when not
//     verified;
//   • a "View your public card" link.
//
// No completion percentage, no views line, no "Edit profile" link — short and
// tight. Plain words, phone-first. No price anywhere (§1.3).

export default function ParentHeaderCard({
  name,
  avatarUrl,
  city,
  verified,
  featured,
  publicHref,
}: {
  name: string
  avatarUrl: string | null
  city: string | null
  /** CNIC AND address approved. */
  verified: boolean
  /** A Featured plan is active. */
  featured: boolean
  /** The parent's public card (/parent/[id]). */
  publicHref: string
}) {
  return (
    <section className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="shrink-0">
        <Avatar src={avatarUrl} name={name} className="h-16 w-16 text-base" />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <h1 className="truncate text-lg font-black leading-tight text-tm-navy">{name}</h1>
        {city && <p className="text-xs font-semibold text-gray-500">{city}</p>}

        {/* Badge line: status badges left, small Get verified button right. */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-start gap-2">
            {verified ? (
              <span className="inline-flex items-center rounded-full bg-tm-tint-green px-2.5 py-0.5 text-[11px] font-bold text-tm-green-deep">
                Verified
              </span>
            ) : (
              <NotVerifiedBadge urdu />
            )}
            {featured && (
              <span className="inline-flex items-center rounded-full bg-tm-tint-gold px-2.5 py-0.5 text-[11px] font-bold text-tm-gold-ink">
                Featured
              </span>
            )}
          </div>
          {!verified && (
            <Link
              href="/parent/verify"
              className="inline-flex min-h-[32px] shrink-0 items-center justify-center rounded-lg bg-tm-red px-3 text-[11px] font-bold text-white hover:bg-tm-red-hover"
            >
              Get verified
            </Link>
          )}
        </div>

        <Link
          href={publicHref}
          className="inline-flex min-h-[32px] items-center text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline"
        >
          View your public card
        </Link>
      </div>
    </section>
  )
}
