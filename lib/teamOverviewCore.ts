// lib/teamOverviewCore.ts
//
// PURE rules for the Team overview card (owner, 24 Oct 2026): for each staff
// member, overdue Applications on their tuitions, red rows in Paid tutors in
// their cities, and follow-ups they sent today and in the last 7 days
// (Pakistan time). Shown to the Owner, the Project Managers and Supervisors.

import { DAY_MS, pkDayStart } from '@/lib/overviewTrendCore'

export type TeamOverviewRow = {
  staffId: string
  name: string
  overdueApplications: number
  redPaidTutors: number
  followUpsToday: number
  followUps7: number
}

export type FollowUpStamp = { staffId: string | null; at: string }

/** Today = since 00:00 Pakistan time; last 7 days = 00:00 six days ago → now. */
export function followUpWindows(stamps: FollowUpStamp[], nowMs: number): Map<string, { today: number; last7: number }> {
  const today = pkDayStart(nowMs)
  const week = today - 6 * DAY_MS
  const out = new Map<string, { today: number; last7: number }>()
  for (const s of stamps) {
    if (!s.staffId) continue
    const at = Date.parse(s.at)
    if (!Number.isFinite(at) || at < week || at > nowMs) continue
    const c = out.get(s.staffId) ?? { today: 0, last7: 0 }
    c.last7++
    if (at >= today) c.today++
    out.set(s.staffId, c)
  }
  return out
}

/** One row per staff member, the busiest (most overdue + red) first. */
export function buildTeamOverview(
  staff: { id: string; name: string }[],
  overdueBy: Map<string, number>,
  redBy: Map<string, number>,
  followUps: Map<string, { today: number; last7: number }>,
): TeamOverviewRow[] {
  return staff
    .map((s) => ({
      staffId: s.id,
      name: s.name,
      overdueApplications: overdueBy.get(s.id) ?? 0,
      redPaidTutors: redBy.get(s.id) ?? 0,
      followUpsToday: followUps.get(s.id)?.today ?? 0,
      followUps7: followUps.get(s.id)?.last7 ?? 0,
    }))
    .sort(
      (a, b) =>
        b.overdueApplications + b.redPaidTutors - (a.overdueApplications + a.redPaidTutors) ||
        b.followUps7 - a.followUps7 ||
        a.name.localeCompare(b.name),
    )
}

/** Count rows per owner (null owner ignored). */
export function countByOwner<T>(rows: T[], ownerOf: (r: T) => string | null | undefined, include: (r: T) => boolean): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    const o = ownerOf(r)
    if (!o || !include(r)) continue
    out.set(o, (out.get(o) ?? 0) + 1)
  }
  return out
}
