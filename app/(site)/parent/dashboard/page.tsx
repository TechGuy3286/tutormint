import Link from 'next/link'
import { ArrowRight, Briefcase, FilePlus2, Heart, MessageSquare, Search, UserCheck, Users, Video } from 'lucide-react'

import Breadcrumbs from '@/components/Breadcrumbs'
import ParentHeaderCard from '@/components/parent/ParentHeaderCard'
import ChildrenCard, { type ChildRow } from '@/components/parent/ChildrenCard'
import ShortlistSection from '@/components/parent/ShortlistSection'
import DashboardActionBar from '@/components/dashboard/DashboardActionBar'
import { CountGrid, type CountTile } from '@/components/tutor/DashboardCards'
import { type CardViewer } from '@/components/TutorCard'

import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import { unreadMessageCount, conversationCount } from '@/lib/messaging'
import { tutorCardsByIds, listedTutorsInCity } from '@/lib/browseTutors'

// The parent dashboard — the SAME shape as the tutor dashboard (PR24): one
// narrow centred column (~480px) at every width, phone-first, no desktop grid.
//
//   1. profile card (photo, name, city, status badge, Get verified, public card)
//   2. count tiles, two to a row
//   3. Post a tuition (when verified), My children (hidden when empty),
//      Shortlisted tutors (hidden when empty)
//
// Nothing else — no "Needs you", no identity-status card, no activity band, no
// "Your things" heading, no ad slot, no loose text. The lists live on their own
// pages (/jobs, /demos, /children, /hired-tutors) and the tiles link out.

export const dynamic = 'force-dynamic'

