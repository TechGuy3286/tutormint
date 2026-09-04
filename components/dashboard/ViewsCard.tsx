import Link from 'next/link'
import { Eye } from 'lucide-react'

import TimeAgo from '@/components/TimeAgo'
import ViewerFace from '@/components/dashboard/ViewerFace'
import UpgradeTrigger from '@/components/upgrade/UpgradeTrigger'
import type { ViewSummary } from '@/lib/profileViews'

// "Who looked at you" — one card, not a list.
//
// WHAT IT REPLACED: up to six rows, each a disc, a sentence and a timestamp,
// all saying the same shape of thing. On a dashboard whose first band is
// already a list of rows it read as more log, and the fact a tutor actually
// wants — how many people have looked, and how many recently — was not stated
// anywhere. It was the platform's primary upsell surface rendered as a
// changelog.
//
// Now: a headline with the real counts, a stack of discs, ONE line of the most
// recent real detail, one button.
//
// THE DISCS ARE STILL SEEDED FROM THE VIEW ROW, NEVER THE VIEWER. That is the
// whole reason ViewerFace exists — see its own header. A free tutor is sent no
// avatar URL at all, so there is nothing in the DOM to un-blur, and two views
// by the same parent cannot be matched to each other by comparing colours.
//
// THE BUTTON CARRIES A REASON, NEVER A PRICE. `tutor_viewer_identity` resolves
// to whichever plan holds can_see_viewer_identity when the sheet is opened —
// Verified, since migration 43 — so a tutor dashboard ships with no pricing in
// its HTML at all, the same rule the locked contact row follows.

export default function ViewsCard({
  summary,
  identityGranted,
}: {
  summary: ViewSummary
  /** plans.can_see_viewer_identity — verified, premium and featured. */
  identityGranted: boolean
}) {
  const { total, thisWeek, latest, faces } = summary

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-xs font-black text-tm-navy">
        <Eye aria-hidden size={15} className="text-gray-500" />
        Who looked at you
      </h2>

      {total === 0 ? (
        <p className="text-[11px] leading-relaxed text-gray-500">
          No profile views yet. Views appear here as parents find you in search — the more complete
          your profile, the more searches you appear in.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            {/* The stack. Overlapping by half reads as "several people" at a
                glance, which is the whole job; a row of six separated discs
                reads as a list again. */}
            {faces.length > 0 && (
              <div className="flex shrink-0 items-center">
                {faces.map((f, i) => (
                  <span
                    key={f.id}
                    // shrink-0 on the WRAPPER, not just on the face inside it:
                    // these are flex items, and without it the row compressed
                    // every disc to a 4px sliver.
                    className={`inline-flex shrink-0 rounded-full ring-2 ring-white ${
                      i === 0 ? '' : '-ml-3'
                    }`}
                    style={{ zIndex: faces.length - i }}
                  >
                    <ViewerFace
                      identified={f.identified}
                      name={f.text.split(' ')[0]}
                      avatarUrl={f.avatarUrl}
                      seed={f.id}
                    />
                  </span>
                ))}
              </div>
            )}

            {/* "· N this week" only when N is not simply the total again.
                A tutor whose every view arrived this week was being told
                "6 parents viewed your profile · 6 this week", which reads as
                two facts and is one. */}
            <p className="min-w-0 flex-1 text-sm font-black leading-snug text-tm-navy">
              {total} {total === 1 ? 'parent' : 'parents'} viewed your profile
              {thisWeek > 0 && thisWeek !== total && (
                <span className="font-bold text-gray-500"> · {thisWeek} this week</span>
              )}
            </p>
          </div>

          {/* One line of real detail: the subject and the area of the search
              that led here. This is what the spec always asked the teaser to
              say, and it is the one thing a list of six near-identical rows
              made hard to find.
              A view with no search context is a direct visit — somebody
              followed a link rather than searched — and the line says exactly
              that rather than inventing a subject. */}
          {latest && (
            <p className="text-[11px] leading-relaxed text-gray-500">
              <span className="font-bold text-slate-700">Latest:</span>{' '}
              {identityGranted ? latest.text : detail(latest.subject, latest.where)}
              {', '}
              <TimeAgo iso={latest.at} />
            </p>
          )}

          {identityGranted ? (
            <Link
              href="/tutor/dashboard/views"
              className="gap-1.5 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
            >
              <Eye aria-hidden size={14} />
              See who
            </Link>
          ) : (
            <UpgradeTrigger
              reason="tutor_viewer_identity"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-tm-gold px-5 text-xs font-black text-tm-navy transition-opacity hover:opacity-90"
            >
              See who
            </UpgradeTrigger>
          )}
        </>
      )}
    </section>
  )
}

/** "searching O Level Physics in Gulberg", with whichever half exists. */
function detail(subject: string | null, where: string | null): string {
  if (subject && where) return `searching ${subject} in ${where}`
  if (subject) return `searching ${subject}`
  if (where) return `a parent in ${where}`
  return 'a parent opened your profile'
}
