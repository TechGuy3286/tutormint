import 'server-only'

// lib/backendSupportKpi.ts — the Backend Support KPI card's data (owner,
// 31 Oct 2026; rules in lib/backendSupportKpiCore). Reads the same loaders as
// the Applications badge and Paid tutors. Counts only.

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { overdueApplicationsByOwner } from '@/lib/applicationTracking'
import { loadPaidTutors } from '@/lib/paidTutors'
import { DAY_MS, pkDayStart } from '@/lib/overviewTrendCore'
import { followUpCounts, forwardSpeed, type BackendSupportKpi } from '@/lib/backendSupportKpiCore'

export async function loadBackendSupportKpi(staffId: string, nowMs = Date.now()): Promise<BackendSupportKpi> {
  const empty: BackendSupportKpi = { followUpsToday: 0, followUps7: 0, overdueTodo: 0, redPaidTutors: 0, forwarded7: 0, forwardedWithin24h: 0 }
  const admin = createAdminClient()
  if (!admin) return empty
  const since = new Date(pkDayStart(nowMs) - 6 * DAY_MS).toISOString()
  const [memberFus, appFus, overdue, paid, forwards] = await Promise.all([
    pageAll<{ created_at: string }>((f, t) =>
      admin.from('member_follow_ups').select('created_at').eq('staff_id', staffId).is('undone_at', null).gte('created_at', since).order('id').range(f, t),
    ),
    pageAll<{ created_at: string }>((f, t) =>
      admin.from('application_follow_ups').select('created_at').eq('staff_id', staffId).is('undone_at', null).gte('created_at', since).order('id').range(f, t),
    ),
    overdueApplicationsByOwner(),
    loadPaidTutors(),
    pageAll<{ job_id: string; tutor_ids: string[]; created_at: string }>((f, t) =>
      admin.from('applicant_forwards').select('job_id, tutor_ids, created_at').eq('staff_id', staffId).is('undone_at', null).gte('created_at', since).order('id').range(f, t),
    ),
  ])
  const fu = followUpCounts([...memberFus, ...appFus].map((r) => r.created_at), nowMs)
  // Overdue To do: Backend Support works every application, so every overdue one counts.
  let overdueTodo = 0
  for (const n of overdue.values()) overdueTodo += n
  const redPaidTutors = paid.rows.filter((r) => r.red.length > 0).length

  const jobIds = [...new Set(forwards.map((f) => f.job_id))]
  const applied = new Map<string, string>()
  if (jobIds.length) {
    const apps = await pageAll<{ job_id: string; tutor_id: string; created_at: string }>((f, t) =>
      admin.from('applications').select('job_id, tutor_id, created_at').in('job_id', jobIds).order('id').range(f, t),
    )
    for (const a of apps) applied.set(`${a.job_id}:${a.tutor_id}`, a.created_at)
  }
  const pairs = forwards.flatMap((f) => (f.tutor_ids ?? []).map((tid) => ({ forwardedAt: f.created_at, appliedAt: applied.get(`${f.job_id}:${tid}`) ?? null })))
  const speed = forwardSpeed(pairs, nowMs)
  return { followUpsToday: fu.today, followUps7: fu.last7, overdueTodo, redPaidTutors, forwarded7: speed.forwarded, forwardedWithin24h: speed.within24h }
}
