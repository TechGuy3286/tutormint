import { requireAdminRole, roleSatisfies, getAdminActor, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import PlanGrantClient, { type PlanRow, type AccountRow } from './PlanGrantClient'

// Plans screen. finance may OPEN this (read-only); only owner + manager may
// mutate. canMutate below drives the UI, and /api/admin/plans re-checks the
// narrower permission independently.

export const dynamic = 'force-dynamic'

export default async function AdminPlansPage() {
  await requireAdminRole(...SCREEN_ACCESS.plans)
  const actor = await getAdminActor()
  const canMutate = actor ? roleSatisfies(actor.adminRole, SCREEN_ACCESS.plansMutate) : false

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="text-xs font-bold text-[#d60008] bg-red-50 border border-red-200 rounded-xl p-4">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  const [{ data: plans }, { data: accounts }, { data: subs }] = await Promise.all([
    admin.from('plans').select('code, name, audience, price_pkr, monthly_quota, displayed_quota').order('audience').order('price_pkr'),
    admin.from('profiles').select('id, full_name, email, role').in('role', ['tutor', 'parent', 'academy']).order('full_name').limit(200),
    admin.from('subscriptions').select('id, user_id, plan_code, status, starts_at, expires_at, source, note').eq('status', 'active'),
  ])

  const rows: AccountRow[] = (accounts ?? []).map((a) => {
    const sub = subs?.find((s) => s.user_id === a.id)
    return {
      id: a.id,
      fullName: a.full_name,
      email: a.email,
      role: a.role,
      activePlan: sub?.plan_code ?? null,
      expiresAt: sub?.expires_at ?? null,
      source: sub?.source ?? null,
      note: sub?.note ?? null,
    }
  })

  return <PlanGrantClient plans={(plans ?? []) as PlanRow[]} accounts={rows} canMutate={canMutate} />
}
