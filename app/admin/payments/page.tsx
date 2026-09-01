import Link from 'next/link'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import PaymentQueue, { type QueuePayment, type SubscriptionRow } from './PaymentQueue'

// Payments: the manual-transfer queue and the subscription ledger.
//
// owner / manager / finance. A verifier or support admin is bounced by
// requireAdminRole here and by checkAdminRole in the decide route, so the
// separation holds whether they use the screen or curl.
//
// "Source" is not a column on subscriptions. It is read from the payment the
// subscription points at, because that is where the fact lives: a row with
// source='purchase' and a manual payment behind it WAS a bank transfer, and
// storing that twice is how the two answers start disagreeing.

export const dynamic = 'force-dynamic'

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.payments)
  const { filter = 'pending' } = await searchParams

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so payments cannot be loaded.
      </p>
    )
  }

  let paymentQuery = admin
    .from('payments')
    .select(
      'id, user_id, plan_code, amount_pkr, method, provider, provider_ref, reference, screenshot_path, status, rejection_reason, reviewed_at, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (filter !== 'all') paymentQuery = paymentQuery.eq('status', filter)

  const [{ data: payments }, { data: subs }, { data: plans }] = await Promise.all([
    paymentQuery,
    admin
      .from('subscriptions')
      .select('id, user_id, plan_code, status, starts_at, expires_at, source, payment_id, note')
      .order('starts_at', { ascending: false })
      .limit(100),
    admin.from('plans').select('code, name'),
  ])

  const planName = new Map((plans ?? []).map((p) => [p.code as string, p.name as string]))

  // One lookup for every account named on either list.
  const userIds = Array.from(
    new Set([
      ...(payments ?? []).map((p) => p.user_id as string),
      ...(subs ?? []).map((s) => s.user_id as string),
    ]),
  )
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, email, role')
    .in('id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000'])

  const who = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      { name: (p.full_name as string) ?? '—', email: (p.email as string) ?? '—', role: p.role as string },
    ]),
  )

  // provider of the payment each subscription came from, for the source column.
  const paymentProvider = new Map(
    (payments ?? []).map((p) => [p.id as string, p.provider as string]),
  )
  const missingPaymentIds = (subs ?? [])
    .map((s) => s.payment_id as string | null)
    .filter((id): id is string => !!id && !paymentProvider.has(id))

  if (missingPaymentIds.length > 0) {
    const { data: extra } = await admin
      .from('payments')
      .select('id, provider')
      .in('id', missingPaymentIds)
    for (const p of extra ?? []) paymentProvider.set(p.id as string, p.provider as string)
  }

  const paymentRows: QueuePayment[] = (payments ?? []).map((p) => ({
    id: p.id as string,
    userId: p.user_id as string,
    name: who.get(p.user_id as string)?.name ?? '—',
    email: who.get(p.user_id as string)?.email ?? '—',
    planCode: (p.plan_code as string) ?? '—',
    planName: planName.get(p.plan_code as string) ?? ((p.plan_code as string) ?? '—'),
    amountPkr: p.amount_pkr as number,
    provider: p.provider as string,
    method: (p.method as string) ?? null,
    ourReference: (p.provider_ref as string) ?? null,
    payerReference: (p.reference as string) ?? null,
    hasScreenshot: !!p.screenshot_path,
    status: p.status as QueuePayment['status'],
    rejectionReason: (p.rejection_reason as string) ?? null,
    createdAt: p.created_at as string,
    reviewedAt: (p.reviewed_at as string) ?? null,
  }))

  const subscriptionRows: SubscriptionRow[] = (subs ?? []).map((s) => ({
    id: s.id as string,
    name: who.get(s.user_id as string)?.name ?? '—',
    email: who.get(s.user_id as string)?.email ?? '—',
    role: who.get(s.user_id as string)?.role ?? '—',
    planName: planName.get(s.plan_code as string) ?? (s.plan_code as string),
    status: s.status as string,
    startsAt: s.starts_at as string,
    expiresAt: (s.expires_at as string) ?? null,
    source: describeSource(s.source as string, paymentProvider.get(s.payment_id as string)),
    note: (s.note as string) ?? null,
  }))

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-xl font-black text-tm-navy sm:text-2xl">Payments</h1>
          <p className="text-xs text-gray-500">
            Approving a transfer runs exactly the same activation a gateway webhook runs.
          </p>
        </div>
        <Link
          href="/admin/payments/usage"
          className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700"
        >
          Quota usage
        </Link>
      </header>

      <PaymentQueue payments={paymentRows} subscriptions={subscriptionRows} filter={filter} />
    </div>
  )
}

/** gateway / manual transfer / admin grant, derived not stored. */
function describeSource(source: string, provider: string | undefined): string {
  if (source === 'admin_grant') return 'Admin grant'
  if (provider === 'manual') return 'Manual transfer'
  if (provider === 'simulator') return 'Gateway (test)'
  if (provider === 'assanpay') return 'Gateway'
  return 'Purchase'
}
