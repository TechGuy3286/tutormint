import Link from 'next/link'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { currentPeriod } from '@/lib/entitlements'

// Real quota usage, including behind the word "Unlimited".
//
// CLAUDE.md asks for this explicitly: Featured plans advertise "Unlimited" and
// are really capped at 100 a month, and the owner needs to see the true
// numbers. So this screen shows "37 / 100 (shown as Unlimited)" rather than
// repeating the marketing word back at the person who set the cap.
//
// Read-only, and read through the service-role client because usage_counters
// is self-read under RLS.

export const dynamic = 'force-dynamic'

type Row = {
  userId: string
  name: string
  email: string
  role: string
  planName: string | null
  displayedQuota: string | null
  cap: number
  used: number
  field: 'jobs_applied' | 'jobs_posted'
  messagesInitiated: number
}

export default async function AdminUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.payments)
  const { period: requested } = await searchParams
  const period = /^\d{4}-\d{2}$/.test(requested ?? '') ? requested! : currentPeriod()

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-[#d60008]">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  const [{ data: counters }, { data: plans }] = await Promise.all([
    admin
      .from('usage_counters')
      .select('user_id, jobs_applied, jobs_posted, messages_initiated')
      .eq('period', period),
    admin.from('plans').select('code, name, monthly_quota, displayed_quota'),
  ])

  const planByCode = new Map(
    (plans ?? []).map((p) => [
      p.code as string,
      {
        name: p.name as string,
        cap: p.monthly_quota as number,
        displayed: (p.displayed_quota as string) ?? null,
      },
    ]),
  )

  const userIds = (counters ?? []).map((c) => c.user_id as string)

  const [{ data: profiles }, { data: subs }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, full_name, email, role, cnic_verified_at, address_verified_at')
      .in('id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']),
    admin
      .from('subscriptions')
      .select('user_id, plan_code, expires_at')
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .in('user_id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']),
  ])

  const activePlan = new Map((subs ?? []).map((s) => [s.user_id as string, s.plan_code as string]))
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]))

  const rows: Row[] = (counters ?? [])
    .map((c) => {
      const profile = profileById.get(c.user_id as string)
      const role = (profile?.role as string) ?? '—'
      const isTutor = role === 'tutor'

      // Same rule getEntitlements uses: a verified parent is on the free plan
      // even though no subscription row exists for it.
      let planCode = activePlan.get(c.user_id as string) ?? null
      if (!planCode && !isTutor && profile?.cnic_verified_at && profile?.address_verified_at) {
        planCode = 'parent_verified'
      }
      const plan = planCode ? planByCode.get(planCode) : null

      return {
        userId: c.user_id as string,
        name: (profile?.full_name as string) ?? '—',
        email: (profile?.email as string) ?? '—',
        role,
        planName: plan?.name ?? null,
        displayedQuota: plan?.displayed ?? null,
        cap: plan?.cap ?? 0,
        used: isTutor ? (c.jobs_applied as number) : (c.jobs_posted as number),
        field: isTutor ? ('jobs_applied' as const) : ('jobs_posted' as const),
        messagesInitiated: c.messages_initiated as number,
      }
    })
    .sort((a, b) => b.used - a.used)

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-xl font-black text-[#0F172A] sm:text-2xl">Quota usage</h1>
          <p className="text-xs text-gray-500">
            Period {period}. Real counts against the real cap, including for members whose plan
            says &ldquo;Unlimited&rdquo;.
          </p>
        </div>
        <Link
          href="/admin/payments"
          className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-[#334155]"
        >
          Back to payments
        </Link>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-400">
          Nobody has used anything in {period}.
        </p>
      ) : (
        <>
          <ul className="space-y-2 sm:hidden">
            {rows.map((r) => (
              <li key={r.userId} className="space-y-1 rounded-2xl border border-gray-200 bg-white p-3">
                <p className="truncate text-xs font-black text-[#0F172A]">{r.name}</p>
                <p className="truncate text-[11px] text-gray-500">{r.email}</p>
                <p className="text-[11px] font-semibold text-[#0F172A]">
                  {r.planName ?? 'No plan'} · {r.field === 'jobs_applied' ? 'applications' : 'job posts'}
                </p>
                <UsageBar used={r.used} cap={r.cap} displayed={r.displayedQuota} />
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-2xl border border-gray-200 bg-white sm:block">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="border-b border-gray-200 text-[10px] uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="p-3 font-bold">Member</th>
                  <th className="p-3 font-bold">Role</th>
                  <th className="p-3 font-bold">Plan</th>
                  <th className="p-3 font-bold">Usage</th>
                  <th className="p-3 font-bold">Messages started</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} className="border-b border-gray-100 last:border-0">
                    <td className="p-3">
                      <span className="block font-bold text-[#0F172A]">{r.name}</span>
                      <span className="block text-[11px] text-gray-500">{r.email}</span>
                    </td>
                    <td className="p-3 capitalize text-gray-500">{r.role}</td>
                    <td className="p-3 font-semibold">{r.planName ?? 'No plan'}</td>
                    <td className="w-56 p-3">
                      <UsageBar used={r.used} cap={r.cap} displayed={r.displayedQuota} />
                    </td>
                    <td className="p-3 text-gray-500">{r.messagesInitiated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function UsageBar({
  used,
  cap,
  displayed,
}: {
  used: number
  cap: number
  displayed: string | null
}) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0
  // Only worth saying when the advertised number is not the real one.
  const marketingDiffers = displayed !== null && displayed !== String(cap)

  return (
    <div className="space-y-1">
      <p className="text-[11px] font-bold text-[#0F172A]">
        {used} / {cap || '—'}
        {marketingDiffers && (
          <span className="font-semibold text-gray-400"> (shown as &ldquo;{displayed}&rdquo;)</span>
        )}
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${pct >= 90 ? 'bg-[#d60008]' : pct >= 60 ? 'bg-[#F59E0B]' : 'bg-[#059669]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
