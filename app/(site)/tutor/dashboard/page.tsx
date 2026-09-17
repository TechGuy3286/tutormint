import { redirect } from 'next/navigation'

import Breadcrumbs from '@/components/Breadcrumbs'
import AdSlot from '@/components/ads/AdSlot'
import CvCard from '@/components/tutor/CvCard'
import SavedJobsSection from '@/components/tutor/SavedJobsSection'
import ViewsCard from '@/components/dashboard/ViewsCard'
import TutorHeaderCard from '@/components/tutor/TutorHeaderCard'
import {
  WhatToDoNextCard,
  TuitionsForYouCard,
  MessagesDemosCard,
  MyApplicationsCard,
  RecentActivityCard,
} from '@/components/tutor/DashboardCards'

import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { computeCompletion } from '@/lib/completion'
import { recentActivity } from '@/lib/dashboardFeed'
import { getEntitlements } from '@/lib/entitlements'
import { jobsThisWeek } from '@/lib/funnel'
import { savedJobsForTutor } from '@/lib/jobFeed'
import { unreadMessageCount } from '@/lib/messaging'
import { tutorNeeds } from '@/lib/needsYou'
import { loadDirectoryStatus } from '@/lib/directoryStatus'
import { listingFixItems } from '@/lib/tutorListingStatus'
import { viewSummary } from '@/lib/profileViews'
import { canDownloadCv } from '@/lib/cv/access'
import { needsOnboarding } from '@/lib/onboardingGate'

// The tutor dashboard — CARDS ONLY (PR17 §1).
//
// No loose text and no band headings. The FIRST card is who-you-are: photo,
// name, city, status badges (the plan with its end date, or a red "Not verified"
// badge when the one-time fee is unpaid), and the two links "Edit profile" /
// "View your public page". Below it, a set of self-contained cards, each with its
// own plain-English title, in a fixed order; a card that has nothing to show is
// hidden (except "What to do next" when something is missing). One column on a
// phone, two columns on desktop below the first card.

export const dynamic = 'force-dynamic'

export default async function TutorDashboardPage() {
  const session = await getSessionUser()
  const userId = session!.user.id

  // The universal onboarding gate: a materially-empty tutor is sent into
  // onboarding here, so every sign-in path routes the same way.
  if (await needsOnboarding(userId)) redirect('/tutor/onboarding')

  const supabase = await createClient()

  const [{ data: tutorProfile }, completion, ent, directory] = await Promise.all([
    supabase
      .from('tutor_profiles')
      .select('slug, city, job_types, verification_status, video_status, video_attempts, degrees')
      .eq('id', userId)
      .maybeSingle(),
    computeCompletion(userId),
    getEntitlements(userId),
    loadDirectoryStatus(userId),
  ])

  const directoryListed = directory.listed
  const city = (tutorProfile?.city as string | null) ?? null
  const jobTypes = (tutorProfile?.job_types as string[] | null) ?? null

  const [needs, activity, views, weekJobs, unread, { data: apps }, { data: demos }, savedJobs] =
    await Promise.all([
      tutorNeeds({
        userId,
        ent,
        verificationStatus: (tutorProfile?.verification_status as string) ?? null,
        videoStatus: (tutorProfile?.video_status as string) ?? null,
        videoAttempts: (tutorProfile?.video_attempts as number) ?? 0,
        city,
        hasDegree: ((tutorProfile?.degrees as string[] | null)?.length ?? 0) > 0,
      }),
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
      jobsThisWeek(userId, city, jobTypes),
      unreadMessageCount(userId),
      supabase.from('applications').select('id, job_id, withdrawn_at').eq('tutor_id', userId),
      supabase.from('demo_requests').select('id, status').eq('tutor_id', userId),
      savedJobsForTutor(userId),
    ])

  const liveApps = (apps ?? []).filter((a) => !a.withdrawn_at)
  const appliedJobIds = liveApps.map((a) => a.job_id as string)
  const liveDemos = (demos ?? []).filter((d) => ['requested', 'accepted'].includes(d.status as string)).length

  const percent = completion?.percent ?? session?.profile?.profile_completion ?? 0
  const publicHref = directoryListed && tutorProfile?.slug ? `/tutor/${tutorProfile.slug}` : null

  // "What to do next": the visibility fixes (mobile, city, area, subjects,
  // gender), then verify if the fee is unpaid, then any other actionable need
  // (a rejected video, a missing degree, an expiring plan). De-duplicated by
  // destination so the same tap is never listed twice.
  const todoRaw: { key: string; label: string; href: string }[] = []
  for (const f of listingFixItems(directory.blockers)) {
    if (f.href) todoRaw.push({ key: f.key, label: f.label, href: f.href })
  }
  if (!ent.verified) {
    todoRaw.push({ key: 'verify', label: 'Verify your account', href: '/tutor/complete-profile?step=verify' })
  }
  for (const n of needs) {
    todoRaw.push({ key: n.id, label: n.title, href: n.action.href })
  }
  const seenHref = new Set<string>()
  const todo = todoRaw.filter((t) => (seenHref.has(t.href) ? false : (seenHref.add(t.href), true)))

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <Breadcrumbs items={[{ label: 'Tutor dashboard' }]} />

        {/* FIRST CARD (§1.2/§1.3): photo, name, city, status badges, plan + end
            date (here only), and the two links. */}
        <TutorHeaderCard
          name={session?.profile?.full_name ?? 'Your profile'}
          avatarUrl={session?.profile?.avatar_url ?? null}
          city={city}
          // A badge is a "you are live to parents" claim, so it shows only when
          // the tutor is actually in the directory.
          badges={directoryListed ? ent.badges : []}
          verified={ent.verified}
          planName={ent.planName ?? ent.pausedPlanName}
          planExpiresAt={ent.expiresAt}
          completion={percent}
          settingsHref="/tutor/dashboard/settings"
          publicHref={publicHref}
        />

        {/* The rest: one column on a phone, two on desktop. Each card hides
            itself when it has nothing to show (§1.5). */}
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <WhatToDoNextCard items={todo} />
          <TuitionsForYouCard jobs={weekJobs} canApply={ent.verified} />
          <MessagesDemosCard unread={unread} demos={liveDemos} />
          <MyApplicationsCard count={liveApps.length} />
          {views.total > 0 && (
            <ViewsCard summary={views} identityGranted={ent.canSeeViewerIdentity} listed={directoryListed} />
          )}
          <SavedJobsSection initial={savedJobs} viewerCity={city} appliedIds={appliedJobIds} />
          <RecentActivityCard items={activity} unreadMessages={unread} />
          <CvCard canDownload={canDownloadCv(ent)} />
        </div>

        {/* House / promo creatives only (revenue spec) — a card, not loose text. */}
        <AdSlot slot="tutor-dashboard" audience="tutors" viewerRole="tutor" viewerPlan={ent.plan} />
      </div>
    </main>
  )
}
