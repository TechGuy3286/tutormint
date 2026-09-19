// lib/staffActivityCore.ts
//
// The pure half of staff activity (PR29 §2): the metric→action mapping and the
// today / last-7-days / total tally. No I/O, so the windows are unit-tested
// (scripts/test-staffactivity.ts) without a database.
//
// Each metric maps to the admin_audit_log actions that record it:
//   posted    job.post
//   approved  tutor.approve (a tutor video/profile), parent.verify.approve
//   rejected  tutor.hold / tutor.suspend (a video not passed), parent.verify.reject
//   payments  payment.approve
//   messages  member.message (an official Team → member message)
// A metric counts an ACTOR's rows, not a target's — see lib/staffActivity.ts.

// 'Payments approved' was removed (PR31 §3): payments activate on submit, so
// nothing is approved any more.
export const STAFF_METRICS = [
  { key: 'posted', label: 'Tuitions posted', actions: ['job.post'] },
  { key: 'approved', label: 'Verifications approved', actions: ['tutor.approve', 'parent.verify.approve'] },
  { key: 'rejected', label: 'Verifications rejected', actions: ['tutor.hold', 'tutor.suspend', 'parent.verify.reject'] },
  { key: 'messages', label: 'Messages sent', actions: ['member.message'] },
] as const

export type StaffMetricKey = (typeof STAFF_METRICS)[number]['key']

/** Every action any metric counts, for the bounded audit-log query. */
export const STAFF_METRIC_ACTIONS: string[] = [...new Set(STAFF_METRICS.flatMap((m) => [...m.actions]))]

const ACTION_TO_METRIC: Record<string, StaffMetricKey> = {}
for (const m of STAFF_METRICS) for (const a of m.actions) ACTION_TO_METRIC[a] = m.key

export type CountWindow = { today: number; week: number; total: number }
export type StaffCounts = Record<StaffMetricKey, CountWindow>

export function emptyStaffCounts(): StaffCounts {
  const out = {} as StaffCounts
  for (const m of STAFF_METRICS) out[m.key] = { today: 0, week: 0, total: 0 }
  return out
}

// Pakistan is UTC+5, no DST — "today" is the calendar day in Karachi, which is
// what a member of staff means by it.
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000

function startOfKarachiToday(now: number): number {
  const shifted = now + KARACHI_OFFSET_MS
  const dayStart = Math.floor(shifted / 86_400_000) * 86_400_000
  return dayStart - KARACHI_OFFSET_MS
}

export type AuditRow = { actorId: string | null; action: string; createdAt: string }

/**
 * Tally audit rows into per-actor counts across the three windows. Rows outside
 * the metric set, without an actor, or with an unparseable date are skipped.
 */
export function tallyStaffActivity(rows: AuditRow[], now: number = Date.now()): Map<string, StaffCounts> {
  const startToday = startOfKarachiToday(now)
  const weekAgo = now - 7 * 86_400_000
  const map = new Map<string, StaffCounts>()

  for (const r of rows) {
    const metric = ACTION_TO_METRIC[r.action]
    if (!metric || !r.actorId) continue
    const t = Date.parse(r.createdAt)
    if (!Number.isFinite(t)) continue

    let c = map.get(r.actorId)
    if (!c) {
      c = emptyStaffCounts()
      map.set(r.actorId, c)
    }
    c[metric].total++
    if (t >= weekAgo) c[metric].week++
    if (t >= startToday) c[metric].today++
  }
  return map
}
