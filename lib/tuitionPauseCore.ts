// lib/tuitionPauseCore.ts
//
// The pure batching rule behind the nightly tuition pause (owner, 8 Oct 2026).
//
// A tuition pauses 7 days after it was posted or last resumed. When the rule
// moved from 15 days to 7, hundreds of open tuitions were already past 7 days at
// once. Those are the BACKLOG: they are paused 150 a night, oldest first, never
// all at once. A tuition that became due recently (inside FRESH_WINDOW) is a
// normal pause and always goes the same night, so the backlog never delays the
// ordinary rule. When nothing older than the window is left, the backlog is
// cleared and every night is an ordinary night.

import { pauseDueAtMs } from '@/lib/tuitionStatus'

export const BACKLOG_BATCH = 150
/** A due date inside this window is an ordinary pause (the cron runs daily;
 *  36h absorbs a late or skipped run). Older due dates are backlog. */
export const FRESH_WINDOW_MS = 36 * 3600_000

export type PauseCandidate = { id: string; clockBase: string }

export function planPauseBatch<T extends PauseCandidate>(
  open: T[],
  now = Date.now(),
  batch = BACKLOG_BATCH,
): { regular: T[]; backlog: T[]; backlogLeft: number } {
  const due = open.filter((j) => pauseDueAtMs(j.clockBase) <= now)
  const regular = due.filter((j) => now - pauseDueAtMs(j.clockBase) <= FRESH_WINDOW_MS)
  const old = due
    .filter((j) => now - pauseDueAtMs(j.clockBase) > FRESH_WINDOW_MS)
    .sort((a, b) => pauseDueAtMs(a.clockBase) - pauseDueAtMs(b.clockBase) || a.id.localeCompare(b.id))
  const backlog = old.slice(0, batch)
  return { regular, backlog, backlogLeft: old.length - backlog.length }
}

/** The next nightly run: the cron fires at 03:00 UTC every day. */
export function nextBatchAt(now = new Date()): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0, 0))
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next
}
