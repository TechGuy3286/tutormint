// lib/teamOverview.ts
//
// The Team overview card's data (owner, 24 Oct 2026; rules in
// lib/teamOverviewCore). Reads the same loaders as the Applications badge and
// Paid tutors, so the card and those screens never disagree. Counts only.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { overdueApplicationsByOwner } from '@/lib/applicationTracking'
import { loadPaidTutors } from '@/lib/paidTutors'
import { DAY_MS, pkDayStart } from '@/lib/overviewTrendCore'
import { buildTeamOverview, countByOwner, followUpWindows, type TeamOverviewRow } from '@/lib/teamOverviewCore'

export async function loadTeamOverview(nowMs = Date.now()): Promise<TeamOverviewRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const since = new Date(pkDayStart(nowMs) - 6 * DAY_MS).toISOString()
  const [{ data: staff }, overdue, paid, memberFus, appFus] = await Promise.all([
    admin.from('profiles').select('id, full_name, admin_role, is_suspended').eq('role', 'admin').not('admin_role', 'is', null),
    overdueApplicationsByOwner(),
    loadPaidTutors(),
    pageAll<{ staff_id: string | null; created_at: string }>((f, t) =>
      admin.from('member_follow_ups').select('staff_id, created_at').is('undone_at', null).gte('created_at', since).order('id').range(f, t),
    ),
    pageAll<{ staff_id: string | null; created_at: string }>((f, t) =>
      admin.from('application_follow_ups').select('staff_id, created_at').is('undone_at', null).gte('created_at', since).order('id').range(f, t),
    ),
  ])
  // The Project Managers own no tuitions or cities; everyone else is listed.
  const people = (staff ?? [])
    .filter((s) => !s.is_suspended && s.admin_role !== 'partner')
    .map((s) => ({ id: s.id as string, name: formatName((s.full_name as string | null) ?? '') || 'Staff' }))
  const red = countByOwner(paid.rows, (r) => r.ownerId, (r) => r.red.length > 0)
  const stamps = [...memberFus, ...appFus].map((r) => ({ staffId: r.staff_id, at: r.created_at }))
  return buildTeamOverview(people, overdue, red, followUpWindows(stamps, nowMs))
}
