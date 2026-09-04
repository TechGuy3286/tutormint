import Breadcrumbs from '@/components/Breadcrumbs'
import Link from 'next/link'
import { Info, TrendingUp } from 'lucide-react'

import AdSlot from '@/components/ads/AdSlot'
import BadgeRow from '@/components/badges/BadgeRow'
import ActivityBand from '@/components/dashboard/ActivityBand'
import NeedsYou from '@/components/dashboard/NeedsYou'
import YourThings, { type ThingRow } from '@/components/dashboard/YourThings'
import { getSessionUser } from '@/lib/auth'
import { computeCompletion } from '@/lib/completion'
import { recentActivity } from '@/lib/dashboardFeed'
import { getEntitlements } from '@/lib/entitlements'
import { jobsThisWeek, tutorPosition } from '@/lib/funnel'
import { matchingJobsForTutor } from '@/lib/jobFeed'
import { unreadMessageCount } from '@/lib/messaging'
import { tutorNeeds } from '@/lib/needsYou'
import ViewsCard from '@/components/dashboard/ViewsCard'
import { viewSummary } from '@/lib/profileViews'
import { createClient } from '@/lib/supabase/server'

import ApplyFromStrip from './ApplyFromStrip'

// The tutor dashboard, in three bands.
//
//   1. NEEDS YOU   blocked on this tutor -- completion, a rejected video, a
//                  shortlist waiting on a reply, an expiring plan
//   2. ACTIVITY    real events, newest first
//   3. YOUR THINGS counts that link out
//
// Between 1 and 2 sit the 199-funnel surfaces, and that placement is a
// deliberate reconciliation of two rules rather than an oversight. CLAUDE.md's
// conversion section says the profile-view teaser goes at the TOP of a free
// tutor's dashboard; this brief says Needs you comes first and always renders,
// even when empty. Both cannot be literally true. Needs you wins the top
// because it is short, and because the item it usually holds for a free tutor
// -- "your profile is 46% complete, nobody can find you" -- is the same
// argument the funnel is making, only actionable. The teaser sits immediately
// below, above everything else, which is as close to the letter of the
// conversion rule as the two allow. Flagged for the owner rather than
// silently resolved.
//
// The previous version rendered the "Who looked at you" card TWICE -- once in
// the `free` branch and again in the `!free` branch, with identical markup
// copied out. It is rendered once now, with the placement varying instead.

export const dynamic = 'force-dynamic'

