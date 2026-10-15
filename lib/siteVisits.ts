import 'server-only'

// lib/siteVisits.ts
//
// The counts behind the daily sign-up funnel (owner, 15 Oct 2026). Writes go
// through the service-role-only bump_site_visit() (migration 173): one row per
// Pakistan-time day per kind, a number and nothing else. Best-effort — a failed
// count never fails a page view or a sign-up.

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { funnelSteps, funnelWindows, type FunnelStep, type VisitKind } from '@/lib/signupFunnelCore'

export async function bumpSiteVisit(kind: VisitKind): Promise<void> {
  try {
    const admin = createAdminClient()
    if (!admin) return
    await admin.rpc('bump_site_visit', { p_kind: kind })
  } catch {
    /* a count is never worth an error */
  }
}

export type FunnelWindowResult = { key: string; label: string; steps: FunnelStep[]; parentSignups: number }

/**
 * Today, Yesterday and the Last 7 days: public page visits → /register visits
 * → tutor sign-up forms submitted → mobile verified → onboarding done → paid
 * (the Verification Fee). The last three are real tutor accounts (not seed,
 * not test-named, not staff), dated by when each step happened. Page-visit
 * counting began on deploy (15 Oct 2026); no backfill.
 */
export async function loadSignupFunnel(nowMs = Date.now()): Promise<FunnelWindowResult[]> {
  const admin = createAdminClient()
  const windows = funnelWindows(nowMs)
  if (!admin) return []
  const earliest = windows.reduce((m, w) => Math.min(m, w.fromMs), nowMs)
  const allDays = [...new Set(windows.flatMap((w) => w.days))]

  const since = new Date(earliest).toISOString()
  const [{ data: visits }, verified, steps] = await Promise.all([
    admin.from('site_visit_counts').select('day, kind, count').in('day', allDays),
    pageAll((from, to) =>
      admin
        .from('profiles')
        .select('id, phone_verified_at, is_seed, is_test_name, admin_role')
        .eq('role', 'tutor')
        .gte('phone_verified_at', since)
        .order('id')
        .range(from, to),
    ),
    pageAll((from, to) =>
      admin
        .from('tutor_profiles')
        .select('id, onboarded_at, verified_fee_paid_at')
        .or(`onboarded_at.gte.${since},verified_fee_paid_at.gte.${since}`)
        .order('id')
        .range(from, to),
    ),
  ])
  // The same "real tutor" rule for the onboarding and paid rows.
  const stepIds = steps.map((s) => s.id as string)
  const flags = new Map<string, { is_seed?: boolean; is_test_name?: boolean; admin_role?: string | null }>()
  for (let i = 0; i < stepIds.length; i += 200) {
    const { data } = await admin.from('profiles').select('id, is_seed, is_test_name, admin_role, role').in('id', stepIds.slice(i, i + 200))
    for (const p of data ?? []) if (p.role === 'tutor') flags.set(p.id as string, p)
  }
  const isReal = (f: { is_seed?: boolean | null; is_test_name?: boolean | null; admin_role?: string | null } | undefined) =>
    !!f && !f.is_seed && !f.is_test_name && !f.admin_role

  const sum = (days: string[], kind: VisitKind) =>
    (visits ?? []).filter((v) => days.includes(v.day as string) && v.kind === kind).reduce((n, v) => n + Number(v.count ?? 0), 0)
  const real = verified.filter((t) => isReal(t as never))
  const realSteps = steps.filter((s) => isReal(flags.get(s.id as string)))
  const inWin = (iso: unknown, fromMs: number, toMs: number) => {
    const t = typeof iso === 'string' ? Date.parse(iso) : NaN
    return Number.isFinite(t) && t >= fromMs && t <= toMs
  }

  return windows.map((w) => ({
    key: w.key,
    label: w.label,
    parentSignups: sum(w.days, 'signup_parent'),
    steps: funnelSteps([
      { key: 'visits', label: 'Public page visits', count: sum(w.days, 'public_page') },
      { key: 'register', label: 'Visits to /register', count: sum(w.days, 'register_page') },
      { key: 'submitted', label: 'Tutor sign-up forms submitted', count: sum(w.days, 'signup_tutor') },
      { key: 'mobile', label: 'Mobile verified', count: real.filter((t) => inWin(t.phone_verified_at, w.fromMs, w.toMs)).length },
      { key: 'onboarded', label: 'Onboarding done', count: realSteps.filter((t) => inWin(t.onboarded_at, w.fromMs, w.toMs)).length },
      { key: 'paid', label: 'Paid', count: realSteps.filter((t) => inWin(t.verified_fee_paid_at, w.fromMs, w.toMs)).length },
    ]),
  }))
}
