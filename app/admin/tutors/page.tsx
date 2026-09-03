import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadTutorQueue } from '@/lib/adminQueues'
import { createAdminClient } from '@/lib/supabase/admin'
import TutorModerationClient from './TutorModerationClient'

// Tutor moderation queue. Server component: the gate runs before anything
// renders, and the rows are fetched with the service-role client because an
// admin needs to see tutors that RLS would otherwise hide.

export const dynamic = 'force-dynamic'

export default async function AdminTutorsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.tutors)
  const { filter = 'pending' } = await searchParams

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="text-xs font-bold text-tm-red bg-tm-tint-red border border-tm-red/30 rounded-xl p-4">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so the queue cannot be loaded.
      </p>
    )
  }

  // The first window only, with a cursor for the rest. This list used to stop
  // at a hard 100 with nothing saying so.
  const { rows, nextCursor, total } = await loadTutorQueue({ filter })

  return (
    <TutorModerationClient
      tutors={rows}
      filter={filter}
      canSetVisibility={roleSatisfies(actor.adminRole, SCREEN_ACCESS.videoVisibility)}
      initialCursor={nextCursor}
      total={total}
    />
  )
}
