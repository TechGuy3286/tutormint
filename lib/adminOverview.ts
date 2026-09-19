import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { currentPeriod } from '@/lib/entitlements'
import { pkDayKey } from '@/lib/datetime'
import { loadTipCounts, type TipCounts } from '@/lib/adminTips'
import type { AdminScreen } from '@/lib/adminNav'

// The admin overview: how much the platform is earning, and who to nudge onto a
// plan (owner, 14 Sep 2026). The queue tiles (videos, CNICs, reports, payments,
// suspended, ads, imports, staff) and the "Needs attention" block were removed —
// each queue has its own screen and its own count there; the landing is money.
//
// REAL DATA ONLY. Not a percentage or a delta anywhere: a comparison needs a
// period that means something, and on seed data every one would be an artefact.
//
// Counts use head:true so nothing but the count crosses the wire.

export type Tile = {
  key: string
  label: string
  value: string
  meaning: string
  href: string
  /** SCREEN_ACCESS key; undefined means every admin may see it. */
  screen?: AdminScreen
}

export type Tip = {
  key: string
  label: string
  meaning: string
  href: string
  count: number
}

export type SignupPoint = { day: string; tutors: number; parents: number }
export type RevenueSlice = { plan: string; amount: number; payments: number }

export type Overview = {
  tiles: Tile[]
  tips: Tip[]
  signups: SignupPoint[]
  signupDays: number
  revenue: RevenueSlice[]
  revenuePeriod: string
  revenueTotal: number
}

const SIGNUP_ROW_CEILING = 5000
const SIGNUP_WINDOW_DAYS = 30

function emptyDays(days: number): SignupPoint[] {
  const out: SignupPoint[] = []
  const now = Date.now()
  for (let i = days - 1; i >= 0; i--) {
    out.push({ day: pkDayKey(new Date(now - i * 86_400_000)), tutors: 0, parents: 0 })
  }
  return out
}

