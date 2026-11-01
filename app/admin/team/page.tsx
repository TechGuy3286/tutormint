import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import TeamClient, { type StaffRow, type FormerStaffRow } from './TeamClient'
import { formatName } from '@/lib/formatName'
import { loadTenureFacts } from '@/lib/staffTenure'
import { tenureView } from '@/lib/staffTenureCore'
import { ROLE_LABEL } from '@/lib/adminAuth'

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

  // Whether each staff member has two-factor set up (a verified authenticator),
  // so the owner can see at a glance who is protected (PR50 §2). Small list.
  const twoFactorOn = new Set<string>()
  await Promise.all(
    (staff ?? []).map(async (s) => {
      const { data } = await admin.auth.admin.mfa.listFactors({ userId: s.id as string })
      if ((data?.factors ?? []).some((f) => f.status === 'verified' && f.factor_type === 'totp')) {
        twoFactorOn.add(s.id as string)
      }
    }),
  )

  // Joining dates (owner, 2 Nov 2026, Part G) — current and former staff.
  const { data: former } = await admin
    .from('profiles')
    .select('id, full_name, former_staff_at, former_staff_role')
    .not('former_staff_at', 'is', null)
    .order('former_staff_at', { ascending: false })
  const tenure = await loadTenureFacts(admin, [...(staff ?? []), ...(former ?? [])].map((s) => s.id as string))
  const viewOf = (id: string, role: string | null, formerAt: string | null) =>
    tenureView({
      stored: tenure.stored.get(id) ?? null,
      audit: tenure.audit.get(id) ?? [],
      adminRole: role,
      roleLabel: role ? (ROLE_LABEL as Record<string, string>)[role] ?? role : null,
      formerAt,
    })
  const formerRows: FormerStaffRow[] = (former ?? []).map((f) => ({
    id: f.id as string,
    name: formatName(f.full_name as string | null) || '—',
    roleLabel: (ROLE_LABEL as Record<string, string>)[(f.former_staff_role as string) ?? ''] ?? null,
    tenure: viewOf(f.id as string, null, f.former_staff_at as string),
  }))

  const rows: StaffRow[] = (staff ?? []).map((s) => ({
    id: s.id as string,
    name: formatName(s.full_name as string | null) || '—',
    email: (s.email as string) ?? '—',
    adminRole: s.admin_role as StaffRow['adminRole'],
    suspended: !!s.is_suspended,
    suspensionReason: (s.suspension_reason as string) ?? null,
    mustChangePassword: !!s.must_change_password,
    hasSignedIn: signedIn.has(s.id as string),
    twoFactorOn: twoFactorOn.has(s.id as string),
    createdAt: s.created_at as string,
    isMe: (s.id as string) === actor.id,
    tenure: viewOf(s.id as string, s.admin_role as string, null),
  }))

  return <TeamClient staff={rows} former={formerRows} viewerRole={actor.adminRole} />
}
