import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadParentQueue } from '@/lib/adminQueues'
import { createAdminClient } from '@/lib/supabase/admin'
import ParentVerificationClient from './ParentVerificationClient'

export const dynamic = 'force-dynamic'

export default async function AdminParentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.parents)
  const { filter = 'submitted' } = await searchParams

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="text-xs font-bold text-tm-red bg-tm-tint-red border border-tm-red/30 rounded-xl p-4">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so the queue cannot be loaded.
      </p>
    )
  }

  const { rows, nextCursor, total } = await loadParentQueue({ filter })

  return (
    <ParentVerificationClient
      parents={rows}
      filter={filter}
      initialCursor={nextCursor}
      total={total}
    />
  )
}
