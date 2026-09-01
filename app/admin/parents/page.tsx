import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import ParentVerificationClient, { type QueueParent } from './ParentVerificationClient'

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

  let query = admin
    .from('profiles')
    .select(
      'id, full_name, email, city, address, cnic_number, phone_number, phone_verified_at, verification_state, verification_submitted_at, cnic_verified_at, address_verified_at, profile_completion',
    )
    .in('role', ['parent', 'academy'])
    .order('verification_submitted_at', { ascending: true, nullsFirst: false })
    .limit(100)

  if (filter === 'submitted') query = query.eq('verification_state', 'submitted')
  else if (filter === 'approved') query = query.eq('verification_state', 'approved')

  const { data: parents } = await query
  const ids = (parents ?? []).map((p) => p.id)

  const { data: docs } = await admin
    .from('user_documents')
    .select('id, user_id, kind')
    .eq('kind', 'cnic')
    .in('user_id', ids.length ? ids : ['-'])

  const rows: QueueParent[] = (parents ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    email: p.email,
    city: p.city,
    address: p.address,
    cnicNumber: p.cnic_number,
    phone: p.phone_number,
    phoneVerified: Boolean(p.phone_verified_at),
    state: p.verification_state ?? 'none',
    submittedAt: p.verification_submitted_at,
    completion: p.profile_completion ?? 0,
    cnicDocumentId: docs?.find((d) => d.user_id === p.id)?.id ?? null,
  }))

  return <ParentVerificationClient parents={rows} filter={filter} />
}
