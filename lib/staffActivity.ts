import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  tallyStaffActivity,
  emptyStaffCounts,
  STAFF_METRICS,
  STAFF_METRIC_ACTIONS,
  type StaffCounts,
  type StaffMetricKey,
} from '@/lib/staffActivityCore'

// Staff activity, read from admin_audit_log BY ACTOR (PR29 §2.2).
//
// The point of reading by actor: a team tuition is posted on the TutorMint team
// account, so counting jobs by their owner shows the team account 26 posts and
// every staff member zero. The audit log records who ACTED, so grouping by
// actor_id surfaces the real work — Aqsa's 26 job.post rows are hers, though the
// tuitions belong to the team account.
//
// The tally is pure (lib/staffActivityCore), so the windows are unit-testable;
// this file is the I/O around it. Bounded to the metric actions, so it reads a
// small slice of the log, not the whole thing.

export type StaffActivityRow = {
  id: string
  name: string
  email: string | null
  adminRole: string | null
  counts: StaffCounts
}

/** Every staff member with their counts, for the /admin/staff-activity list. */
export async function loadStaffActivity(): Promise<StaffActivityRow[]> {
  const admin = createAdminClient()
  if (!admin) return []

  const { data: staff } = await admin
    .from('profiles')
    .select('id, full_name, email, admin_role')
    .eq('role', 'admin')
    .order('full_name', { ascending: true })
  const rows = staff ?? []
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id as string)
  const { data: audit } = await admin
    .from('admin_audit_log')
    .select('actor_id, action, created_at')
    .in('actor_id', ids)
    .in('action', STAFF_METRIC_ACTIONS)

  const counts = tallyStaffActivity(
    (audit ?? []).map((a) => ({
      actorId: a.actor_id as string | null,
      action: a.action as string,
      createdAt: a.created_at as string,
    })),
  )

  return rows.map((r) => ({
    id: r.id as string,
    name: (r.full_name as string | null) ?? '—',
    email: (r.email as string | null) ?? null,
    adminRole: (r.admin_role as string | null) ?? null,
    counts: counts.get(r.id as string) ?? emptyStaffCounts(),
  }))
}

/** One staff member's counts, for the staff-activity card on their member page. */
export async function loadStaffCountsFor(actorId: string): Promise<StaffCounts> {
  const admin = createAdminClient()
  if (!admin) return emptyStaffCounts()
  const { data: audit } = await admin
    .from('admin_audit_log')
    .select('actor_id, action, created_at')
    .eq('actor_id', actorId)
    .in('action', STAFF_METRIC_ACTIONS)
  const counts = tallyStaffActivity(
    (audit ?? []).map((a) => ({
      actorId: a.actor_id as string | null,
      action: a.action as string,
      createdAt: a.created_at as string,
    })),
  )
  return counts.get(actorId) ?? emptyStaffCounts()
}

// ─────────────────────────────────────────────── staff detail (PR40 §4) ──
//
// One staff member: their counts, WHAT they actually did (newest first, each a
// link to the thing), a by-city breakdown of the tuitions they posted, and how
// many of those are currently open / paused / closed. All from the audit log
// (no new tracking): job.post rows carry {title, city} in their detail and the
// job id as target_id; verification/message rows carry the member id as
// target_id, so the name comes from one profiles read.

const ACTION_METRIC: Record<string, StaffMetricKey> = {}
for (const m of STAFF_METRICS) for (const a of m.actions) ACTION_METRIC[a] = m.key

const ACTION_VERB: Record<string, string> = {
  'job.post': 'Posted a tuition',
  'tutor.approve': 'Approved a tutor',
  'parent.verify.approve': 'Approved a parent',
  'tutor.hold': 'Held a tutor video',
  'tutor.suspend': 'Suspended a tutor',
  'parent.verify.reject': 'Rejected a parent',
  'member.message': 'Messaged a member',
}

export type StaffDetailItem = {
  id: string
  action: string
  metric: StaffMetricKey
  /** The main line: a tuition title, or a member's name for a verification/message. */
  title: string
  /** The quieter line: the city for a tuition, or the action for a verification. */
  sub: string
  at: string
  /** The thing itself: the tuition or the member. */
  href: string
}

export type StaffDetail = {
  counts: StaffCounts
  items: StaffDetailItem[]
  cityCounts: { city: string; count: number }[]
  postedStatus: { open: number; paused: number; closed: number }
}

