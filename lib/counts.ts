import 'server-only'

// lib/counts.ts — the facts behind every shared admin count (PR-14). The rules
// are in lib/countsCore.ts; this file only reads. Every screen that shows one of
// these counts (Overview cards and funnels, Insights, the daily sign-up funnel,
// Paid sign-ups) reads it through here, and `npm run check:counts` compares them.
//
// Reads only, service role. Members come from the People directory (the one
// "who counts" rule); never a phone, email, CNIC or amount in what it returns.

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { runMemo } from '@/lib/runMemo'
import { loadDirectory } from '@/lib/peopleDirectory'
import { memoize } from '@/lib/memoCache'
import {
  COUNT_PERIODS,
  countAll,
  countRows,
  countSpan,
  countWindows,
  type CountPeriod,
  firstFeePayments,
  type CountFacts,
  type CountKey,
  type CountRow,
  type Span,
} from '@/lib/countsCore'

type R = Record<string, unknown>

/** The earliest instant any loaded fact needs (members and fees: all time). */
async function loadFacts(sinceMs: number): Promise<CountFacts> {
  const admin = createAdminClient()
  const empty: CountFacts = { members: [], feePaid: [], plans: [], jobs: [], applications: [], forwards: [], uploads: [], reveals: [] }
  if (!admin) return empty
  const since = new Date(sinceMs).toISOString()
  const inWindow = (table: string, cols: string, extra?: (q: never) => never) =>
    pageAll<R>((f, t) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = admin.from(table).select(cols).gte('created_at', since)
      if (extra) q = extra(q as never)
      return q.order('created_at').order('id').range(f, t)
    })
  const [dir, fees, plans, jobs, apps, forwards, uploads, reveals] = await Promise.all([
    loadDirectory(),
    pageAll<R>((f, t) =>
      admin
        .from('payments')
        .select('id, user_id, reviewed_at, updated_at, refunded_amount_pkr, refunded_at')
        .eq('plan_code', 'verified')
        .eq('status', 'approved')
        .not('user_id', 'is', null)
        .order('id')
        .range(f, t),
    ),
    pageAll<R>((f, t) =>
      admin
        .from('payments')
        .select('id, user_id, reviewed_at, updated_at, refunded_amount_pkr, refunded_at')
        .neq('plan_code', 'verified')
        .eq('status', 'approved')
        .not('user_id', 'is', null)
        .gte('updated_at', since)
        .order('id')
        .range(f, t),
    ),
    inWindow('jobs', 'id, parent_id, created_at'),
    inWindow('applications', 'id, tutor_id, created_at'),
    inWindow('application_stage_events', 'id, tutor_id, created_at', (q) => (q as unknown as { eq: (c: string, v: string) => never }).eq('to_stage', 'forwarded')),
    inWindow('user_activity_log', 'id, user_id, created_at', (q) => (q as unknown as { eq: (c: string, v: string) => never }).eq('event', 'document_uploaded')),
    pageAll<R>((f, t) => admin.from('contact_reveals').select('tutor_id, created_at').gte('created_at', since).order('created_at').order('tutor_id').range(f, t)),
  ])
  const refunded = (p: R) => (Number(p.refunded_amount_pkr) || 0) > 0 || !!p.refunded_at
  const approvedAt = (p: R) => ((p.reviewed_at as string | null) ?? (p.updated_at as string | null)) || null
  return {
    members: dir.people.map((p) => ({ id: p.id, role: p.role, createdAt: p.createdAt, phoneVerifiedAt: p.phoneVerifiedAt, onboardedAt: p.onboardedAt, excluded: p.excluded })),
    feePaid: firstFeePayments(fees.map((p) => ({ userId: p.user_id as string, approvedAt: approvedAt(p), refunded: refunded(p) }))),
    plans: plans
      .filter((p) => !refunded(p) && approvedAt(p))
      .map((p) => ({ id: p.id as string, memberId: p.user_id as string, at: approvedAt(p) as string })),
    jobs: jobs.map((j) => ({ id: j.id as string, posterId: (j.parent_id as string | null) ?? null, createdAt: j.created_at as string })),
    applications: apps.map((a) => ({ id: a.id as string, tutorId: a.tutor_id as string, createdAt: a.created_at as string })),
    forwards: forwards.map((a) => ({ id: a.id as string, tutorId: a.tutor_id as string, createdAt: a.created_at as string })),
    uploads: uploads.map((u) => ({ id: u.id as string, memberId: u.user_id as string, createdAt: u.created_at as string })),
    reveals: reveals.map((r) => ({ tutorId: r.tutor_id as string, createdAt: r.created_at as string })),
  }
}

/** The facts for windows starting at or after `sinceMs`. Shared inside one run
 *  (lib/runMemo) — the summary job and Insights load them once. */
export function loadCountFacts(sinceMs: number): Promise<CountFacts> {
  // Rounded to the Pakistan day so every caller in a run shares one load.
  const day = Math.floor((sinceMs + 5 * 3600_000) / 86_400_000) * 86_400_000 - 5 * 3600_000
  return runMemo(`count-facts:${day}`, () => loadFacts(day))
}

/** Every shared count for one window. */
export async function countsFor(span: Span): Promise<Record<CountKey, number>> {
  return countAll(await loadCountFacts(span.start), span)
}

/** The rows behind one count (Overview card trends, Insights drill-down). */
export async function rowsFor(key: CountKey, span: Span): Promise<CountRow[]> {
  return countRows(key, await loadCountFacts(span.start), span)
}

/** The Applications page date chips (PR-19): the shared "Applications" count
 *  for Today, Yesterday, Last 7 days and This month — the same rule and windows
 *  as the Overview and Insights (lib/countsCore countRows 'applications'). */
export async function applicationDateCountsFresh(nowMs: number): Promise<Record<CountPeriod, number>> {
  const w = countWindows(nowMs)
  const facts = await loadCountFacts(Math.min(w.last7.start, w.month.start))
  return Object.fromEntries(COUNT_PERIODS.map((p) => [p.key, countRows('applications', facts, countSpan(p.key, nowMs)).length])) as Record<CountPeriod, number>
}

/** The same, held in memory for a minute (the page is opened often; the facts
 *  load reads the whole People directory). A new Pakistan day is a new key. */
const applicationDateCountsMemo = memoize(
  (_pkDay: string) => applicationDateCountsFresh(Date.now()),
  ['application-date-counts-v1'],
  { revalidate: 60 },
)

export function applicationDateCounts(nowMs = Date.now()): Promise<Record<CountPeriod, number>> {
  return applicationDateCountsMemo(new Date(nowMs + 5 * 3600_000).toISOString().slice(0, 10))
}
