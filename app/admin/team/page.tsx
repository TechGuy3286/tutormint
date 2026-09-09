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
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
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

  // Whether each staff member has EVER signed in — lives on auth.users, not
  // profiles, and read through the Auth admin API. It is what tells an unopened
  // invite (never signed in) apart from a BROKEN one (the link was clicked and
  // consumed, but they never finished setting a password — must_change is still
  // true). Small staff list, so one page suffices.
  const signedIn = new Set<string>()
  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  for (const u of authList?.users ?? []) {
    if (u.last_sign_in_at) signedIn.add(u.id)
  }

  const rows: StaffRow[] = (staff ?? []).map((s) => ({
    id: s.id as string,
    name: (s.full_name as string) ?? '—',
    email: (s.email as string) ?? '—',
    adminRole: s.admin_role as StaffRow['adminRole'],
    suspended: !!s.is_suspended,
    suspensionReason: (s.suspension_reason as string) ?? null,
    mustChangePassword: !!s.must_change_password,
    hasSignedIn: signedIn.has(s.id as string),
    createdAt: s.created_at as string,
    isMe: (s.id as string) === actor.id,
  }))

  return <TeamClient staff={rows} />
}
