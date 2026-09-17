import Link from 'next/link'

import Avatar from '@/components/Avatar'
import NotVerifiedBadge from '@/components/badges/NotVerifiedBadge'
import { formatDate } from '@/lib/datetime'

// The tutor dashboard's NAME card (PR18 §2.1) — full width, always shown.
//
// Photo, name, city. On one line, the status badges:
//   • a red "Not verified" badge (with its Urdu line) when the one-time fee is
//     unpaid, and
//   • the PLAN badge — Basic / Premium / Featured — with "runs until <date>"
//     whenever a plan is ACTIVE. The plan badge shows independently of the fee and
//     of whether the profile is in the public directory (PR18 §3.2: a Featured
//     tutor was showing only "Not verified" because the plan badge was gated on
//     the fee/directory). Both can appear together — a granted Featured plan on an
//     account that has not paid the fee reads "Not verified" AND "Featured".
//
// A tappable "93% complete — add <first missing item>" line opens that step.
// Links: "Edit profile" and, when the page is live, "View your public page".
//
// Plain words, phone-first — this card is the same at every width.

export default function TutorHeaderCard({
  name,
  avatarUrl,
  city,
  verified,
  planName,
  planExpiresAt,
  pausedPlanName,
  completion,
  nextStepLabel,
  nextStepHref,
  settingsHref,
  publicHref,
}: {
  name: string
  avatarUrl: string | null
  city: string | null
  /** The one-time verification fee is paid. */
  verified: boolean
  /** The ACTIVE plan's name ("Basic"/"Premium"/"Featured"), or null. */
  planName: string | null
  /** The active plan's end date, when it has one (Premium/Featured). */
  planExpiresAt: string | null
  /** A paid-but-not-started plan's name, or null. */
  pausedPlanName: string | null
  completion: number
  /** The first thing to finish, e.g. "add your subjects" — and where to do it. */
  nextStepLabel: string | null
  nextStepHref: string
  settingsHref: string
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
        <h1 className="truncate text-lg font-black leading-tight text-tm-navy">{name}</h1>
        {city && <p className="text-xs font-semibold text-gray-500">{city}</p>}

        {/* Status badges on one line (§2.1). */}
        <div className="flex flex-wrap items-center gap-2">
          {!verified && <NotVerifiedBadge urdu />}
          {planName ? (
            <span className="inline-flex items-center rounded-full bg-tm-tint-green px-2.5 py-0.5 text-[11px] font-bold text-tm-green-deep">
              {planName}
              {planExpiresAt ? (
                <span className="font-semibold"> · runs until {formatDate(planExpiresAt)}</span>
              ) : null}
            </span>
          ) : pausedPlanName ? (
            <span className="inline-flex items-center rounded-full bg-tm-tint-gold px-2.5 py-0.5 text-[11px] font-bold text-tm-gold-ink">
              {pausedPlanName} · starts when you&rsquo;re verified
            </span>
          ) : null}
        </div>

        {/* Tappable completion line (§2.1). */}
        {incomplete && nextStepLabel && (
          <Link
            href={nextStepHref}
            className="inline-flex min-h-[32px] items-center text-[11px] font-black text-tm-red underline-offset-2 hover:underline"
          >
            {completion}% complete — {nextStepLabel}
          </Link>
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
