import { requireAdminRole, roleSatisfies, getAdminActor, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import PlanGrantClient, { type PlanRow, type AccountRow } from './PlanGrantClient'

// Plans screen. Owner + manager only (Finance was removed, 14 Sep 2026).
// canMutate drives the UI, and /api/admin/plans re-checks the permission
// independently.

export const dynamic = 'force-dynamic'

export default async function AdminPlansPage() {
  await requireAdminRole(...SCREEN_ACCESS.plans)
  const actor = await getAdminActor()
  const canMutate = actor ? roleSatisfies(actor.adminRole, SCREEN_ACCESS.plansMutate) : false

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="text-xs font-bold text-tm-red bg-tm-tint-red border border-tm-red/30 rounded-xl p-4">
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

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-tm-tint-navy/40 p-4 text-xs leading-relaxed text-slate-700">
        <p className="font-black text-tm-navy">What this screen is for</p>
        <p className="mt-1">
          Grant a plan when a payment succeeded but activation failed, or revoke one granted in error.
          Members normally get their plan automatically — gateway payments activate on confirmation, and
          bank transfers activate when a manager approves them on Payments.
        </p>
        <p className="mt-1">
          Plans granted here are recorded as <span className="font-bold">admin&nbsp;grant</span> and are
          excluded from revenue and re-subscription numbers.
        </p>
      </div>
      <PlanGrantClient plans={(plans ?? []) as PlanRow[]} accounts={rows} canMutate={canMutate} />
    </div>
  )
}
