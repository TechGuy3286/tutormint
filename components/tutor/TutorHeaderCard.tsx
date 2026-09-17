import Link from 'next/link'

import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import NotVerifiedBadge from '@/components/badges/NotVerifiedBadge'
import type { BadgeName } from '@/lib/planBadges'
import { formatDate } from '@/lib/datetime'

// The tutor dashboard's FIRST card (PR17 §1.2/§1.3).
//
// Photo, name, city, and the status badges on one line: the Verified / Premium /
// Featured badges the tutor has earned, or — when the one-time fee is unpaid — a
// red "Not verified" badge with its Urdu line. The plan (Basic / Premium /
// Featured) and its end date show here and NOWHERE else on the page (the separate
// plan tile is gone). Two links: "Edit profile" and, when the profile is live,
// "View your public page".
//
// Plain words, mobile-first at 360px. The completion ring stays as a glance while
// the profile is under 100%.

export default function TutorHeaderCard({
  name,
  avatarUrl,
  city,
  badges,
  verified,
  planName,
  planExpiresAt,
  completion,
  settingsHref,
  publicHref,
}: {
  name: string
  avatarUrl: string | null
  city: string | null
  /** Earned badges, from the entitlements layer. */
  badges: BadgeName[]
  /** The one-time verification fee is paid. */
  verified: boolean
  /** "Basic" / "Premium" / "Featured", or null when unverified. */
  planName: string | null
  /** The plan's end date, when it has one (Premium/Featured). Basic has none. */
  planExpiresAt: string | null
  completion: number
  settingsHref: string
  /** The tutor's public page, when it is live; null otherwise. */
  publicHref: string | null
}) {
  const incomplete = completion < 100
  const ring = `conic-gradient(var(--color-tm-green-deep) ${completion * 3.6}deg, var(--color-gray-200) 0deg)`

  return (
    <section className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:items-center sm:gap-4">
      <div className="relative shrink-0">
        {incomplete ? (
          <div className="grid h-16 w-16 place-items-center rounded-full p-[3px] sm:h-20 sm:w-20" style={{ background: ring }}>
            <span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-white p-[2px]">
              <Avatar src={avatarUrl} name={name} className="h-full w-full text-base" ring="" />
            </span>
          </div>
        ) : (
          <Avatar src={avatarUrl} name={name} className="h-16 w-16 text-base sm:h-20 sm:w-20 sm:text-lg" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        {/* Name + status badges on ONE line (§1.2). */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="truncate text-lg font-black leading-tight text-tm-navy sm:text-xl">{name}</h1>
          {verified && badges.length > 0 && <BadgeRow badges={badges} size="sm" />}
          {!verified && <NotVerifiedBadge urdu />}
        </div>

        {city && <p className="text-xs font-semibold text-gray-500">{city}</p>}

        {/* Plan + end date, here only (§1.3). */}
        {verified && planName && (
          <p className="text-[11px] font-bold text-tm-navy">
            {planName} plan
            {planExpiresAt ? (
              <span className="font-semibold text-gray-500"> · until {formatDate(planExpiresAt)}</span>
            ) : null}
          </p>
        )}

        {incomplete && (
          <p className="text-[11px] font-black text-tm-red">{completion}% complete</p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
          <Link
            href={settingsHref}
            className="inline-flex min-h-[32px] items-center text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline"
          >
            Edit profile
          </Link>
          {publicHref && (
            <Link
              href={publicHref}
              className="inline-flex min-h-[32px] items-center text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline"
            >
              View your public page
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}
