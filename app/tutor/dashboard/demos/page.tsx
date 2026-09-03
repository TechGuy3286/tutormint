import Breadcrumbs from '@/components/Breadcrumbs'

import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

import DemoInbox, { type DemoRow } from '@/app/parent/dashboard/DemoInbox'

// Demo requests from parents, moved off the tutor dashboard for the same
// reason as the parent side: it is an interactive queue, not a summary.

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Demo requests | TutorMint',
  robots: { index: false, follow: false },
}

export default async function TutorDemosPage() {
  const session = await getSessionUser()
  const userId = session!.user.id
  const supabase = await createClient()

  const { data: demos } = await supabase
    .from('demo_requests')
    .select('id, parent_id, status, mode, proposed_time, decline_reason, created_at')
    .eq('tutor_id', userId)
    .order('created_at', { ascending: false })

  // Only the parent's FIRST name crosses over, through the service-role client
  // because `profiles` is self-read only. Contact details never do.
  const names = new Map<string, string>()
  const ids = Array.from(new Set((demos ?? []).map((d) => d.parent_id as string)))
  if (ids.length > 0) {
    const admin = createAdminClient()
    if (admin) {
      const { data: people } = await admin.from('profiles').select('id, full_name').in('id', ids)
      for (const p of people ?? []) {
        names.set(p.id as string, ((p.full_name as string) ?? 'A parent').split(' ')[0])
      }
    }
  }

  const rows: DemoRow[] = (demos ?? []).map((d) => ({
    id: d.id as string,
    tutorId: userId,
    tutorName: '',
    tutorSlug: null,
    parentName: names.get(d.parent_id as string) ?? 'A parent',
    status: d.status as DemoRow['status'],
    mode: (d.mode as string) ?? null,
    proposedTime: (d.proposed_time as string) ?? null,
    declineReason: (d.decline_reason as string) ?? null,
    createdAt: d.created_at as string,
  }))

  return (
    <main className="min-h-screen bg-tm-bg px-4 py-6 text-slate-700 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Breadcrumbs
          items={[
            { label: 'Tutor dashboard', href: '/tutor/dashboard' },
            { label: 'Demo requests' },
          ]}
        />
        <header className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Demo requests</h1>
          <p className="text-xs text-gray-500">
            Accept with a time that suits you. The demo itself happens off the platform.
          </p>
        </header>

        <DemoInbox role="tutor" demos={rows} />
      </div>
    </main>
  )
}
