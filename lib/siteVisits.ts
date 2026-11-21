import 'server-only'

// lib/siteVisits.ts
//
// The counts behind the daily sign-up funnel (owner, 15 Oct 2026). Writes go
// through the service-role-only bump_site_visit() (migration 173): one row per
// Pakistan-time day per kind, a number and nothing else. Best-effort — a failed
// count never fails a page view or a sign-up.

import { createAdminClient } from '@/lib/supabase/admin'
import { loadCountFacts } from '@/lib/counts'
import { COUNT_DEFS, countOne, countSpan, type CountPeriod } from '@/lib/countsCore'
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
 * → tutor sign-up forms submitted (visit counters, counting began 15 Oct 2026;
 * no backfill) → tutors verified mobile → tutors finished onboarding → paid
 * (the Verification Fee). PR-14: the last three are the shared counts of
 * lib/counts (People rule, Pakistan-time windows), the same numbers Insights
 * and the Overview Paid card show.
 */
export async function loadSignupFunnel(nowMs = Date.now()): Promise<FunnelWindowResult[]> {
  const admin = createAdminClient()
  const windows = funnelWindows(nowMs)
  if (!admin) return []
  const allDays = [...new Set(windows.flatMap((w) => w.days))]
  const earliest = Math.min(...windows.map((w) => w.fromMs))
  const [{ data: visits }, facts] = await Promise.all([
    admin.from('site_visit_counts').select('day, kind, count').in('day', allDays),
    loadCountFacts(earliest),
  ])
  const sum = (days: string[], kind: VisitKind) =>
    (visits ?? []).filter((v) => days.includes(v.day as string) && v.kind === kind).reduce((n, v) => n + Number(v.count ?? 0), 0)

  return windows.map((w) => {
    const span = countSpan(w.key as CountPeriod, nowMs)
    return {
      key: w.key,
      label: w.label,
      parentSignups: sum(w.days, 'signup_parent'),
      steps: funnelSteps([
        { key: 'visits', label: 'Public page visits', count: sum(w.days, 'public_page') },
        { key: 'register', label: 'Visits to /register', count: sum(w.days, 'register_page') },
        { key: 'submitted', label: 'Tutor sign-up forms submitted', count: sum(w.days, 'signup_tutor') },
        { key: 'mobile', label: COUNT_DEFS.tutor_mobile_verified.label, count: countOne('tutor_mobile_verified', facts, span) },
        { key: 'onboarded', label: COUNT_DEFS.tutor_onboarded.label, count: countOne('tutor_onboarded', facts, span) },
        { key: 'paid', label: COUNT_DEFS.paid_fee.label, count: countOne('paid_fee', facts, span) },
      ]),
    }
  })
}
