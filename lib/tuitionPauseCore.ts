// lib/tuitionPauseCore.ts
//
// The pure batching rule behind the nightly tuition pause (owner, 8 Oct 2026).
//
// A tuition pauses TUITION_LIVE_DAYS (20 since 21 Oct 2026) after it was posted or last resumed.
// When the rule moved from 7 days back to 15 (owner, 13 Oct 2026), every tuition
// live that day whose 15 days had already run out was given until LIVE_FLOOR_MS
// (3 days later). Those are the BACKLOG — every tuition due at the floor —
// paused 150 a night, oldest first, never all at once. A tuition that reaches
// day 15 AFTER the floor is an ordinary pause and goes the same night, so the
// backlog never delays the ordinary rule. When no tuition due at the floor is
// left open, the backlog is cleared.

import { pauseDueAtMs, LIVE_FLOOR_MS } from '@/lib/tuitionStatus'

export const BACKLOG_BATCH = 150
/** A tuition due at (or before) the floor is backlog; one due later is an
 *  ordinary pause. */
export const BACKLOG_CUTOFF_MS = LIVE_FLOOR_MS

export type PauseCandidate = { id: string; clockBase: string }

export function planPauseBatch<T extends PauseCandidate>(
  open: T[],
  now = Date.now(),
  batch = BACKLOG_BATCH,
  cutoffMs = BACKLOG_CUTOFF_MS,
): { regular: T[]; backlog: T[]; backlogLeft: number } {
  const due = open.filter((j) => pauseDueAtMs(j.clockBase) <= now)
  const regular = due.filter((j) => pauseDueAtMs(j.clockBase) > cutoffMs)
  const old = due
    .filter((j) => pauseDueAtMs(j.clockBase) <= cutoffMs)
    // Every backlog tuition is due at the same instant (the floor), so "oldest
    // first" is by the clock itself.
    .sort((a, b) => new Date(a.clockBase).getTime() - new Date(b.clockBase).getTime() || a.id.localeCompare(b.id))
  const backlog = old.slice(0, batch)
  return { regular, backlog, backlogLeft: old.length - backlog.length }
}

/** The next nightly run: the cron fires at 03:00 UTC every day. */
export function nextBatchAt(now = new Date()): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0, 0))
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next
}
