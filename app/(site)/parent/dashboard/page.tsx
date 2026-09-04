import Breadcrumbs from '@/components/Breadcrumbs'
import Link from 'next/link'
import { Plus } from 'lucide-react'

import AdSlot from '@/components/ads/AdSlot'
import ActivityBand from '@/components/dashboard/ActivityBand'
import IdentityBlock from '@/components/dashboard/IdentityBlock'
import NeedsYou from '@/components/dashboard/NeedsYou'
import YourThings, { type ThingRow } from '@/components/dashboard/YourThings'
import IdentityCard from '@/components/identity/IdentityCard'
import { getSessionUser } from '@/lib/auth'
import { loadIdentity } from '@/lib/identity'
import { recentActivity } from '@/lib/dashboardFeed'
import { getEntitlements } from '@/lib/entitlements'
import { unreadMessageCount } from '@/lib/messaging'
import { parentNeeds } from '@/lib/needsYou'
import { createClient } from '@/lib/supabase/server'

// The parent dashboard, in three bands.
//
//   1. NEEDS YOU   what is blocked on this parent, one line and one action each
//   2. ACTIVITY    real events, newest first, each linking to its subject
//   3. YOUR THINGS counts that link out -- the lists live on their own pages
//
// WHAT THIS REPLACED, and why the shape was the problem. Everything used to be
// a white rounded card with a bold heading: the verification block that stops
// you posting, the plan card, the children editor, all nine tuitions rendered
// in full, the demo inbox, and two full-width outlined buttons at the bottom
// reading "Messages" and "Browse tutors". 2,428px on a laptop, and no way to
// tell at a glance which of it needed doing. The nine tuitions alone were
// 600px of content the parent had already seen.
//
// The lists did not disappear -- they moved to /jobs, /demos and /children,
// which is where a list belongs. What is here is the count, so the question
// "is there anything new" is answered without scrolling.

export const dynamic = 'force-dynamic'

export default async function ParentDashboardPage() {
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const [{ data: profile }, ent] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'full_name, avatar_url, city, verification_state, cnic_verified_at, address_verified_at, profile_completion',
      )
      .eq('id', userId)
      .maybeSingle(),
    getEntitlements(userId),
  ])

  const verified = !!profile?.cnic_verified_at && !!profile?.address_verified_at

  const [
    needs,
    activity,
    identity,
    { data: jobs },
    unreadMessages,
    { data: demos },
    { data: children },
  ] = await Promise.all([
      parentNeeds({
        userId,
        ent,
        cnicVerified: !!profile?.cnic_verified_at,
        addressVerified: !!profile?.address_verified_at,
        verificationState: (profile?.verification_state as string) ?? null,
      }),
      recentActivity({ userId, role: 'parent', limit: 8 }),
      loadIdentity(userId),
      supabase.from('jobs').select('id, status, hired_tutor_id').eq('parent_id', userId),
      unreadMessageCount(userId),
      supabase.from('demo_requests').select('id, status').eq('parent_id', userId),
      supabase.from('children').select('id').eq('parent_id', userId),
    ])

  const allJobs = jobs ?? []
  const openJobs = allJobs.filter((j) => j.status === 'open')
  const hired = new Set(
    allJobs.map((j) => j.hired_tutor_id as string | null).filter((x): x is string => !!x),
  )

  // Applicants across the parent's own jobs. Readable with the member's own
  // client -- applications are visible to the job's parent.
  let applicants = 0
  if (openJobs.length > 0) {
    const { count } = await supabase
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .in(
        'job_id',
        openJobs.map((j) => j.id as string),
      )
      .is('withdrawn_at', null)
    applicants = count ?? 0
  }

  // Real rows, not a hard-coded false. See unreadMessageCount().
  const unread = unreadMessages
  const liveDemos = (demos ?? []).filter((d) =>
    ['requested', 'accepted'].includes(d.status as string),
  ).length

  const completion = (profile?.profile_completion as number | null) ?? 0
  // "Verified parent - Karachi". The city is dropped rather than written as
  // "unknown": a member who has not told us where they are does not need to be
  // reminded of it on their own dashboard every visit.
  const identityLine = [
    verified ? 'Verified parent' : 'Parent',
    (profile?.city as string | null) || null,
  ]
    .filter(Boolean)
    .join(' · ')

  const things: ThingRow[] = [
    {
      key: 'jobs',
      label: 'My tuitions',
      count: openJobs.length,
      note: 'open',
      href: '/parent/dashboard/jobs',
      icon: 'jobs',
    },
    {
      key: 'applicants',
      label: 'Applicants',
      count: applicants,
      note: applicants > 0 ? 'total' : undefined,
      href: '/parent/dashboard/jobs',
      icon: 'applications',
    },
    {
      key: 'messages',
      label: 'Messages',
      count: unread,
      note: 'unread',
      href: '/parent/dashboard/messages',
      icon: 'messages',
      highlight: unread > 0,
    },
    {
      key: 'hired',
      label: 'Hired tutors',
      count: hired.size,
      href: '/parent/dashboard/hired-tutors',
      icon: 'hired',
    },
    {
      key: 'demos',
      label: 'Demo classes',
      count: liveDemos,
      note: liveDemos > 0 ? 'live' : undefined,
      href: '/parent/dashboard/demos',
      icon: 'demos',
    },
    {
      key: 'children',
      label: 'My children',
      count: (children ?? []).length,
      href: '/parent/dashboard/children',
      icon: 'children',
    },
    {
      key: 'plan',
      label: ent.planName ? `${ent.planName} plan` : 'No plan yet',
      count: ent.plan ? ent.quotaLeft : null,
      note: ent.plan ? 'posts left' : undefined,
      href: '/parent/packages',
      icon: 'plan',
    },
  ]

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <Breadcrumbs items={[{ label: 'Parent dashboard' }]} />

        {/* Who this is, from the outside. The same component the tutor
            dashboard uses -- see IdentityBlock for why one and not two. */}
        <IdentityBlock
          name={profile?.full_name ?? 'Your account'}
          avatarUrl={(profile?.avatar_url as string | null) ?? null}
          badges={ent.badges}
          line={identityLine}
          completion={completion}
          completionHref="/parent/verify"
          editHref={{ label: 'Edit your details', href: '/parent/dashboard/settings' }}
        />

        {/* The one primary ACTION on this page. It creates something, so it is
            a button. Messages, Browse tutors and Packages went to the menu --
            those go somewhere, and navigation dressed as a button is what made
            this page read like a form. */}
        {verified && (
          <Link
            href="/parent/dashboard/post-job"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-red px-4 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover"
          >
            <Plus aria-hidden size={14} />
            Post a job
          </Link>
        )}

        <IdentityCard identity={identity} role="parent" />

        <NeedsYou
          rows={needs}
          emptyHint={
            openJobs.length > 0
              ? 'Your tuitions are live and tutors can apply to them.'
              : 'Post a tuition when you are ready and tutors will apply.'
          }
        />

        <ActivityBand
          items={activity}
          inboxHref="/parent/dashboard/messages"
          emptyHint="Nothing has happened yet. Applications, replies and demo answers will appear here as they arrive."
        />

        <YourThings rows={things} />

        {/* The parent dashboard slot from the revenue spec. One per page. */}
        <AdSlot slot="parent-sidebar" audience="parents" viewerRole="parent" />
      </div>
    </main>
  )
}
