import Link from 'next/link'

import Avatar from '@/components/Avatar'
import BadgeRow from '@/components/badges/BadgeRow'
import type { BadgeName } from '@/lib/planBadges'

// The top of both dashboards: who this is.
//
// WHAT IT REPLACED. "Welcome back, Ali" over a line of grey status text. That
// heading names the reader, which they already know, and spends the most
// valuable strip on the page saying it. What a member actually wants there is
// the answer to "how do I look from the outside" — the photograph parents see,
// the badges they have earned, where they are, and how far from finished the
// profile is.
//
// ONE COMPONENT, BOTH ROLES, because the answer has the same shape for each:
// a picture, a name, badges, and one line of who-and-where. Everything
// role-specific arrives as a prop, so a change to the identity strip cannot
// land on one dashboard and not the other — which is precisely how the two
// dashboards drifted apart in the first place.
//
// THE RING IS THE COMPLETION, and only below 100%. A ring around a finished
// profile is decoration that trains people to ignore rings; a ring around an
// unfinished one is the single most consequential number on a tutor's
// dashboard, because under 100% they are not listed at all. At 100% it goes
// away and the badges are what remain.

export default function IdentityBlock({
  name,
  avatarUrl,
  badges,
  line,
  completion,
  completionHref,
  editHref,
  planNotice,
  extra,
}: {
  name: string
  avatarUrl: string | null
  /** Earned badges, from the entitlements layer. Never inferred here. */
  badges: BadgeName[]
  /** "Verified tutor · Lahore". Built by the caller: it is role-specific. */
  line: string
  /** 0-100. The ring renders only below 100. */
  completion: number
  /** Where an incomplete profile is finished. */
  completionHref: string
  /** The member's own public page or settings, when there is one. */
  editHref?: { label: string; href: string }
  /**
   * An optional action rendered beside the edit link at 100% — the tutor
   * dashboard passes the on-demand "Share your verified badge" trigger here, so
   * it sits in the header card and nothing renders a share image on page load.
   */
  extra?: React.ReactNode
  /**
   * Shown when a tutor has PAID but is not yet listed: "Verified plan active ·
   * your badge appears when your profile reaches 100%." A paid plan alone never
   * draws a badge, so this explains where the badge went. Built by the caller.
   */
  planNotice?: string
}) {
  const incomplete = completion < 100
  // A conic gradient rather than an SVG: it is one element, it needs no
  // viewBox arithmetic to stay round at any size, and the value is also
  // written in text beside it — nothing here is conveyed by the ring alone.
  const ring = `conic-gradient(var(--color-tm-green-deep) ${completion * 3.6}deg, var(--color-gray-200) 0deg)`

  return (
    <header className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:items-center sm:gap-4">
      <div className="relative shrink-0">
        {incomplete ? (
          <div
            className="grid h-16 w-16 place-items-center rounded-full p-[3px] sm:h-20 sm:w-20"
            style={{ background: ring }}
          >
            <span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-white p-[2px]">
              <Avatar src={avatarUrl} name={name} className="h-full w-full text-base" ring="" />
            </span>
          </div>
        ) : (
          <Avatar
            src={avatarUrl}
            name={name}
            className="h-16 w-16 text-base sm:h-20 sm:w-20 sm:text-lg"
          />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="truncate text-lg font-black leading-tight text-tm-navy sm:text-xl">
            {name}
          </h1>
          {badges.length > 0 && <BadgeRow badges={badges} size="sm" />}
        </div>

        <p className="text-xs font-semibold text-gray-500">{line}</p>

        {planNotice && (
          <p className="text-[11px] font-semibold text-tm-gold-ink">{planNotice}</p>
        )}

        {incomplete ? (
          // The number in words as well as in the ring, and a link that goes
          // straight to the unfinished part.
          <Link
            href={completionHref}
            className="inline-flex min-h-[32px] items-center text-[11px] font-black text-tm-red underline-offset-2 hover:underline"
          >
            {completion}% complete — finish your profile
          </Link>
        ) : (
          (editHref || extra) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {editHref && (
                <Link
                  href={editHref.href}
                  className="inline-flex min-h-[32px] items-center text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline"
                >
                  {editHref.label}
                </Link>
              )}
              {extra}
            </div>
          )
        )}
      </div>
    </header>
  )
}
