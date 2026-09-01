import Link from 'next/link'
import { Eye, TrendingUp, AlertTriangle, Info } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import { computeCompletion } from '@/lib/completion'
import { viewTeasers } from '@/lib/profileViews'
import { matchingJobsForTutor } from '@/lib/jobFeed'
import ProfileCompletionWidget from '@/components/ProfileCompletionWidget'
import BadgeRow from '@/components/badges/BadgeRow'
import JobCard from '@/components/JobCard'

// The real tutor dashboard.
//
// What a tutor needs the moment they land: am I listed, what does my plan buy
// me, is anyone looking at me, and is there work that matches. In that order.
//
// The Apply action is NOT here. Applications, quota spending and the
// applications table are T5; a present-but-dead Apply button would be worse
// than none, so matching jobs are shown as details-only until T5 wires the
// real thing.

export const dynamic = 'force-dynamic'

export default async function TutorDashboardPage() {
  // The layout has already guaranteed a tutor session.
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const [{ data: tutorProfile }, completion, ent] = await Promise.all([
    supabase
      .from('tutor_profiles')
      .select('slug, city, area, verification_status, video_status, video_attempts')
      .eq('id', userId)
      .maybeSingle(),
    // Read-only: shows the tutor exactly where they stand without writing.
    // Persisting happens on the write paths that change profile data.
    computeCompletion(userId),
    getEntitlements(userId),
  ])

  const percent = completion?.percent ?? session?.profile?.profile_completion ?? 0
  const listed = percent >= 100 && tutorProfile?.verification_status !== 'suspended'

  const [{ teasers, total: viewTotal }, jobs] = await Promise.all([
    viewTeasers(userId, ent.canSeeViewerIdentity),
    matchingJobsForTutor(userId, tutorProfile?.city ?? null),
  ])

  const firstName = (session?.profile?.full_name ?? 'there').split(' ')[0]

  return (
    <main className="min-h-screen bg-[#F8FAFC] px-4 py-6 text-[#334155] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-black text-[#0F172A] sm:text-2xl">Welcome back, {firstName}</h1>
          <p className="text-xs text-gray-500">
            {listed ? (
              <>
                You are listed in the tutor directory
                {tutorProfile?.slug && (
                  <>
                    {' · '}
                    <Link href={`/tutor/${tutorProfile.slug}`} className="font-bold text-[#d60008] hover:underline">
                      view your public profile
                    </Link>
                  </>
                )}
              </>
            ) : (
              'You are not listed yet'
            )}
          </p>
        </header>

        {/* ------------------------------------------------------ notices --- */}
        {tutorProfile?.verification_status === 'suspended' && (
          <p className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold leading-relaxed text-[#991B1B]">
            <AlertTriangle size={16} className="mt-px shrink-0" />
            Your profile is suspended and is not shown to parents. Check your email for the reason,
            or contact support.
          </p>
        )}

        {tutorProfile?.video_status === 'uploaded' && (
          <p className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold leading-relaxed text-[#92400E]">
            <Info size={16} className="mt-px shrink-0" />
            Your video is with our team. It stays private on the channel until it is approved.
          </p>
        )}

        {tutorProfile?.video_status === 'rejected' && (
          <p className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold leading-relaxed text-[#92400E]">
            <AlertTriangle size={16} className="mt-px shrink-0" />
            Your video was not accepted ({tutorProfile.video_attempts ?? 0} of 3 attempts used).
            {(tutorProfile.video_attempts ?? 0) >= 3
              ? ' Uploads are now locked — please contact support.'
              : ' You can record and upload a new one.'}
          </p>
        )}

        {/* --------------------------------------------------- completion --- */}
        {completion && (
          <ProfileCompletionWidget percent={percent} items={completion.items} role="tutor" />
        )}

        {/* --------------------------------------------------------- plan --- */}
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-black text-[#0F172A]">
              {ent.planName ? `${ent.planName} plan` : 'No active plan'}
            </h2>
            {ent.expiresAt && (
              <span className="text-[11px] font-semibold text-gray-500">
                renews or ends{' '}
                {new Date(ent.expiresAt).toLocaleDateString('en-PK', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            )}
          </div>

          {ent.badges.length > 0 ? (
            <BadgeRow badges={ent.badges} size="md" showLabel />
          ) : ent.plan ? (
            <p className="text-xs font-semibold text-amber-700">
              Your badges appear once your profile reaches 100%.
            </p>
          ) : null}

          <dl className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                Applications left
              </dt>
              <dd className="text-lg font-black text-[#0F172A]">
                {ent.plan ? ent.quotaLeft : '—'}
                {ent.plan && (
                  <span className="text-xs font-semibold text-gray-400">
                    {' '}
                    of {ent.displayedQuota}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                Search position
              </dt>
              <dd className="text-lg font-black text-[#0F172A]">
                {ent.plan === 'featured'
                  ? 'Top'
                  : ent.plan === 'premium'
                    ? 'High'
                    : ent.plan === 'verified'
                      ? 'Standard'
                      : 'Lowest'}
              </dd>
            </div>
          </dl>

          <Link
            href="/tutor/packages"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-[#0F172A] px-5 text-xs font-bold text-white transition-colors hover:bg-[#1E293B] sm:w-auto"
          >
            {ent.plan ? 'Compare packages' : 'See packages'}
          </Link>
        </section>

        {/* ------------------------------------------------ view teasers ---- */}
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-black text-[#0F172A]">
              <Eye size={16} className="text-gray-400" />
              Who looked at you
            </h2>
            {viewTotal > 0 && (
              <span className="text-[11px] font-bold text-gray-500">{viewTotal} total</span>
            )}
          </div>

          {teasers.length === 0 ? (
            <p className="text-xs text-gray-400">
              No profile views yet. Views appear here as parents find you in search.
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {teasers.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3">
                    <p className="text-xs leading-relaxed">
                      {t.identified ? (
                        <span className="font-bold text-[#0F172A]">{t.text}</span>
                      ) : (
                        /* Blur, not omission: the tutor can see that a real
                           person looked, without being told who. */
                        <span className="text-[#334155]">{t.text}</span>
                      )}
                    </p>
                    <span className="shrink-0 text-[10px] text-gray-400">{t.when}</span>
                  </li>
                ))}
              </ul>

              {!ent.canSeeViewerIdentity && (
                <Link
                  href="/tutor/packages"
                  className="flex items-center gap-2 rounded-xl bg-[#FFFBEB] p-3 text-xs font-bold text-[#92400E]"
                >
                  <TrendingUp size={14} />
                  Upgrade to Premium to see who these parents are
                </Link>
              )}
            </>
          )}
        </section>

        {/* ------------------------------------------------ matching jobs --- */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-black text-[#0F172A]">Tuitions that match you</h2>
            <Link href="/tutor/dashboard/jobs" className="text-xs font-bold text-[#d60008] hover:underline">
              See all
            </Link>
          </div>

          <p className="flex items-start gap-2 rounded-2xl border border-gray-200 bg-white p-3 text-[11px] leading-relaxed text-[#334155]">
            <Info size={14} className="mt-px shrink-0 text-gray-400" />
            Only Featured parents can complete a hire. Every job card says which kind of parent
            posted it, so you know before you spend an application.
          </p>

          {jobs.length === 0 ? (
            <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-400">
              No open tuitions match your subjects right now.
            </p>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} href={`/tutor/dashboard/jobs#${job.id}`} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
