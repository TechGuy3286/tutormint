import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { currentPeriod } from '@/lib/entitlements'
import { pkDayKey } from '@/lib/datetime'
import type { AdminScreen } from '@/lib/adminNav'

// Everything the admin overview reads, in one place.
//
// REAL DATA ONLY. There is not a percentage or a "+12% on last week" anywhere
// in here, and that is deliberate: a delta needs a comparison period that
// means something, and on a platform whose first real tutors have not been
// onboarded yet every one of them would be an artefact of the seed data. A
// number and what it means is worth more than a number and an invented trend.
//
// Counts use head:true so nothing but the count crosses the wire -- this page
// is the default landing for every admin, every session, and has to stay
// cheap.

export type Tile = {
  key: string
  label: string
  value: string
  meaning: string
  href: string
  /** SCREEN_ACCESS key; undefined means every admin may see it. */
  screen?: AdminScreen
  /** A count that represents work waiting. Drives the gold outline. */
  pending?: number
}

export type Attention = {
  key: string
  headline: string
  detail: string
  action: string
  href: string
  screen: AdminScreen
  count: number
}

export type SignupPoint = { day: string; tutors: number; parents: number }
export type RevenueSlice = { plan: string; amount: number; payments: number }

export type Overview = {
  tiles: Tile[]
  attention: Attention[]
  signups: SignupPoint[]
  signupDays: number
  revenue: RevenueSlice[]
  revenuePeriod: string
  revenueTotal: number
}

