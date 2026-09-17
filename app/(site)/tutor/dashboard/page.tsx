import { redirect } from 'next/navigation'
import { Send, MessageSquare, Video, Briefcase, Eye, Heart } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import AdSlot from '@/components/ads/AdSlot'
import CvCard from '@/components/tutor/CvCard'
import SavedJobsSection from '@/components/tutor/SavedJobsSection'
import ViewsCard from '@/components/dashboard/ViewsCard'
import TutorHeaderCard from '@/components/tutor/TutorHeaderCard'
import {
  WhatToDoNextCard,
  CountGrid,
  TuitionsForYouCard,
  RecentActivityCard,
  NotesCard,
  type CountTile,
} from '@/components/tutor/DashboardCards'

import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { computeCompletion } from '@/lib/completion'
import { checklistHref } from '@/lib/profileChecklist'
import { recentActivity } from '@/lib/dashboardFeed'
import { getEntitlements } from '@/lib/entitlements'
import { jobsThisWeek } from '@/lib/funnel'
import { savedJobsForTutor } from '@/lib/jobFeed'
import { unreadMessageCount } from '@/lib/messaging'
import { loadDirectoryStatus } from '@/lib/directoryStatus'
import { viewSummary } from '@/lib/profileViews'
import { canDownloadCv } from '@/lib/cv/access'
import { needsOnboarding } from '@/lib/onboardingGate'

// The tutor dashboard — CARDS ONLY, phone-first (PR18).
//
// One phone layout at every width: a single narrow centred column (~480px), no
// desktop grid. Every heading, note and info line lives inside a card. The
// breadcrumb sits tight under the header; the page has bottom padding so the
// floating WhatsApp button never covers a card.

export const dynamic = 'force-dynamic'

// Plain, short "next step" wording for each checklist item, keyed on its key.
const NEXT_LABEL: Record<string, string> = {
  verify: 'get verified',
  phone: 'verify your mobile',
  city: 'add your city',
  area: 'add your area',
  subjects: 'add your subjects',
  gender: 'add your gender',
  name: 'add your name',
  photo: 'add your photo',
  tagline: 'add a tagline',
  bio: 'add your about-you',
  experience: 'add your experience',
  fee: 'add your fee',
  mode: 'add your job type',
  degree: 'add a degree',
  cnic: 'add your CNIC',
  video: 'add your video',
}

export default async function TutorDashboardPage() {
  const session = await getSessionUser()
  const userId = session!.user.id

  if (await needsOnboarding(userId)) redirect('/tutor/onboarding')

  const supabase = await createClient()

  const [{ data: tutorProfile }, completion, ent, directory] = await Promise.all([
    supabase.from('tutor_profiles').select('slug, city, job_types').eq('id', userId).maybeSingle(),
    computeCompletion(userId),
    getEntitlements(userId),
    loadDirectoryStatus(userId),
  ])

  const directoryListed = directory.listed
  const city = (tutorProfile?.city as string | null) ?? null
  const jobTypes = (tutorProfile?.job_types as string[] | null) ?? null

  const [activity, views, weekJobs, unread, { data: apps }, { data: demos }, savedJobs] =
    await Promise.all([
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

  // §2.1(2) — the real to-dos, from the completion checklist (verify, mobile,
  // city, subjects, gender, degree, CNIC, video…). Not news.
  const todo = (completion?.missing ?? []).map((it) => ({
    key: it.key,
    label: NEXT_LABEL[it.key] ?? it.label,
    href: checklistHref('tutor', it),
  }))

  const tiles: CountTile[] = [
    { key: 'apps', icon: <Send aria-hidden size={22} />, value: liveApps.length, label: 'My applications', href: '/tutor/dashboard/applications', tone: 'green' },
    { key: 'messages', icon: <MessageSquare aria-hidden size={22} />, value: unread, label: 'Messages', href: '/tutor/dashboard/messages', tone: 'navy', highlight: unread > 0 },
    { key: 'demos', icon: <Video aria-hidden size={22} />, value: liveDemos, label: 'Demo requests', href: '/tutor/dashboard/demos', tone: 'red', highlight: liveDemos > 0 },
    { key: 'tuitions', icon: <Briefcase aria-hidden size={22} />, value: weekJobs.length, label: 'Tuitions for you', href: '/tutor/dashboard/jobs', tone: 'gold' },
    { key: 'views', icon: <Eye aria-hidden size={22} />, value: views.total, label: 'Profile views', href: '#who-looked', tone: 'mint' },
    { key: 'saved', icon: <Heart aria-hidden size={22} />, value: savedJobs.length, label: 'Saved tuitions', href: '#saved-tuitions', tone: 'mint' },
  ]

  return (
    <main className="min-h-screen bg-tm-bg px-4 pt-3 pb-28">
      <div className="mx-auto w-full max-w-[480px] space-y-3">
        <Breadcrumbs items={[{ label: 'Tutor dashboard' }]} />

        {/* 1. Name card. */}
        <TutorHeaderCard
          name={session?.profile?.full_name ?? 'Your profile'}
          avatarUrl={session?.profile?.avatar_url ?? null}
          city={city}
          verified={ent.verified}
          planName={ent.planName}
          planExpiresAt={ent.expiresAt}
          pausedPlanName={ent.pausedPlanName}
          completion={percent}
          nextStepLabel={todo[0]?.label ?? null}
          nextStepHref={todo[0]?.href ?? '/tutor/complete-profile'}
          settingsHref="/tutor/dashboard/settings"
          publicHref={publicHref}
        />

        {/* 2. What to do next. */}
        <WhatToDoNextCard items={todo} />

        {/* 3. Count tiles, two to a row. */}
        <CountGrid tiles={tiles} />

        {/* 4. Tuitions for you. */}
        <TuitionsForYouCard jobs={weekJobs} canApply={ent.verified} />

        {/* 5. Who looked at you. */}
        <div id="who-looked" className="scroll-mt-3">
          <ViewsCard summary={views} identityGranted={ent.canSeeViewerIdentity} listed={directoryListed} />
        </div>

        {/* 6. Your CV. */}
        <CvCard canDownload={canDownloadCv(ent)} />

        {/* 7. Recent activity (last 5, news included). */}
        <RecentActivityCard items={activity} unreadMessages={unread} />

        {/* Saved tuitions (the count tile above links here). */}
        <div id="saved-tuitions" className="scroll-mt-3">
          <SavedJobsSection initial={savedJobs} viewerCity={city} appliedIds={appliedJobIds} />
        </div>

        {/* 8. Notes. */}
        <NotesCard />

        {/* House / promo creatives only — a card, not loose text. */}
        <AdSlot slot="tutor-dashboard" audience="tutors" viewerRole="tutor" viewerPlan={ent.plan} />
      </div>
    </main>
  )
}
