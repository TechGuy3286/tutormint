import Link from 'next/link'
import { Eye, TrendingUp, AlertTriangle, Info } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements } from '@/lib/entitlements'
import { upgradeHref } from '@/lib/upgradePath'
import AdSlot from '@/components/ads/AdSlot'
import { computeCompletion } from '@/lib/completion'
import { viewTeasers } from '@/lib/profileViews'
import { matchingJobsForTutor } from '@/lib/jobFeed'
import ProfileCompletionWidget from '@/components/ProfileCompletionWidget'
import BadgeRow from '@/components/badges/BadgeRow'
import JobCard from '@/components/JobCard'
import DemoInbox, { type DemoRow } from '@/app/parent/dashboard/DemoInbox'

// The real tutor dashboard.
//
// What a tutor needs the moment they land: am I listed, what does my plan buy
// me, is anyone looking at me, and is there work that matches. In that order.
//
// Applying is live from T5: the card posts to /api/applications, which
// re-checks every gate. Demo requests from parents are answered here too.

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

  const [{ teasers, total: viewTotal }, jobs, { data: myApps }, { data: demos }] =
    await Promise.all([
      viewTeasers(userId, ent.canSeeViewerIdentity),
      matchingJobsForTutor(userId, tutorProfile?.city ?? null),
      supabase.from('applications').select('job_id').eq('tutor_id', userId),
      supabase
        .from('demo_requests')
        .select('id, parent_id, status, mode, proposed_time, decline_reason, created_at')
        .eq('tutor_id', userId)
        .order('created_at', { ascending: false }),
    ])

  const appliedIds = new Set((myApps ?? []).map((a) => a.job_id as string))

  // Parent names come through the service-role client: `profiles` is self-read
  // only, so a tutor cannot read the name of a parent who asked them for a
  // demo with their own client. Only the first name crosses over.
  const parentNames = new Map<string, string>()
  const parentIds = Array.from(new Set((demos ?? []).map((d) => d.parent_id as string)))
  if (parentIds.length > 0) {
    const admin = createAdminClient()
    if (admin) {
      const { data: people } = await admin.from('profiles').select('id, full_name').in('id', parentIds)
      for (const p of people ?? []) {
        parentNames.set(p.id as string, ((p.full_name as string) ?? 'A parent').split(' ')[0])
      }
    }
  }

  const demoRows: DemoRow[] = (demos ?? []).map((d) => ({
    id: d.id as string,
    tutorId: userId,
    tutorName: '',
    tutorSlug: null,
    parentName: parentNames.get(d.parent_id as string) ?? 'A parent',
    status: d.status as DemoRow['status'],
    mode: (d.mode as string) ?? null,
    proposedTime: (d.proposed_time as string) ?? null,
    declineReason: (d.decline_reason as string) ?? null,
    createdAt: d.created_at as string,
  }))

  const firstName = (session?.profile?.full_name ?? 'there').split(' ')[0]

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Welcome back, {firstName}</h1>
          <p className="text-xs text-gray-500">
            {listed ? (
              <>
                You are listed in the tutor directory
                {tutorProfile?.slug && (
                  <>
                    {' · '}
                    <Link href={`/tutor/${tutorProfile.slug}`} className="font-bold text-tm-red hover:underline">
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
          <p className="flex items-start gap-2 rounded-2xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-semibold leading-relaxed text-tm-red-hover">
            <AlertTriangle size={16} className="mt-px shrink-0" />
            Your profile is suspended and is not shown to parents. Check your email for the reason,
            or contact support.
          </p>
        )}

        {tutorProfile?.video_status === 'uploaded' && (
          <p className="flex items-start gap-2 rounded-2xl border border-tm-gold/30 bg-tm-tint-gold p-4 text-xs font-semibold leading-relaxed text-tm-gold-ink">
            <Info size={16} className="mt-px shrink-0" />
            Your video is with our team. It stays private on the channel until it is approved.
          </p>
        )}

        {tutorProfile?.video_status === 'rejected' && (
          <p className="flex items-start gap-2 rounded-2xl border border-tm-gold/30 bg-tm-tint-gold p-4 text-xs font-semibold leading-relaxed text-tm-gold-ink">
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
            <h2 className="text-sm font-black text-tm-navy">
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
            <p className="text-xs font-semibold text-tm-gold-ink">
              Your badges appear once your profile reaches 100%.
            </p>
          ) : null}

          <dl className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                Applications left
              </dt>
              <dd className="text-lg font-black text-tm-navy">
                {ent.plan ? ent.quotaLeft : '—'}
                {ent.plan && (
                  <span className="text-xs font-semibold text-gray-500">
                    {' '}
                    of {ent.displayedQuota}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                Search position
              </dt>
              <dd className="text-lg font-black text-tm-navy">
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
            href={upgradeHref('tutor', ent.plan)}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-tm-black px-5 text-xs font-bold text-white transition-colors hover:bg-tm-navy sm:w-auto"
          >
            {ent.plan ? 'Compare packages' : 'See packages'}
          </Link>
        </section>

        {/* ------------------------------------------------ view teasers ---- */}
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-black text-tm-navy">
              <Eye size={16} className="text-gray-500" />
              Who looked at you
            </h2>
            {viewTotal > 0 && (
              <span className="text-[11px] font-bold text-gray-500">{viewTotal} total</span>
            )}
          </div>

          {teasers.length === 0 ? (
            <p className="text-xs text-gray-500">
              No profile views yet. Views appear here as parents find you in search.
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {teasers.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3">
                    <p className="text-xs leading-relaxed">
                      {t.identified ? (
                        <span className="font-bold text-tm-navy">{t.text}</span>
                      ) : (
                        /* Blur, not omission: the tutor can see that a real
                           person looked, without being told who. */
                        <span className="text-slate-700">{t.text}</span>
                      )}
                    </p>
                    <span className="shrink-0 text-[10px] text-gray-500">{t.when}</span>
                  </li>
                ))}
              </ul>

              {!ent.canSeeViewerIdentity && (
                <Link
                  href="/tutor/packages?plan=premium"
                  className="flex items-center gap-2 rounded-xl bg-tm-tint-gold p-3 text-xs font-bold text-tm-gold-ink"
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
            <h2 className="text-sm font-black text-tm-navy">Tuitions that match you</h2>
            <Link href="/tutor/dashboard/jobs" className="-mr-2 flex min-h-[44px] items-center px-2 text-xs font-bold text-tm-red hover:underline">
              See all
            </Link>
          </div>

          <p className="flex items-start gap-2 rounded-2xl border border-gray-200 bg-white p-3 text-[11px] leading-relaxed text-slate-700">
            <Info size={14} className="mt-px shrink-0 text-gray-500" />
            Only Featured parents can complete a hire. Every job card says which kind of parent
            posted it, so you know before you spend an application.
          </p>

          {jobs.length === 0 ? (
            <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
              No open tuitions match your subjects right now.
            </p>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  href={`/browse/tuitions?job=${job.job_tx_id ?? job.id}`}
                  signedIn
                  showApply
                  applied={appliedIds.has(job.id)}
                />
              ))}
            </div>
          )}
        </section>

        <DemoInbox role="tutor" demos={demoRows} />

        {/* The tutor dashboard slot. House and promo creatives only, per the
            revenue spec -- tutors are not sold to advertisers. */}
        <AdSlot slot="tutor-dashboard" audience="tutors" viewerRole="tutor" />
      </div>
    </main>
  )
}
