import Link from 'next/link'

import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import VerifyBadgeControl from '@/components/tutor/VerifyBadgeControl'
import type { BadgeName } from '@/lib/planBadges'

// The tutor dashboard's minimal profile card (PR20 §1).
//
// What it holds, and nothing more:
//   • photo, name, city;
//   • the badge line — a red "Not verified" badge (with its Urdu line) when the
//     one-time fee is unpaid, and the plan badge (Basic/Premium/Featured, no
//     date) — with a small "Get verified" button at the RIGHT of that line;
//   • a "View your public page" link (only when the page is live).
//
// No completion line, no profile-views line, no wide "not verified" panel, no
// "Edit profile" link — the card is short and tight. Plain words, phone-first.

export default function TutorHeaderCard({
  name,
  avatarUrl,
  city,
  verified,
  planName,
  badges = [],
  verificationPending = false,
  findable = false,
  completion,
  publicHref,
}: {
  name: string
  avatarUrl: string | null
  city: string | null
  /** The one-time verification fee is paid. */
  verified: boolean
  /** The ACTIVE plan's name ("Basic"/"Premium"/"Featured"), or null. */
  planName: string | null
  /** The earned badges (PR105-B §3) — shown beside the plan name on the tutor's
   *  OWN dashboard. Empty until staff approve the documents. */
  badges?: BadgeName[]
  /** Fee paid but CNIC/photo/selfie not all staff-approved yet (PR105-B §3). */
  verificationPending?: boolean
  /** Profile is 100% complete and approved — the pop-up's "findable" line. */
  findable?: boolean
  /** 0-100, for the ring around the photo below 100%. */
  completion: number
  /** The tutor's public page, when it is live; null otherwise. */
  publicHref: string | null
}) {
  const incomplete = completion < 100
  const ring = `conic-gradient(var(--color-tm-green-deep) ${completion * 3.6}deg, var(--color-gray-200) 0deg)`

  return (
    <section className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="relative shrink-0">
        {incomplete ? (
          <div className="grid h-16 w-16 place-items-center rounded-full p-[3px]" style={{ background: ring }}>
            <span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-white p-[2px]">
              <Avatar src={avatarUrl} name={name} className="h-full w-full text-base" ring="" />
            </span>
          </div>
        ) : (
          <Avatar src={avatarUrl} name={name} className="h-16 w-16 text-base" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        {/* PR106-D §2.3/§2.4 — name and all badges on ONE wrapping line, badges
            directly after the name. The Verified check (or pending / get-verified
            chip) is the VerifyBadgeControl; it opens the benefits pop-up (§3). */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="text-lg font-black leading-tight text-tm-navy">{name}</h1>
          <VerifyBadgeControl
            feePaid={verified}
            verifiedOk={badges.includes('Verified')}
            verificationPending={verificationPending}
            findable={findable}
            payHref="/tutor/complete-profile?step=verify"
          />
          {/* Plan-tier badges (Premium/Featured) after the name — icon + label,
              no Urdu. Verified is shown by the control above, so it is dropped. */}
          {verified && (
            <BadgeRow badges={badges.filter((b) => b !== 'Verified')} size="sm" showLabel showUrdu={false} />
          )}
          {planName && (
            // PR106-B §2: the plan chip opens Membership Plans.
            <Link
              href="/membership-plans?for=tutors"
              className="inline-flex items-center rounded-full bg-tm-tint-green px-2.5 py-0.5 text-[11px] font-bold text-tm-green-deep hover:bg-tm-tint-green/70"
            >
              {planName}
            </Link>
          )}
        </div>
        {city && <p className="text-xs font-semibold text-gray-500">{city}</p>}

        {publicHref && (
          <Link
            href={publicHref}
            className="inline-flex min-h-[32px] items-center text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline"
          >
            View your public page
          </Link>
        )}
      </div>
    </section>
  )
}
