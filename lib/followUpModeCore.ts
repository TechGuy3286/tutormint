// lib/followUpModeCore.ts — PURE rules of the "Start follow-ups" mode (owner,
// 23 Nov 2026 — PR-18 Part B). Unit tests: scripts/test-pr18.ts.
//
// One tutor at a time for a People stage (Documents missing first; any stage
// that is followed up works: missing, rejected, approved). Who is in the queue:
// the stage's "Not followed up (due now)" tutors (the same chip rule as the
// People page — lib/tutorPipelineCardCore followUpDue), not Not interested,
// not paused, no "No answer" retry still pending, with a number to message.
//
// The order:
//   1. (Documents missing only) the email sign-ups who were stuck at the mobile
//      screen before PR-17 fixed it — tutors with a real email address, no
//      verified mobile, who joined before 23 Nov 2026 (~170). Their typed
//      (unverified) number is used for WhatsApp, marked "Number not verified".
//   2. sign-ups of the last 14 days, newest first;
//   3. then everyone else, cities with the most open tuitions first, newest
//      sign-up first inside a city.
//
// Claims: a tutor shown to one staff member is held for 10 minutes (or until
// Sent / No answer / Not interested / Skip), so two staff never get the same
// tutor (member_work_claims, migration 245). An "I'm on it" of another staff
// member keeps the tutor out of everyone else's queue.

import type { FollowStage, PipeStage } from '@/lib/tutorPipelineCore'

export const MODE_STAGES = ['missing', 'rejected', 'approved'] as const satisfies readonly FollowStage[]
export const CLAIM_TTL_SECONDS = 600
export const RECENT_DAYS = 14
/** PR-17 removed the mobile-first gate on this day (Pakistan time). */
export const STUCK_BEFORE = '2026-11-23T00:00:00+05:00'
export const OUTCOMES = ['sent', 'no_answer', 'not_interested', 'skip'] as const
export type ModeOutcome = (typeof OUTCOMES)[number]
export const OUTCOME_LABEL: Record<ModeOutcome, string> = { sent: 'Sent', no_answer: 'No answer', not_interested: 'Not interested', skip: 'Skip' }

/** Where the WhatsApp link of each stage opens. Onboarding opens at the
 *  tutor's first unfinished step by itself (PR-17 resume). */
export const ONBOARDING_PATH = '/tutor/onboarding'

export type ModeCandidate = {
  id: string
  createdAt: string
  city: string | null
  /** A real email, no verified mobile, joined before STUCK_BEFORE. */
  stuck: boolean
}

export type ModeCardFacts = {
  stage: PipeStage
  section: 'not' | 'done' | null
  notInterested: boolean
  paused: boolean
  noMobile?: boolean
  retryAt?: string | null
}

/** Is this card due a follow-up now (the stage's Not followed up chip)? */
export function modeEligible(c: ModeCardFacts, opts: { stage: FollowStage; hasNumber: boolean; nowMs: number }): boolean {
  if (c.stage !== opts.stage) return false
  if (c.notInterested || c.paused) return false
  if (c.section !== 'not') return false
  if (c.retryAt && Date.parse(c.retryAt) > opts.nowMs) return false
  return opts.hasNumber
}

export function isStuckEmailSignup(p: { email: string | null; phoneVerifiedAt: string | null; createdAt: string; synthetic: boolean }): boolean {
  return !!p.email && !p.synthetic && !p.phoneVerifiedAt && Date.parse(p.createdAt) < Date.parse(STUCK_BEFORE)
}

const cityKey = (c: string | null) => (c ?? '').trim().toLowerCase()

/** The queue order (see the file header). Ties: newest sign-up first, then id. */
export function modeOrder(cands: ModeCandidate[], openByCity: Map<string, number>, stage: FollowStage, nowMs: number): ModeCandidate[] {
  const recentFrom = nowMs - RECENT_DAYS * 86_400_000
  const group = (c: ModeCandidate) => (stage === 'missing' && c.stuck ? 0 : Date.parse(c.createdAt) >= recentFrom ? 1 : 2)
  return cands.slice().sort((a, b) => {
    const g = group(a) - group(b)
    if (g !== 0) return g
    if (group(a) === 2) {
      const ca = openByCity.get(cityKey(a.city)) ?? 0
      const cb = openByCity.get(cityKey(b.city)) ?? 0
      if (ca !== cb) return cb - ca
    }
    const t = b.createdAt.localeCompare(a.createdAt)
    return t !== 0 ? t : a.id.localeCompare(b.id)
  })
}

/** "today", "1 day", "12 days". */
export function daysSince(iso: string | null | undefined, nowMs: number): string {
  const t = Date.parse(iso ?? '')
  if (!Number.isFinite(t)) return '—'
  const d = Math.max(0, Math.floor((nowMs - t) / 86_400_000))
  return d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`
}

/** The stage message with the Documents-missing link pointed at onboarding
 *  (which opens the first unfinished step). Other stages keep their link. */
export function modeMessage(stage: FollowStage, message: string, docsLink: string, onboardingLink: string): string {
  if (stage !== 'missing') return message
  return message.split(docsLink).join(onboardingLink)
}

/** "12 done this session". */
export function sessionLine(done: number): string {
  return `${done} done this session`
}
