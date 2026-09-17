import { redirect } from 'next/navigation'
import { Send, MessageSquare, Video, Briefcase, Eye, Heart } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import CvCard from '@/components/tutor/CvCard'
import SavedJobsSection from '@/components/tutor/SavedJobsSection'
import TutorHeaderCard from '@/components/tutor/TutorHeaderCard'
import { CountGrid, type CountTile } from '@/components/tutor/DashboardCards'

import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { computeCompletion } from '@/lib/completion'
import { getEntitlements } from '@/lib/entitlements'
import { jobsThisWeek } from '@/lib/funnel'
import { savedJobsForTutor } from '@/lib/jobFeed'
import { unreadMessageCount } from '@/lib/messaging'
import { loadDirectoryStatus } from '@/lib/directoryStatus'
import { viewSummary } from '@/lib/profileViews'
import { canDownloadCv } from '@/lib/cv/access'
import { needsOnboarding } from '@/lib/onboardingGate'

// The tutor dashboard — one profile card and a few (PR19).
//
// One phone layout at every width: a single narrow centred column (~480px). The
// profile card at the top holds everything about the tutor (badges, verify,
// completion, profile views, links). Below it: count tiles, the matching tuitions,
// the CV, and the saved-tuitions list. Nothing else, no loose text. Bottom padding
// keeps the floating WhatsApp button off the cards.

export const dynamic = 'force-dynamic'

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

  const [views, weekJobs, unread, { data: apps }, { data: demos }, savedJobs] = await Promise.all([
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

  const tiles: CountTile[] = [
    { key: 'apps', icon: <Send aria-hidden size={22} />, value: liveApps.length, label: 'My applications', href: '/tutor/dashboard/applications', tone: 'green' },
    { key: 'messages', icon: <MessageSquare aria-hidden size={22} />, value: unread, label: 'Messages', href: '/tutor/dashboard/messages', tone: 'navy', highlight: unread > 0 },
    { key: 'demos', icon: <Video aria-hidden size={22} />, value: liveDemos, label: 'Demo requests', href: '/tutor/dashboard/demos', tone: 'red', highlight: liveDemos > 0 },
    { key: 'tuitions', icon: <Briefcase aria-hidden size={22} />, value: weekJobs.length, label: 'Tuitions for you', href: '/tutor/dashboard/jobs', tone: 'gold' },
    { key: 'views', icon: <Eye aria-hidden size={22} />, value: views.total, label: 'Profile views', href: '/tutor/dashboard/views', tone: 'mint' },
    { key: 'saved', icon: <Heart aria-hidden size={22} />, value: savedJobs.length, label: 'Saved tuitions', href: '#saved-tuitions', tone: 'mint' },
  ]

  return (
    <main className="min-h-screen bg-tm-bg px-4 pt-3 pb-8">
      <div className="mx-auto w-full max-w-[480px] space-y-3">
        <Breadcrumbs items={[{ label: 'Tutor dashboard' }]} />

        {/* 3.1 Profile card — minimal. */}
        <TutorHeaderCard
          name={session?.profile?.full_name ?? 'Your profile'}
          avatarUrl={session?.profile?.avatar_url ?? null}
          city={city}
          verified={ent.verified}
          planName={ent.planName}
          completion={percent}
          publicHref={publicHref}
        />

        {/* 3.2 Count tiles, two to a row. */}
        <CountGrid tiles={tiles} />

        {/* 3.3 Your CV. */}
        <CvCard canDownload={canDownloadCv(ent)} />

        {/* 3.4 Saved tuitions (hidden when empty; the count tile links here). */}
        <div id="saved-tuitions" className="scroll-mt-3">
          <SavedJobsSection initial={savedJobs} viewerCity={city} appliedIds={appliedJobIds} />
        </div>
      </div>
    </main>
  )
}
