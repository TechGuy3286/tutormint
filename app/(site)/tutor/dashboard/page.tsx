import Breadcrumbs from '@/components/Breadcrumbs'
import { Info, TrendingUp } from 'lucide-react'

import AdSlot from '@/components/ads/AdSlot'
import OnlineSuitableChip from '@/components/OnlineSuitableChip'
import EmptyState from '@/components/EmptyState'
import VerifiedShareCard from '@/components/tutor/VerifiedShareCard'
import CvCard from '@/components/tutor/CvCard'
import { canDownloadCv } from '@/lib/cv/access'
import { absoluteUrl } from '@/lib/siteUrl'
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
import IdentityBlock from '@/components/dashboard/IdentityBlock'
import ViewsCard from '@/components/dashboard/ViewsCard'
import IdentityStatusLine from '@/components/identity/IdentityStatusLine'
import { loadIdentity } from '@/lib/identity'
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
  // The authoritative listing fact, computed once in the entitlements layer
  // (100% + verification not rejected/suspended + claimed). Using it here keeps
  // "Listed tutor" and the badge on the same rule.
  const listed = ent.listed
  const free = !ent.plan && !ent.planPaused

  // A tutor who has PAID but is not yet listed: their badge is waiting on 100%.
  // A paid plan alone never draws a badge, so the identity block says where it
  // went. Covers both a paused plan (bought under 100%) and an active plan on a
  // delisted profile.
  const planForNotice = ent.pausedPlanName ?? ent.planName
  const planNotice =
    !listed && planForNotice
      ? `${planForNotice} plan active · your badge appears when your profile reaches 100%.`
      : undefined

  const [
    needs,
    activity,
    views,
    identity,
    matching,
    unreadMessages,
    { data: apps },
    { data: demos },
  ] = await Promise.all([
      tutorNeeds({
        userId,
        ent,
        completionPercent: percent,
        verificationStatus: (tutorProfile?.verification_status as string) ?? null,
        videoStatus: (tutorProfile?.video_status as string) ?? null,
        videoAttempts: (tutorProfile?.video_attempts as number) ?? 0,
      }),
      // profile_viewed is hidden here and only here: ViewsCard is directly
      // above this band and is the surface for it. See recentActivity().
      // profile_viewed: the teaser above is that surface. The plan-ended kinds:
      // suppressed while a plan is live, so a reactivated tutor is never shown a
      // "plan ended · Reactivate" card beside their active plan (same rule as
      // the Needs-you lapsedPlanRow).
      recentActivity({
        userId,
        role: 'tutor',
        limit: 8,
        hideKinds:
          ent.plan || ent.planPaused
            ? ['profile_viewed', 'plan_expired', 'plan_revoked', 'plan_cancelled', 'plan_ended']
            : ['profile_viewed'],
      }),
      viewSummary(userId, ent.canSeeViewerIdentity, 20),
      loadIdentity(userId),
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

  // "Verified tutor - Lahore". `listed` is the fact that matters to a tutor
  // and it is not the same as holding a badge: a complete, unsuspended profile
  // is listed whatever the plan. The city is dropped rather than written as
  // "unknown" -- a tutor who has not filled it in does not need telling on
  // every visit, and the completion link above says so already.
  const identityLine = [
    listed ? 'Listed tutor' : 'Not listed yet',
    (tutorProfile?.city as string | null) || session?.profile?.city || null,
  ]
    .filter(Boolean)
    .join(' · ')

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
      label: ent.planName
        ? `${ent.planName} plan`
        : ent.pausedPlanName
          ? `${ent.pausedPlanName} plan`
          : 'No active plan',
      count: ent.plan ? ent.quotaLeft : null,
      note: ent.plan ? 'applies left' : ent.planPaused ? 'starts at 100%' : undefined,
      href: '/tutor/packages',
      icon: 'plan',
    },
  ]

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <Breadcrumbs items={[{ label: 'Tutor dashboard' }]} />

        {/* Who this is, from the outside -- the same component the parent
            dashboard uses. See IdentityBlock for why one and not two. */}
        <IdentityBlock
          name={session?.profile?.full_name ?? 'Your profile'}
          avatarUrl={session?.profile?.avatar_url ?? null}
          badges={ent.badges}
          line={identityLine}
          planNotice={planNotice}
          completion={percent}
          completionHref="/tutor/complete-profile"
          editHref={
            tutorProfile?.slug
              ? { label: 'View your public profile', href: `/tutor/${tutorProfile.slug}` }
              : { label: 'Edit your profile', href: '/tutor/dashboard/settings' }
          }
        />

        <NeedsYou
          rows={needs}
          emptyHint={
            listed
              ? 'Your profile is live and parents can find you.'
              : 'Nothing is blocking you right now.'
          }
        />

        {/* You're verified — a share card, shown the moment the tutor is
            LISTED (the same condition their badge appears under). Generated
            from their own profile; posting is the tutor's, via the buttons. */}
        {listed && tutorProfile?.slug && (
          <VerifiedShareCard
            profileUrl={absoluteUrl(`/tutor/${tutorProfile.slug}`)}
            firstName={(session?.profile?.full_name ?? 'there').split(' ')[0]}
          />
        )}

        {/* Your CV — the print-ready CV built from the profile. Preview is free
            to every tutor; the download is Verified-gated (via the upsell). */}
        <CvCard canDownload={canDownloadCv(ent)} />

        {/* ------------------------------------------- the 199 funnel --- */}
        <ViewsCard summary={views} identityGranted={ent.canSeeViewerIdentity} />

        {/* One compact status line, not the full identity form. The CNIC
            front/back, selfie and "Request a change" live only in
            Settings → Identity (/tutor/dashboard/settings). A verified account
            shows only "Verified" — never an upload prompt for documents it is
            retaining privately. */}
        <IdentityStatusLine state={identity.state} settingsHref="/tutor/dashboard/settings" />

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

        {free && (
          <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="text-xs font-black text-tm-navy">Jobs matching you this week</h2>
            {weekJobs.length === 0 ? (
              <EmptyState
                icon={<TrendingUp aria-hidden size={18} />}
                title="No new tuitions matched your subjects this week. Keep your subjects and city set so parents find you — new tuitions are posted daily."
                action={{ label: 'See all open tuitions', href: '/tutor/dashboard/jobs' }}
              />
            ) : (
            <ul className="divide-y divide-gray-100">
              {weekJobs.slice(0, 3).map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-bold text-tm-navy">
                      {j.title}
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
                      <span className="truncate">
                        {[j.area, j.city].filter(Boolean).join(', ') || 'Pakistan'}
                      </span>
                      {j.onlineSuitable && <OnlineSuitableChip />}
                    </span>
                    {/* Why this job is here, in one line. Matching is unchanged;
                        this only names the shared subject and the location tie. */}
                    <span className="block truncate text-[10px] font-semibold text-tm-green-deep">
                      {j.matchReason}
                    </span>
                  </span>
                  {/* Apply routes through the upgrade sheet: the button is
                      real, the refusal explains itself, and nothing here shows
                      a price until it is pressed. */}
                  <ApplyFromStrip jobId={j.id} />
                </li>
              ))}
            </ul>
            )}
          </section>
        )}

        <ActivityBand
          items={activity}
          inboxHref="/tutor/dashboard/messages"
          emptyHint="Nothing has happened yet. Applications, parent replies and demo requests will appear here."
          emptyAction={{ label: 'See open tuitions', href: '/tutor/dashboard/jobs' }}
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
        <AdSlot slot="tutor-dashboard" audience="tutors" viewerRole="tutor" viewerPlan={ent.plan} />
      </div>
    </main>
  )
}
