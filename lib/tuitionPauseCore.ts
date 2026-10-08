// lib/tuitionPauseCore.ts
//
// The pure batching rule behind the nightly tuition pause (owner, 8 Oct 2026).
//
// A tuition pauses 7 days after it was posted or last resumed. When the rule
// moved from 15 days to 7, hundreds of open tuitions were already past 7 days at
// once. Those are the BACKLOG — every tuition already due when the 7-day rule
// went live (BACKLOG_CUTOFF) — paused 150 a night, oldest first, never all at
// once. A tuition that crosses day 7 AFTER the cutoff is an ordinary pause and
// goes the same night, so the backlog never delays the ordinary rule. When no
// tuition due before the cutoff is left open, the backlog is cleared.

import { pauseDueAtMs } from '@/lib/tuitionStatus'

export const BACKLOG_BATCH = 150
/** The moment the 7-day rule went live (deploy of 8 Oct 2026, 20:40 UTC). A
 *  tuition already due by then is backlog; one due later is an ordinary pause. */
export const BACKLOG_CUTOFF_MS = Date.parse('2026-10-08T20:40:00Z')

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
