import Breadcrumbs from '@/components/Breadcrumbs'

import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reviewableEngagements } from '@/lib/reviews'

import DemoInbox, { type DemoRow } from '../DemoInbox'

// Demo requests, moved off the dashboard.
//
// DemoInbox is interactive -- accept, decline, cancel, leave feedback -- so it
// is a screen in its own right, not a summary. The dashboard shows how many
// are outstanding and links here.

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Demo classes | TutorMint',
  robots: { index: false, follow: false },
}

export default async function ParentDemosPage() {
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const { data: demos } = await supabase
    .from('demo_requests')
    .select('id, tutor_id, status, mode, proposed_time, decline_reason, created_at')
    .eq('parent_id', userId)
    .order('created_at', { ascending: false })

  // Tutor names need the service-role client: `profiles` is self-read only, so
  // a parent cannot read the name of a tutor they asked for a demo.
  const names = new Map<string, { name: string; slug: string | null }>()
  const ids = Array.from(new Set((demos ?? []).map((d) => d.tutor_id as string)))
  if (ids.length > 0) {
    const admin = createAdminClient()
    if (admin) {
      const { data: tutors } = await admin
        .from('tutor_profiles')
        .select('id, full_name, slug')
        .in('id', ids)
      for (const t of tutors ?? []) {
        names.set(t.id as string, {
          name: (t.full_name as string) ?? 'Tutor',
          slug: (t.slug as string) ?? null,
        })
      }
    }
  }

  const reviewable = await reviewableEngagements(userId)

  const rows: DemoRow[] = (demos ?? []).map((d) => ({
    id: d.id as string,
    tutorId: d.tutor_id as string,
    tutorName: names.get(d.tutor_id as string)?.name ?? 'Tutor',
    tutorSlug: names.get(d.tutor_id as string)?.slug ?? null,
    status: d.status as DemoRow['status'],
    mode: (d.mode as string) ?? null,
    proposedTime: (d.proposed_time as string) ?? null,
    declineReason: (d.decline_reason as string) ?? null,
    createdAt: d.created_at as string,
    reviewed: reviewable.reviewedDemoIds.has(d.id as string),
  }))

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs
          items={[
            { label: 'Parent dashboard', href: '/parent/dashboard' },
            { label: 'Demo classes' },
          ]}
        />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Demo classes</h1>
          <p className="text-xs text-gray-500">
            One free demo per tutor. You agree the time with them directly.
          </p>
        </header>

        <DemoInbox role="parent" demos={rows} />
      </div>
    </main>
  )
}
