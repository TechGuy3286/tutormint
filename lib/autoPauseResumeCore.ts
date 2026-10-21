// lib/autoPauseResumeCore.ts
//
// The one-time resume after the live period moved from 15 to 20 days (owner,
// 21 Oct 2026) — the PURE rule. A tuition the old 15-day rule paused that is
// still under 20 days old (counted from coalesce(resumed_at, created_at)) goes
// back live, keeping its own clock, so it pauses on its own day 20.
//
// ONLY the age-based auto-pause: pause_source 'auto' (an ordinary nightly
// pause) or 'backlog' (the 150-a-night backlog). Never a pause by staff
// ('admin'), the poster ('poster', 'self', self_paused_at), "No contact number"
// ('no_contact'), a merged repeat, a closed or hired tuition, or a poster who
// is suspended, banned or has paused their own account. A tuition with no
// valid contact number cannot go live (12 Oct 2026), so it stays paused.

import { pauseDueAtMs } from './tuitionStatus'
import { tuitionContactNumber, type TuitionContactFacts } from './tuitionContactCore'

/** The pause sources the age rule writes. */
export const AGE_PAUSE_SOURCES = ['auto', 'backlog'] as const

export type ResumeCandidate = TuitionContactFacts & {
  id: string
  status: string
  pauseSource: string | null
  selfPausedAt: string | null
  mergedInto: string | null
  createdAt: string
  resumedAt: string | null
  posterSuspended: boolean
  posterBanned: boolean
  posterPausedByUser: boolean
}

export type ResumeVerdict = 'resume' | 'not_age_pause' | 'too_old' | 'no_contact' | 'poster_unavailable'

export function resumeVerdict(j: ResumeCandidate, now = Date.now()): ResumeVerdict {
  if (j.status !== 'paused') return 'not_age_pause'
  if (!(AGE_PAUSE_SOURCES as readonly string[]).includes(j.pauseSource ?? '')) return 'not_age_pause'
  if (j.selfPausedAt || j.mergedInto) return 'not_age_pause'
  if (pauseDueAtMs(j.resumedAt ?? j.createdAt) <= now) return 'too_old'
  if (j.posterSuspended || j.posterBanned || j.posterPausedByUser) return 'poster_unavailable'
  if (tuitionContactNumber(j) === null) return 'no_contact'
  return 'resume'
}