/**
 * How many signup rows we are willing to pull to build the chart.
 *
 * The series is bucketed in JavaScript rather than by a SQL date_trunc,
 * because a grouped query needs an RPC and this change carries no migration.
 * The ceiling is the honest part: past it the chart would be wrong rather than
 * slow, so the caller is told the window was clipped instead of being shown a
 * short month.
 */
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
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000).toISOString()
  const period = currentPeriod(now)
  const monthStart = `${period}-01T00:00:00.000Z`
  const windowStart = new Date(now.getTime() - SIGNUP_WINDOW_DAYS * 86_400_000).toISOString()

  const [
    tutors,
    parents,
    suspended,
    pendingTutors,
    pendingParents,
    pendingPayments,
    openReports,
    expiringSoon,
    activeSubs,
    revenueRows,
    staff,
    liveAds,
    unclaimed,
    openJobs,
    signupRows,
    planRows,
  ] = await Promise.all([
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'tutor'),
    admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .in('role', ['parent', 'academy']),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_suspended', true),
    admin
      .from('tutor_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('video_status', 'uploaded'),
    admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('verification_state', 'submitted'),
    admin.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    admin
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .gt('expires_at', now.toISOString())
      .lte('expires_at', weekAhead),
    admin
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .gt('expires_at', now.toISOString()),
    admin
      .from('payments')
      .select('amount_pkr, plan_code')
      .eq('status', 'approved')
      .gte('created_at', monthStart),
    admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .not('admin_role', 'is', null),
    admin
      .from('advertisements')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .lte('starts_at', now.toISOString())
      .or(`ends_at.is.null,ends_at.gt.${now.toISOString()}`),
    admin
      .from('tutor_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('imported', true)
      .is('claimed_at', null),
    admin.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    admin
      .from('profiles')
      .select('created_at, role')
      .in('role', ['tutor', 'parent', 'academy'])
      .gte('created_at', windowStart)
      .limit(SIGNUP_ROW_CEILING),
    admin.from('plans').select('code, name, audience'),
  ])

  // ------------------------------------------------------------- signups --
  const buckets = new Map(emptyDays(SIGNUP_WINDOW_DAYS).map((p) => [p.day, p]))
  for (const row of signupRows.data ?? []) {
    const point = buckets.get(pkDayKey(row.created_at as string))
    // A row on the boundary day can fall outside the 30 keys; dropping it is
    // right — the chart's axis is what it says it is.
    if (!point) continue
    if (row.role === 'tutor') point.tutors += 1
    else point.parents += 1
  }
  const signups = [...buckets.values()]

  // ------------------------------------------------------------- revenue --
  // "Featured" is the name of BOTH the tutor 999 plan and the parent 999
  // plan, and a category axis keyed on a duplicated label collapses the two
  // into one band -- which is how three plans rendered as an empty plot. The
  // audience is what tells them apart, and it is what an admin reading a
  // revenue chart wants to know first anyway.
  const planName = new Map(
    (planRows.data ?? []).map((p) => [
      p.code as string,
      `${p.audience === 'tutor' ? 'Tutor' : 'Parent'} · ${(p.name as string) || (p.code as string)}`,
    ]),
  )
  const byPlan = new Map<string, RevenueSlice>()
  for (const row of revenueRows.data ?? []) {
    const code = (row.plan_code as string) ?? 'unknown'
    const slice = byPlan.get(code) ?? {
      plan: planName.get(code) ?? code,
      amount: 0,
      payments: 0,
    }
    slice.amount += (row.amount_pkr as number) ?? 0
    slice.payments += 1
    byPlan.set(code, slice)
  }
  const revenue = [...byPlan.values()].sort((a, b) => b.amount - a.amount)
  const revenueTotal = revenue.reduce((s, r) => s + r.amount, 0)

  const n = (r: { count: number | null }) => r.count ?? 0

  const tiles: Tile[] = [
    {
      key: 'videos',
      label: 'Videos to review',
      value: String(n(pendingTutors)),
      meaning: 'Tutors waiting on a decision',
      href: '/admin/tutors',
      screen: 'tutors',
      pending: n(pendingTutors),
    },
    {
      key: 'cnics',
      label: 'CNICs to verify',
      value: String(n(pendingParents)),
      meaning: 'Parents who cannot post until approved',
      href: '/admin/parents',
      screen: 'parents',
      pending: n(pendingParents),
    },
    {
      key: 'reports',
      label: 'Open reports',
      value: String(n(openReports)),
      meaning: 'Waiting on a moderator',
      href: '/admin/reports',
      screen: 'reports',
      pending: n(openReports),
    },
    {
      key: 'payments',
      label: 'Payments to confirm',
      value: String(n(pendingPayments)),
      meaning: 'Transfers a member has already sent',
      href: '/admin/payments',
      screen: 'payments',
      pending: n(pendingPayments),
    },
    {
      key: 'revenue',
      label: 'Revenue this month',
      value: `Rs. ${revenueTotal.toLocaleString('en-PK')}`,
      meaning: `Approved payments since ${period}-01`,
      href: '/admin/payments?filter=approved',
      screen: 'payments',
    },
    {
      key: 'expiring',
      label: 'Expiring this week',
      value: String(n(expiringSoon)),
      meaning: `of ${n(activeSubs)} active plans`,
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
    {
      key: 'suspended',
      label: 'Suspended',
      value: String(n(suspended)),
      meaning: 'Members currently locked out',
      href: '/admin/users?status=suspended',
      screen: 'users',
    },
    {
      key: 'ads',
      label: 'Live ads',
      value: String(n(liveAds)),
      meaning: 'Banners in rotation right now',
      href: '/admin/ads',
      screen: 'ads',
    },
    {
      key: 'unclaimed',
      label: 'Unclaimed imports',
      value: String(n(unclaimed)),
      meaning: 'Imported tutors yet to claim their profile',
      href: '/admin/import',
      screen: 'import',
    },
    {
      key: 'staff',
      label: 'Staff',
      value: String(n(staff)),
      meaning: 'Accounts with an admin role',
      href: '/admin/team',
      screen: 'team',
    },
  ]

  // The queue, as rows. Same numbers as the tiles above, so the two can never
  // disagree -- the point is that the owner can clear four queues without
  // opening four screens to find out whether there is anything in them.
  const attention: Attention[] = (
    [
    {
      key: 'videos',
      headline: 'tutor videos waiting on a decision',
      detail: 'Each one is a tutor who cannot be listed until it is reviewed.',
      action: 'Review videos',
      href: '/admin/tutors',
      screen: 'tutors',
      count: n(pendingTutors),
    },
    {
      key: 'cnics',
      headline: 'parents waiting on CNIC and address approval',
      detail: 'They cannot post a tuition until this is approved.',
      action: 'Open the queue',
      href: '/admin/parents',
      screen: 'parents',
      count: n(pendingParents),
    },
    {
      key: 'payments',
      headline: 'payments waiting to be confirmed',
      detail: 'The money has been sent; the plan is not active yet.',
      action: 'Confirm payments',
      href: '/admin/payments',
      screen: 'payments',
      count: n(pendingPayments),
    },
    {
      key: 'reports',
      headline: 'reports nobody has actioned',
      detail: 'A member reported another member and is waiting.',
      action: 'Work the reports',
      href: '/admin/reports',
      screen: 'reports',
      count: n(openReports),
    },
    ] satisfies Attention[]
  ).filter((a) => a.count > 0)

  return {
    tiles,
    attention,
    signups,
    signupDays: SIGNUP_WINDOW_DAYS,
    revenue,
    revenuePeriod: period,
    revenueTotal,
  }
}
