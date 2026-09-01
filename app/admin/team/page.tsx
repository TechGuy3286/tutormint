import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import TeamClient, { type StaffRow } from './TeamClient'

// Staff management. Owner only.
//
// SCREEN_ACCESS.team is [] and roleSatisfies() always admits the owner, so a
// manager -- who can reach every other admin screen -- is redirected to /admin
// here, and gets 403 from the route behind it.

export const dynamic = 'force-dynamic'

export default async function AdminTeamPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.team)

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-[#d60008]">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so staff cannot be managed.
      </p>
    )
  }

  const { data: staff } = await admin
    .from('profiles')
    .select(
      'id, full_name, email, admin_role, is_suspended, suspension_reason, must_change_password, created_at',
    )
    .eq('role', 'admin')
    .not('admin_role', 'is', null)
    .order('admin_role')

  const rows: StaffRow[] = (staff ?? []).map((s) => ({
    id: s.id as string,
    name: (s.full_name as string) ?? '—',
    email: (s.email as string) ?? '—',
    adminRole: s.admin_role as StaffRow['adminRole'],
    suspended: !!s.is_suspended,
    suspensionReason: (s.suspension_reason as string) ?? null,
    mustChangePassword: !!s.must_change_password,
    createdAt: s.created_at as string,
    isMe: (s.id as string) === actor.id,
  }))

  return <TeamClient staff={rows} />
}