/**
 * One staff member's activity in full. `filter.action` (a metric key) and the
 * date window narrow the ITEM LIST only; the top counts are always the full
 * today / 7-day / total.
 */
export async function loadStaffDetail(
  actorId: string,
  filter: { metric?: StaffMetricKey | null; from?: string | null; to?: string | null } = {},
): Promise<StaffDetail> {
  const admin = createAdminClient()
  if (!admin) return { counts: emptyStaffCounts(), items: [], cityCounts: [], postedStatus: { open: 0, paused: 0, closed: 0 } }

  const { data: audit } = await admin
    .from('admin_audit_log')
    .select('id, action, created_at, target_id, detail')
    .eq('actor_id', actorId)
    .in('action', STAFF_METRIC_ACTIONS)
    .order('created_at', { ascending: false })
  const rows = audit ?? []

  const counts = tallyStaffActivity(
    rows.map((a) => ({ actorId, action: a.action as string, createdAt: a.created_at as string })),
  )

  // Enrich: the current status of posted tuitions (join by target_id) and the
  // names for verification/message rows (one read each).
  const jobIds = [...new Set(rows.filter((r) => r.action === 'job.post').map((r) => r.target_id as string).filter(Boolean))]
  const memberIds = [
    ...new Set(rows.filter((r) => r.action !== 'job.post').map((r) => r.target_id as string).filter(Boolean)),
  ]
  const none = ['00000000-0000-0000-0000-000000000000']
  const [{ data: jobs }, { data: profs }] = await Promise.all([
    admin.from('jobs').select('id, title, city, status').in('id', jobIds.length ? jobIds : none),
    admin.from('profiles').select('id, full_name').in('id', memberIds.length ? memberIds : none),
  ])
  const jobById = new Map((jobs ?? []).map((j) => [j.id as string, j]))
  const nameById = new Map((profs ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? '—']))

  // By-city breakdown + open/paused/closed of the tuitions they posted.
  const cityMap = new Map<string, number>()
  const postedStatus = { open: 0, paused: 0, closed: 0 }
  for (const r of rows) {
    if (r.action !== 'job.post') continue
    const detail = (r.detail as Record<string, unknown> | null) ?? {}
    const job = jobById.get(r.target_id as string)
    const city = ((job?.city as string | null) ?? (detail.city as string | null) ?? 'Unknown').trim() || 'Unknown'
    cityMap.set(city, (cityMap.get(city) ?? 0) + 1)
    const status = (job?.status as string | null) ?? null
    if (status === 'open') postedStatus.open++
    else if (status === 'paused') postedStatus.paused++
    else if (status === 'closed' || status === 'hired') postedStatus.closed++
  }
  const cityCounts = [...cityMap.entries()].map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count)

  // The item list, filtered by metric + date range.
  const fromT = filter.from ? Date.parse(filter.from) : null
  const toT = filter.to ? Date.parse(filter.to) : null
  const items: StaffDetailItem[] = []
  for (const r of rows) {
    const action = r.action as string
    const metric = ACTION_METRIC[action]
    if (!metric) continue
    if (filter.metric && metric !== filter.metric) continue
    const t = Date.parse(r.created_at as string)
    if (fromT && Number.isFinite(t) && t < fromT) continue
    if (toT && Number.isFinite(t) && t > toT) continue

    if (action === 'job.post') {
      const detail = (r.detail as Record<string, unknown> | null) ?? {}
      const job = jobById.get(r.target_id as string)
      const title = ((detail.title as string | null) ?? (job?.title as string | null) ?? 'Tuition').trim()
      const city = ((job?.city as string | null) ?? (detail.city as string | null) ?? '').trim()
      items.push({
        id: r.id as string,
        action,
        metric,
        title,
        sub: city || 'Tuition',
        at: r.created_at as string,
        href: `/admin/jobs/${r.target_id as string}`,
      })
    } else {
      const name = nameById.get(r.target_id as string) ?? '—'
      items.push({
        id: r.id as string,
        action,
        metric,
        title: name,
        sub: ACTION_VERB[action] ?? action,
        at: r.created_at as string,
        href: `/admin/users/${r.target_id as string}`,
      })
    }
  }

  return { counts: counts.get(actorId) ?? emptyStaffCounts(), items, cityCounts, postedStatus }
}
