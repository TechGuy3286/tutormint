// lib/backendSupportKpiCore.ts — PURE (owner, 31 Oct 2026).
//
// The Backend Support KPI card: follow-ups sent today and in the last 7 days
// (Pakistan time), overdue To do (Applications), red Paid tutors, and how many
// of the applications they forwarded in the last 7 days were forwarded within
// 24 hours of the tutor applying.

import { DAY_MS, pkDayStart } from '@/lib/overviewTrendCore'

export const FORWARD_FAST_MS = 24 * 3_600_000

export type BackendSupportKpi = {
  followUpsToday: number
  followUps7: number
  overdueTodo: number
  redPaidTutors: number
  forwarded7: number
  forwardedWithin24h: number
}

/** Stamps of the staff member's own sends (member + application follow-ups). */
export function followUpCounts(stamps: string[], nowMs: number): { today: number; last7: number } {
  const today = pkDayStart(nowMs)
  const week = today - 6 * DAY_MS
  let t = 0
  let w = 0
  for (const s of stamps) {
    const at = Date.parse(s)
    if (!Number.isFinite(at) || at < week || at > nowMs) continue
    w++
    if (at >= today) t++
  }
  return { today: t, last7: w }
}

/**
 * Each (forward, tutor) pair the staff member sent in the last 7 days, with the
 * time that tutor applied to that tuition. A pair whose application time is
 * unknown (the tutor only viewed the number) is left out of both counts.
 */
export function forwardSpeed(pairs: { forwardedAt: string; appliedAt: string | null }[], nowMs: number): { forwarded: number; within24h: number } {
  const week = pkDayStart(nowMs) - 6 * DAY_MS
  let forwarded = 0
  let fast = 0
  for (const p of pairs) {
    const f = Date.parse(p.forwardedAt)
    if (!Number.isFinite(f) || f < week || f > nowMs || !p.appliedAt) continue
    const a = Date.parse(p.appliedAt)
    if (!Number.isFinite(a)) continue
    forwarded++
    if (f - a <= FORWARD_FAST_MS) fast++
  }
  return { forwarded, within24h: fast }
}

export function forwardSpeedLabel(k: Pick<BackendSupportKpi, 'forwarded7' | 'forwardedWithin24h'>): string {
  if (k.forwarded7 === 0) return 'No forwards in the last 7 days'
  return `${k.forwardedWithin24h} of ${k.forwarded7} within 24 hours`
}