export default async function TutorDashboardPage() {
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const [{ data: tutorProfile }, completion, ent] = await Promise.all([
    supabase
      .from('tutor_profiles')
      .select('slug, city, area, verification_status, video_status, video_attempts')
      .eq('id', userId)
      .maybeSingle(),
    computeCompletion(userId),
    getEntitlements(userId),
  ])

  const percent = completion?.percent ?? session?.profile?.profile_completion ?? 0
  const listed = percent >= 100 && tutorProfile?.verification_status !== 'suspended'
  const free = !ent.plan

  const [needs, activity, views, matching, unreadMessages, { data: apps }, { data: demos }] =
    await Promise.all([
      tutorNeeds({
        userId,
        ent,
        completionPercent: percent,
        verificationStatus: (tutorProfile?.verification_status as string) ?? null,
        videoStatus: (tutorProfile?.video_status as string) ?? null,
        videoAttempts: (tutorProfile?.video_attempts as number) ?? 0,
      }),
      recentActivity({ userId, role: 'tutor', limit: 8 }),
      viewSummary(userId, ent.canSeeViewerIdentity, 20),
      matchingJobsForTutor(userId, tutorProfile?.city ?? null),
      unreadMessageCount(userId),
      supabase.from('applications').select('id, status, withdrawn_at').eq('tutor_id', userId),
      supabase.from('demo_requests').select('id, status').eq('tutor_id', userId),
    ])

  // The rest of the funnel is loaded only for a tutor with no plan: a paying
  // tutor already has what these surfaces argue for, and showing somebody a
  // pitch for what they have bought is noise.
  const [position, weekJobs] = free
    ? await Promise.all([tutorPosition(userId), jobsThisWeek(userId, tutorProfile?.city ?? null)])
    : [null, []]

  const liveApps = (apps ?? []).filter((a) => !a.withdrawn_at)
  // Real rows, not a hard-coded false. See unreadMessageCount().
  const unread = unreadMessages
  const liveDemos = (demos ?? []).filter((d) =>
    ['requested', 'accepted'].includes(d.status as string),
  ).length

  const firstName = (session?.profile?.full_name ?? 'there').split(' ')[0]

  const things: ThingRow[] = [
    {
      key: 'applications',
      label: 'My applications',
      count: liveApps.length,
      note: liveApps.length > 0 ? 'live' : undefined,
      href: '/tutor/dashboard/applications',
      icon: 'applications',
    },
    {
      key: 'messages',
      label: 'Messages',
      count: unread,
      note: 'unread',
      href: '/tutor/dashboard/messages',
      icon: 'messages',
      highlight: unread > 0,
    },
    {
      key: 'jobs',
      label: 'Tuitions matching you',
      count: matching.length,
      href: '/tutor/dashboard/jobs',
      icon: 'jobs',
      highlight: matching.length > 0,
    },
    {
      key: 'demos',
      label: 'Demo requests',
      count: liveDemos,
      note: liveDemos > 0 ? 'live' : undefined,
      href: '/tutor/dashboard/demos',
      icon: 'demos',
      highlight: liveDemos > 0,
    },
    {
      key: 'views',
      label: 'Profile views',
      count: views.total,
      href: tutorProfile?.slug ? `/tutor/${tutorProfile.slug}` : '/tutor/dashboard',
      icon: 'views',
    },
    {
      key: 'plan',
      label: ent.planName ? `${ent.planName} plan` : 'No active plan',
      count: ent.plan ? ent.quotaLeft : null,
      note: ent.plan ? 'applies left' : undefined,
      href: '/tutor/packages',
      icon: 'plan',
    },
  ]

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <Breadcrumbs items={[{ label: 'Tutor dashboard' }]} />

        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Welcome back, {firstName}</h1>
          <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {listed ? 'You are listed in the tutor directory' : 'You are not listed yet'}
            {ent.badges.length > 0 && <BadgeRow badges={ent.badges} size="sm" />}
          </p>
        </header>

        <NeedsYou
          rows={needs}
          emptyHint={
            listed
              ? 'Your profile is live and parents can find you.'
              : 'Nothing is blocking you right now.'
          }
        />

        {/* ------------------------------------------- the 199 funnel --- */}
        <ViewsCard summary={views} identityGranted={ent.canSeeViewerIdentity} />

        {free && position && (
          // id, so the rank_dropped notification's button has somewhere to
          // land: the fact is in the notification, the detail is here.
          <section
            id="position"
            className="scroll-mt-24 space-y-1.5 rounded-2xl border border-gray-200 bg-white p-4"
          >
            <h2 className="flex items-center gap-2 text-xs font-black text-tm-navy">
              <TrendingUp aria-hidden size={15} className="text-gray-500" />
              Your position
            </h2>
            <p className="text-[11px] leading-relaxed text-slate-700">
              You are <span className="font-black text-tm-navy">#{position.rank}</span> of{' '}
              {position.total} for {position.subjectLabel}
              {position.city ? ` in ${position.city}` : ''}.
            </p>
            {position.paidAbove > 0 && (
              <p className="rounded-xl bg-tm-tint-gold p-2.5 text-[11px] font-bold leading-relaxed text-tm-gold-ink">
                {position.paidAbove === 1
                  ? 'One tutor above you is there because they are Verified.'
                  : `${position.paidAbove} of the tutors above you are there because they are Verified.`}{' '}
                Verified tutors appear above you.
              </p>
            )}
          </section>
        )}

        {free && weekJobs.length > 0 && (
          <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="text-xs font-black text-tm-navy">Jobs matching you this week</h2>
            <ul className="divide-y divide-gray-100">
              {weekJobs.slice(0, 3).map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-bold text-tm-navy">
                      {j.title}
                    </span>
                    <span className="block truncate text-[10px] text-gray-500">
                      {[j.area, j.city].filter(Boolean).join(', ') || 'Pakistan'}
                    </span>
                  </span>
                  {/* Apply routes through the upgrade sheet: the button is
                      real, the refusal explains itself, and nothing here shows
                      a price until it is pressed. */}
                  <ApplyFromStrip jobId={j.id} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <ActivityBand
          items={activity}
          inboxHref="/tutor/dashboard/messages"
          emptyHint="Nothing has happened yet. Applications, parent replies and demo requests will appear here."
        />

        <YourThings rows={things} />

        {/* The tutor-side steering CLAUDE.md asks to be persistent on this
            page. One line, not a card: the full explanation sits with the job
            cards on /tutor/dashboard/jobs, where it is being acted on. */}
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-gray-500">
          <Info aria-hidden size={13} className="mt-0.5 shrink-0" />
          Only Featured parents can complete a hire. Every job card says which kind of parent posted
          it, so you know before you spend an application.
        </p>

        {/* House and promo creatives only, per the revenue spec — tutors are
            not sold to advertisers. */}
        <AdSlot slot="tutor-dashboard" audience="tutors" viewerRole="tutor" />
      </div>
    </main>
  )
}