export default async function ParentDashboardPage() {
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const [{ data: profile }, ent] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, avatar_url, city, cnic_verified_at, address_verified_at')
      .eq('id', userId)
      .maybeSingle(),
    getEntitlements(userId),
  ])

  const verified = !!profile?.cnic_verified_at && !!profile?.address_verified_at
  const featured = ent.plan === 'parent_featured'
  const city = (profile?.city as string | null) ?? null

  const [{ data: jobs }, unread, conversations, { data: demos }, { data: children }, { data: shortlisted }, tutorCount] =
    await Promise.all([
      supabase.from('jobs').select('id, status, hired_tutor_id').eq('parent_id', userId),
      unreadMessageCount(userId),
      conversationCount(userId),
      supabase.from('demo_requests').select('id, status').eq('parent_id', userId),
      supabase.from('children').select('id, name, class_level').eq('parent_id', userId).order('created_at'),
      supabase.from('shortlists').select('tutor_id, created_at').order('created_at', { ascending: false }),
      listedTutorsInCity(city),
    ])

  const allJobs = jobs ?? []
  const openJobs = allJobs.filter((j) => j.status === 'open')
  const hired = new Set(
    allJobs.map((j) => j.hired_tutor_id as string | null).filter((x): x is string => !!x),
  )

  // Applicants across the parent's own OPEN tuitions (their own client can read
  // applications to their jobs).
  let applicants = 0
  if (openJobs.length > 0) {
    const { count } = await supabase
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .in('job_id', openJobs.map((j) => j.id as string))
      .is('withdrawn_at', null)
    applicants = count ?? 0
  }

  const liveDemos = (demos ?? []).filter((d) =>
    ['requested', 'accepted'].includes(d.status as string),
  ).length

  // Shortlisted tutor cards, in shortlist order. Reads the listing view, so any
  // that have since unlisted or been suspended drop out.
  const shortlistIds = (shortlisted ?? []).map((s) => s.tutor_id as string)
  const shortlistCards = await tutorCardsByIds(shortlistIds)
  const shortlistOrder = new Map(shortlistIds.map((id, i) => [id, i]))
  shortlistCards.sort((a, b) => (shortlistOrder.get(a.id) ?? 0) - (shortlistOrder.get(b.id) ?? 0))
  const shortlistViewer: CardViewer = {
    signedIn: true,
    role: ent.role,
    verifiedParent: ent.audience === 'parent' && !!ent.plan,
    canInitiateMessage: ent.canInitiateMessage,
  }

  const childRows: ChildRow[] = (children ?? []).map((c) => ({
    id: c.id as string,
    name: (c.name as string | null) ?? null,
    classLevel: (c.class_level as string | null) ?? null,
  }))

  // "Find tutors for your child" bar (PR42 §3): a real, positive, city-scoped
  // count of listed tutors, otherwise the plain line — never a zero. The link
  // opens the tutors list filtered to the parent's city when known.
  const findTutorsLine =
    tutorCount > 0 && city
      ? `${tutorCount} verified tutor${tutorCount === 1 ? '' : 's'} in ${city}`
      : 'Verified tutors in your city and subject'
  const findTutorsHref = city ? `/browse/tutors?city=${encodeURIComponent(city)}` : '/browse/tutors'

  // Six tiles, six distinct tones — no two share a colour (PR32 §2).
  const tiles: CountTile[] = [
    // "Posted tuitions" counts every tuition she has posted — open, closed and
    // hired (PR25 §6) — not just the open ones, which read 0 for a parent whose
    // tuitions have all been filled or closed.
    { key: 'tuitions', icon: <Briefcase aria-hidden size={22} />, value: allJobs.length, label: 'Posted tuitions', href: '/parent/dashboard/jobs', tone: 'green', tip: 'Every tuition you have posted' },
    { key: 'applicants', icon: <Users aria-hidden size={22} />, value: applicants, label: 'Interested tutors', href: '/parent/dashboard/jobs', tone: 'teal', tip: 'Tutors interested in your open tuitions' },
    // The number is the parent's CONVERSATIONS; unread is the small badge, never
    // the main number (PR44 §2). Mirrors the tutor dashboard exactly.
    { key: 'messages', icon: <MessageSquare aria-hidden size={22} />, value: conversations, label: 'Messages', href: '/parent/dashboard/messages', tone: 'navy', badge: unread, tip: 'Your conversations with tutors' },
    { key: 'demos', icon: <Video aria-hidden size={22} />, value: liveDemos, label: 'Demo lessons', href: '/parent/dashboard/demos', tone: 'red', highlight: liveDemos > 0, tip: 'Demo lessons you have asked for' },
    { key: 'hired', icon: <UserCheck aria-hidden size={22} />, value: hired.size, label: 'Hired tutors', href: '/parent/dashboard/hired-tutors', tone: 'gold', tip: 'Tutors you have hired' },
    { key: 'shortlisted', icon: <Heart aria-hidden size={22} />, value: shortlistCards.length, label: 'Shortlisted tutors', href: '#shortlisted-tutors', tone: 'violet', tip: 'Tutors you saved to look at later' },
  ]

  return (
    <main className="min-h-screen bg-tm-bg px-4 pt-3 pb-8">
      <div className="mx-auto w-full max-w-[480px] space-y-3">
        <Breadcrumbs items={[{ label: 'Parent dashboard' }]} />

        {/* 1. Profile card — minimal. */}
        <ParentHeaderCard
          name={profile?.full_name ?? 'Your account'}
          avatarUrl={(profile?.avatar_url as string | null) ?? null}
          city={(profile?.city as string | null) ?? null}
          verified={verified}
          featured={featured}
          publicHref={`/parent/${userId}`}
        />

        {/* Action bar — the main thing a parent comes back to do (PR42 §3).
            Navy (parent-side), mirrored from the tutor bar so the two dashboards
            are never confusable. */}
        <DashboardActionBar
          href={findTutorsHref}
          label="Find tutors for your child"
          line={findTutorsLine}
          tone="navy"
          icon={<Search aria-hidden size={20} />}
        />

        {/* 2. Count tiles, two to a row. */}
        <CountGrid tiles={tiles} />

        {/* 3.1 Post a tuition — the one primary action, shown to EVERY parent
            (PR25 §4.3). An unverified parent who taps it lands on the
            verification step (post-job redirects there), not back here. */}
        <Link
          href="/parent/dashboard/post-job"
            className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-tm-navy"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-tm-tint-red text-tm-red">
              <FilePlus2 aria-hidden size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-tm-navy">Post a tuition</p>
              <p className="text-[11px] text-gray-500">Tell tutors what you need.</p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-tm-red">
              Post
              <ArrowRight aria-hidden size={13} />
            </span>
        </Link>

        {/* 3.2 My children — hidden when empty. */}
        {childRows.length > 0 && <ChildrenCard items={childRows} />}

        {/* 3.3 Shortlisted tutors — hidden when empty; the tile links here. */}
        {shortlistCards.length > 0 && (
          <div id="shortlisted-tutors" className="scroll-mt-3">
            <ShortlistSection initial={shortlistCards} viewer={shortlistViewer} hiredIds={[...hired]} />
          </div>
        )}
      </div>
    </main>
  )
}