export async function loadOverview(): Promise<Overview | null> {
  const admin = createAdminClient()
  if (!admin) return null

  const now = new Date()
  const nowIso = now.toISOString()
  const period = currentPeriod(now)
  const monthStart = `${period}-01T00:00:00.000Z`
  const windowStart = new Date(now.getTime() - SIGNUP_WINDOW_DAYS * 86_400_000).toISOString()

  const [
    tutors,
    parents,
    openJobs,
    revenueRows,
    thisMonthPurchases,
    signupRows,
    planRows,
    tips,
  ] = await Promise.all([
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'tutor'),
    admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .in('role', ['parent', 'academy']),
    // Open tuitions: every open job, NOT filtered by seed or team account.
    admin.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    admin
      .from('payments')
      .select('amount_pkr, plan_code')
      .eq('status', 'approved')
      .gte('created_at', monthStart),
    // Renewals: subscriptions that ACTIVATED this month by purchase (not an
    // admin grant). A row here is a re-subscription only if the same member also
    // held an earlier subscription (resolved below).
    admin
      .from('subscriptions')
      .select('user_id, starts_at')
      .eq('source', 'purchase')
      .gte('starts_at', monthStart),
    admin
      .from('profiles')
      .select('created_at, role')
      .in('role', ['tutor', 'parent', 'academy'])
      .gte('created_at', windowStart)
      .limit(SIGNUP_ROW_CEILING),
    admin.from('plans').select('code, name, audience'),
    loadTipCounts(admin, nowIso),
  ])

  // ----------------------------------------------------- re-subscribed --
  // A member counts once if they bought this month AND held a subscription that
  // started before this month's purchase. Admin grants are already excluded
  // above (source='purchase'); the PRIOR sub may be any source.
  const monthUserIds = Array.from(
    new Set((thisMonthPurchases.data ?? []).map((s) => s.user_id as string)),
  )
  let resubscribed = 0
  if (monthUserIds.length > 0) {
    const { data: priors } = await admin
      .from('subscriptions')
      .select('user_id')
      .lt('starts_at', monthStart)
      .in('user_id', monthUserIds)
    resubscribed = new Set((priors ?? []).map((s) => s.user_id as string)).size
  }

  // ------------------------------------------------------------- signups --
  const buckets = new Map(emptyDays(SIGNUP_WINDOW_DAYS).map((p) => [p.day, p]))
  for (const row of signupRows.data ?? []) {
    const point = buckets.get(pkDayKey(row.created_at as string))
    if (!point) continue
    if (row.role === 'tutor') point.tutors += 1
    else point.parents += 1
  }
  const signups = [...buckets.values()]

  // ------------------------------------------------------------- revenue --
  const planName = new Map(
    (planRows.data ?? []).map((p) => [
      p.code as string,
      `${p.audience === 'tutor' ? 'Tutor' : 'Parent'} · ${(p.name as string) || (p.code as string)}`,
    ]),
  )
  const byPlan = new Map<string, RevenueSlice>()
  for (const row of revenueRows.data ?? []) {
    const code = (row.plan_code as string) ?? 'unknown'
    const slice = byPlan.get(code) ?? { plan: planName.get(code) ?? code, amount: 0, payments: 0 }
    slice.amount += (row.amount_pkr as number) ?? 0
    slice.payments += 1
    byPlan.set(code, slice)
  }
  const revenue = [...byPlan.values()].sort((a, b) => b.amount - a.amount)
  const revenueTotal = revenue.reduce((s, r) => s + r.amount, 0)

  const n = (r: { count: number | null }) => r.count ?? 0

  const tiles: Tile[] = [
    {
      key: 'revenue',
      label: 'Revenue this month',
      value: `Rs. ${revenueTotal.toLocaleString('en-PK')}`,
      meaning: `Approved payments since ${period}-01`,
      href: '/admin/payments?filter=approved',
      screen: 'payments',
    },
    {
      key: 'resubscribed',
      label: 'Monthly re-subscribed',
      value: String(resubscribed),
      meaning: 'Renewals this month (excl. admin grants)',
      href: '/admin/payments',
      screen: 'payments',
    },
    {
      key: 'tutors',
      label: 'Tutors',
      value: String(n(tutors)),
      meaning: 'Registered accounts',
      href: '/admin/users?role=tutor',
      screen: 'users',
    },
    {
      key: 'parents',
      label: 'Parents',
      value: String(n(parents)),
      meaning: 'Registered accounts',
      href: '/admin/users?role=parent',
      screen: 'users',
    },
    {
      key: 'jobs',
      label: 'Open tuitions',
      value: String(n(openJobs)),
      meaning: 'Live on the board for tutors to apply to',
      href: '/admin/jobs?status=open',
      screen: 'jobs',
    },
  ]

  const tipRows: Tip[] = [
    {
      key: 'unpaid-tutors',
      label: 'Unpaid tutors',
      meaning: 'Verification fee not paid — newest first',
      href: '/admin/users?tip=unpaid-tutors',
      count: tips.unpaidTutors,
    },
    {
      key: 'listed-unpaid',
      label: 'Listed but unpaid',
      meaning: 'Shown in Browse, fee not paid — closest to converting',
      href: '/admin/users?tip=listed-unpaid',
      count: tips.listedUnpaid,
    },
    {
      key: 'never-filled',
      label: 'Signed up, never filled',
      meaning: 'Verified number, profile under 25%',
      href: '/admin/users?tip=never-filled',
      count: tips.neverFilled,
    },
    {
      key: 'never-verified',
      label: 'Never verified',
      meaning: 'Signup drafts that expired unverified',
      href: '/admin/signups',
      count: tips.neverVerified,
    },
  ]

  return {
    tiles,
    tips: tipRows,
    signups,
    signupDays: SIGNUP_WINDOW_DAYS,
    revenue,
    revenuePeriod: period,
    revenueTotal,
  }
}

export type { TipCounts }
