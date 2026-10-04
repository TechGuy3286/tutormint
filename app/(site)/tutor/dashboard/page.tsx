import { redirect } from 'next/navigation'
import { Send, MessageSquare, Video, Briefcase, Eye, Heart, Search, Clapperboard } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import CvCard from '@/components/tutor/CvCard'
import SavedJobsSection from '@/components/tutor/SavedJobsSection'
import TutorHeaderCard from '@/components/tutor/TutorHeaderCard'
import CompletePaymentPrompt from '@/components/tutor/CompletePaymentPrompt'
import GetVerifiedValueCard from '@/components/tutor/GetVerifiedValueCard'
import { quotaCounter } from '@/lib/tutorDashboard'
import Link from 'next/link'
import DashboardActionBar from '@/components/dashboard/DashboardActionBar'
import { CountGrid, type CountTile } from '@/components/tutor/DashboardCards'

import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { computeCompletion } from '@/lib/completion'
import { getEntitlements } from '@/lib/entitlements'
import { savedJobsForTutor, resolveTutorScope, tutorFeedCount, feedGenderFilter, browseJobs, NO_JOB_FILTERS } from '@/lib/jobFeed'
import { unreadMessageCount, conversationCount } from '@/lib/messaging'
import { loadDirectoryStatus } from '@/lib/directoryStatus'
import { viewSummary } from '@/lib/profileViews'
import { canDownloadCv } from '@/lib/cv/access'
import { needsOnboarding } from '@/lib/onboardingGate'
import { pendingPayproInvoice } from '@/lib/payments/pendingInvoice'
import { getOnboardingMode } from '@/lib/onboardingModeServer'
import { showNewOnboarding } from '@/lib/onboardingMode'

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
    supabase.from('tutor_profiles').select('slug, city').eq('id', userId).maybeSingle(),
    computeCompletion(userId),
    getEntitlements(userId),
    loadDirectoryStatus(userId),
  ])

  const directoryListed = directory.listed
  const city = (tutorProfile?.city as string | null) ?? null

  // PR106-G4b §5/§6: for owner/staff (switch "Staff only") an unverified tutor
  // sees the value-first "Get verified" card (real tuition count, straight to
  // PayPro). Everyone else keeps today's red "Complete your payment" prompt — an
  // unfinished PayPro invoice (started, unpaid, still within 24h). Both are
  // hidden once the fee is paid (ent.verified).
  const staffNew = showNewOnboarding(await getOnboardingMode(), !!session?.profile?.admin_role)
  const showValueCard = staffNew && !ent.verified
  const pendingInvoice = !staffNew && !ent.verified ? await pendingPayproInvoice(userId) : null

  // PR71: the tutor's own city+areas scope drives both the "Tuitions for you"
  // tile and the action-bar count, so both agree with what /browse/tuitions
  // shows a signed-in tutor. No city/areas yet → the whole open board.
  const tutorScope = await resolveTutorScope(supabase, userId)
  const viewerGender = feedGenderFilter(tutorScope?.gender)

  const [views, unread, conversations, { data: apps }, { data: demos }, savedJobs, boardCount] =
    await Promise.all([
      viewSummary(userId, ent.canSeeViewerIdentity, 20),
      unreadMessageCount(userId),
      conversationCount(userId),
      supabase.from('applications').select('id, job_id, withdrawn_at').eq('tutor_id', userId),
      supabase.from('demo_requests').select('id, status').eq('tutor_id', userId),
      savedJobsForTutor(userId),
      // PR85: the count is the feed's first non-empty fallback level, gender-filtered.
      tutorScope
        ? tutorFeedCount(supabase, tutorScope, viewerGender)
        : browseJobs({ ...NO_JOB_FILTERS, viewerGender }, 1).then((r) => r.total),
    ])

  const liveApps = (apps ?? []).filter((a) => !a.withdrawn_at)
  const appliedJobIds = liveApps.map((a) => a.job_id as string)
  const liveDemos = (demos ?? []).filter((d) => ['requested', 'accepted'].includes(d.status as string)).length

  const percent = completion?.percent ?? session?.profile?.profile_completion ?? 0
  const publicHref = directoryListed && tutorProfile?.slug ? `/tutor/${tutorProfile.slug}` : null

  // "Find tuitions to apply for" bar (PR42 §2, PR71 §2). The count uses the same
  // city+areas default as /browse/tuitions, so the number here matches the list
  // the link opens (bare /browse/tuitions applies the tutor's default). A tutor
  // with no city/areas gets a prompt to add their area rather than a figure.
  const findTuitionsLine =
    tutorScope && boardCount > 0
      ? `${boardCount} tuition${boardCount === 1 ? '' : 's'} in your areas`
      : tutorScope
        ? 'No tuitions in your areas yet — new ones are posted daily'
        : 'Add your area in Settings to see tuitions near you'
  const findTuitionsLineUr =
    tutorScope && boardCount > 0
      ? 'آپ کے علاقوں میں ٹیوشنز'
      : tutorScope
        ? 'ابھی آپ کے علاقوں میں کوئی ٹیوشن نہیں — روزانہ نئی ٹیوشنز آتی ہیں'
        : 'اپنے قریب ٹیوشنز دیکھنے کے لیے سیٹنگز میں اپنا علاقہ شامل کریں'
  const findTuitionsHref = '/browse/tuitions'

  // The shared-pool applications quota (PR106-D §9): shown on the My-applications
  // tile. Basic "x of 10", Premium "x of 100", Featured "Unlimited" (never a
  // number). Only a tutor who is on a plan (fee paid) sees a count.
  const q = quotaCounter({ plan: ent.plan, used: ent.quotaUsed, quota: ent.quota })
  const quotaNote = ent.plan ? `${q.text.replace(' used this month', ' this month')}` : null
  const findable = percent >= 100 && ent.verified && ent.badges.includes('Verified')

  // Seven tiles, seven distinct tones — no two share a colour (PR32 §2). The
  // seventh is the optional Intro video tile (PR76 §D.3), its own mint tint.
  const tiles: CountTile[] = [
    { key: 'apps', icon: <Send aria-hidden size={22} />, value: liveApps.length, label: 'My applications', note: quotaNote, href: '/tutor/dashboard/applications', tone: 'sky', tip: 'Tuitions you have applied to' },
    // The number is the tutor's CONVERSATIONS (four conversations → 4); unread
    // is the small badge, never the main number (PR44 §2).
    { key: 'messages', icon: <MessageSquare aria-hidden size={22} />, value: conversations, label: 'Messages', href: '/tutor/dashboard/messages', tone: 'navy', badge: unread, tip: 'Your conversations with parents' },
    { key: 'demos', icon: <Video aria-hidden size={22} />, value: liveDemos, label: 'Demo requests', href: '/tutor/dashboard/demos', tone: 'red', highlight: liveDemos > 0, tip: 'Demo lessons parents have asked you for' },
    { key: 'tuitions', icon: <Briefcase aria-hidden size={22} />, value: boardCount, label: 'Tuitions for you', href: '/browse/tuitions', tone: 'gold', tip: tutorScope ? 'Open tuitions in your city and areas' : 'Open tuitions — add your area in Settings to narrow this' },
    { key: 'views', icon: <Eye aria-hidden size={22} />, value: views.thisWeek, label: 'Profile views', note: 'this week', href: '/tutor/dashboard/views', tone: 'teal', tip: 'Parents who viewed your profile this week' },
    { key: 'saved', icon: <Heart aria-hidden size={22} />, value: savedJobs.length, label: 'Saved tuitions', href: '#saved-tuitions', tone: 'violet', tip: 'Tuitions you saved to look at later' },
    // Optional, no pressure — a label-only action tile opening the existing
    // upload flow. It is not a completion item (§C.6).
    { key: 'video', icon: <Clapperboard aria-hidden size={22} />, label: 'Intro video', href: '/tutor/dashboard/video', tone: 'pink', tip: 'Optional — a short hello for parents' },
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
          badges={ent.badges}
          verificationPending={!!ent.verificationPending}
          findable={findable}
          completion={percent}
          publicHref={publicHref}
        />

        {/* PR106-G4b §5: value-first card for owner/staff; §6: everyone else keeps
            today's "Complete your payment" prompt. Both are hidden once the fee
            is paid (ent.verified). */}
        {showValueCard && <GetVerifiedValueCard count={boardCount} city={city} />}
        {pendingInvoice && <CompletePaymentPrompt url={pendingInvoice.url} />}

        {/* PR106-H3: fee paid, documents under review — one clear line in place of
            every "Get verified" prompt (which are gone once ent.verified). */}
        {ent.verified && ent.verificationPending && (
          <div className="rounded-2xl border border-tm-green-deep/25 bg-tm-tint-green/60 px-4 py-3 text-center">
            <p className="text-sm font-black text-tm-green-deep">✓ Payment received. Our team is reviewing your documents.</p>
            <p lang="ur" dir="rtl" className="mt-0.5 text-[11px] font-semibold text-tm-green-deep/80">
              ادائیگی موصول ہو گئی۔ ہماری ٹیم آپ کی دستاویزات کا جائزہ لے رہی ہے۔
            </p>
          </div>
        )}

        {/* Action bar — the main thing a tutor comes back to do (PR42 §2). */}
        <DashboardActionBar
          href={findTuitionsHref}
          label="Find tuitions to apply for"
          line={findTuitionsLine}
          lineUr={findTuitionsLineUr}
          tone="green"
          icon={<Search aria-hidden size={20} />}
        />

        {/* PR106-D §8: the "Your verification fee" card is removed — its content
            is now the pop-up behind the dashboard badge. §9: the applications
            quota moved onto the My-applications tile below. */}

        {/* 3.2 Count tiles, two to a row. */}
        <CountGrid tiles={tiles} />

        {/* PR106-D §9: "Get more applications" at ~80% used (Basic/Premium only). */}
        {q.showGetMore && (
          <Link
            href="/membership-plans?for=tutors"
            className="block text-center text-[11px] font-bold text-tm-navy underline-offset-2 hover:underline"
          >
            Get more applications
            <span lang="ur" dir="rtl" className="ms-1.5 font-semibold text-gray-500">مزید درخواستیں حاصل کریں</span>
          </Link>
        )}

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
