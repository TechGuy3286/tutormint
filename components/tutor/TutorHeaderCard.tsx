import Link from 'next/link'

import Avatar from '@/components/Avatar'
import NotVerifiedBadge from '@/components/badges/NotVerifiedBadge'

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
        <h1 className="truncate text-lg font-black leading-tight text-tm-navy">{name}</h1>
        {city && <p className="text-xs font-semibold text-gray-500">{city}</p>}

        {/* Badge line: badges left, small Get verified button right (§1.2/§1.6). */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-start gap-2">
            {!verified && <NotVerifiedBadge urdu />}
            {planName && (
              <span className="inline-flex items-center rounded-full bg-tm-tint-green px-2.5 py-0.5 text-[11px] font-bold text-tm-green-deep">
                {planName}
              </span>
            )}
          </div>
          {!verified && (
            <Link
              href="/tutor/complete-profile?step=verify"
              className="inline-flex min-h-[32px] shrink-0 items-center justify-center rounded-lg bg-tm-red px-3 text-[11px] font-bold text-white hover:bg-tm-red-hover"
            >
              Get verified
            </Link>
          )}
        </div>

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
