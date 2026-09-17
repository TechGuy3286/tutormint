import Link from 'next/link'
import { Eye } from 'lucide-react'

import Avatar from '@/components/Avatar'
import NotVerifiedBadge from '@/components/badges/NotVerifiedBadge'
import UpgradeTrigger from '@/components/upgrade/UpgradeTrigger'

// The tutor dashboard's ONE profile card (PR19 §1). It holds everything about the
// tutor, so the page can drop the separate "What to do next" and "Who looked at
// you" cards:
//   • photo, name, city;
//   • status badges on one line — a red "Not verified" badge (with its Urdu line)
//     when the one-time fee is unpaid, and the plan badge (Basic/Premium/Featured)
//     with NO date;
//   • when not verified, a plain line + a "Get verified" button that opens the
//     verify step (no price);
//   • a tappable "93% complete — <Next step>" line that opens the first missing
//     item;
//   • a profile-views line "N parents viewed your profile" with a "See who" link;
//   • "Edit profile" and "View your public page" links.
//
// Plain words, phone-first — the same at every width.

export default function TutorHeaderCard({
  name,
  avatarUrl,
  city,
  verified,
  planName,
  completion,
  nextStepLabel,
  nextStepHref,
  viewsTotal,
  canSeeViewers,
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
  completion: number
  /** The first thing to finish, e.g. "Add your subjects" — and where to do it. */
  nextStepLabel: string | null
  nextStepHref: string
  /** Number of parent views (already parent-only). */
  viewsTotal: number
  /** The plan reveals viewer names (premium+). */
  canSeeViewers: boolean
  settingsHref: string
  /** The tutor's public page, when it is live; null otherwise. */
  publicHref: string | null
}) {
  const incomplete = completion < 100
  const ring = `conic-gradient(var(--color-tm-green-deep) ${completion * 3.6}deg, var(--color-gray-200) 0deg)`

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start gap-3">
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

          {/* Status badges on one line (§1.1). Plan badge has no date. */}
          <div className="flex flex-wrap items-center gap-2">
            {!verified && <NotVerifiedBadge urdu />}
            {planName && (
              <span className="inline-flex items-center rounded-full bg-tm-tint-green px-2.5 py-0.5 text-[11px] font-bold text-tm-green-deep">
                {planName}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {/* Not verified → one line + a Get verified button (no price). */}
        {!verified && (
          <div className="flex flex-col gap-2 rounded-xl bg-tm-tint-red p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold text-tm-red">You are not verified yet.</p>
            <Link
              href="/tutor/complete-profile?step=verify"
              className="inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-xl bg-tm-red px-4 text-xs font-bold text-white hover:bg-tm-red-hover"
            >
              Get verified
            </Link>
          </div>
        )}

        {/* Tappable completion line (§1.1) — opens the first missing step. */}
        {incomplete && nextStepLabel && (
          <Link
            href={nextStepHref}
            className="flex min-h-[36px] items-center text-xs font-black text-tm-red underline-offset-2 hover:underline"
          >
            {completion}% complete — {nextStepLabel}
          </Link>
        )}

        {/* Profile views, one line with a "See who" link. */}
        {viewsTotal > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-700">
              {viewsTotal} parent{viewsTotal === 1 ? '' : 's'} viewed your profile
            </p>
            {canSeeViewers ? (
              <Link
                href="/tutor/dashboard/views"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-tm-navy hover:underline"
              >
                <Eye aria-hidden size={13} /> See who
              </Link>
            ) : (
              <UpgradeTrigger
                reason="tutor_viewer_identity"
                className="inline-flex items-center rounded-lg bg-tm-gold px-2.5 py-1 text-[11px] font-black text-tm-navy hover:opacity-90"
              >
                See who
              </UpgradeTrigger>
            )}
          </div>
        )}

        {/* Links (§1.1). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
