// lib/staffOutreachCore.ts
//
// The PURE half of two staff outreach tabs under Admin → People (owner,
// 8 Oct 2026). No I/O, so the rules are unit-tested (scripts/test-outreach.ts).
//
//   Unpaid signups     tutors in their first 30 days who have not paid the
//                      Spam Free Platform Fee — who to call, and what happened.
//   Featured WhatsApp  Featured tutors with new matching open tuitions since
//                      their last WhatsApp send, and the prefilled message.

import { genderApplyBlocked } from '@/lib/genderPref'
import { isOnlineType, matchVisibility } from '@/lib/matchChip'

// ------------------------------------------------------------ test accounts
/** A test/fixture account by NAME — the rule the owner's test-account pause
 *  used (5 Oct 2026): "test" as a whole word, or exactly "New User". */
export function isTestName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim()
  return /\btest\b/i.test(n) || /^new user$/i.test(n)
}

// ------------------------------------------------------------ unpaid signups
export const UNPAID_WINDOW_DAYS = 30

export const CONTACT_OUTCOMES = ['called', 'no_answer', 'needs_help', 'will_pay_later', 'not_interested'] as const
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number]

export const OUTCOME_LABEL: Record<ContactOutcome, string> = {
  called: 'Called',
  no_answer: 'No answer',
  needs_help: 'Needs help',
  will_pay_later: 'Will pay later',
  not_interested: 'Not interested',
}

/** The onboarding step label the fee step carries (lib/onboardingStopCore). */
export const PAYMENT_STEP_LABEL = 'Verification fee'

export type UnpaidFilter = 'all' | 'payment' | 'onboarding' | 'uncontacted' | 'followed'

export function parseUnpaidFilter(v: string | null | undefined): UnpaidFilter {
  return v === 'payment' || v === 'onboarding' || v === 'uncontacted' || v === 'followed' ? v : 'all'
}

/** Does a row pass the chosen filter? `stoppedAt` is null when every onboarding
 *  step is done (only the fee is left would read 'Verification fee'). */
export function unpaidRowMatches(
  row: { stoppedAt: string | null; lastContactAt: string | null; followUpSent?: boolean },
  filter: UnpaidFilter,
): boolean {
  // Followed up in the last 7 days → only the "Follow-up sent" tab (owner,
  // 9 Oct 2026, the shared lib/followUpCore rule).
  if (filter === 'followed') return !!row.followUpSent
  if (row.followUpSent) return false
  if (filter === 'payment') return row.stoppedAt === PAYMENT_STEP_LABEL || row.stoppedAt === null
  if (filter === 'onboarding') return row.stoppedAt !== null && row.stoppedAt !== PAYMENT_STEP_LABEL
  if (filter === 'uncontacted') return row.lastContactAt === null
  return true
}

/** The short help message an unpaid signup gets on WhatsApp (English + Urdu). */
export function unpaidHelpMessage(firstName: string, stoppedAt: string | null): string {
  const where = stoppedAt && stoppedAt !== PAYMENT_STEP_LABEL ? ` We saw you stopped at "${stoppedAt}".` : ''
  return [
    `Assalam-o-Alaikum ${firstName}, this is the TutorMint team.${where} Can we help you finish your profile?`,
    'السلام علیکم، ٹیوٹرمنٹ ٹیم۔ کیا ہم پروفائل مکمل کرنے میں آپ کی مدد کریں؟',
  ].join('\n')
}

// ------------------------------------------------------ Featured WhatsApp
export const FEATURED_FIRST_LOOKBACK_DAYS = 7
export const FEATURED_MAX_TUITIONS = 5
/** The list refreshes once a day at 10:00 Pakistan time (05:00 UTC). */
export const FEATURED_REFRESH_UTC_HOUR = 5

/** The most recent 10:00 PKT at or before `now` — the list's cut-off. Tuitions
 *  posted after it wait for the next day's list, so the list is stable all day. */
export function featuredCutoff(now: Date): Date {
  const c = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), FEATURED_REFRESH_UTC_HOUR))
  if (c.getTime() > now.getTime()) c.setUTCDate(c.getUTCDate() - 1)
  return c
}

export type MatchJob = { masterIds: number[]; city: string | null; jobType: string | null; genderPreference: string | null }
export type MatchTutor = { masterIds: number[]; city: string | null; jobTypes: string[] | null; gender: string | null }

/**
 * The SAME rule the in-app match notification and the Premium/Featured match
 * email use (lib/jobs.ts notifyMatchingTutors): a shared subject, the tutor's
 * gender not excluded by the tuition's preference, and either the same city
 * (with the tutor's job types allowing the tuition's) or an ONLINE tuition that
 * the tutor can teach online from another city.
 */
export function tutorMatchesJob(job: MatchJob, tutor: MatchTutor): boolean {
  if (!job.city) return false
  const mine = new Set(tutor.masterIds)
  if (!job.masterIds.some((id) => mine.has(id))) return false
  if (job.genderPreference && genderApplyBlocked(job.genderPreference, tutor.gender)) return false
  const jobType = job.jobType || 'Home Tutor'
  if (tutor.city === job.city) return matchVisibility(jobType, job.city, tutor.jobTypes, job.city) !== 'exclude'
  return isOnlineType(jobType) && matchVisibility(jobType, job.city, tutor.jobTypes, tutor.city) === 'online'
}

export type WaTuition = { title: string; area: string | null; city: string | null; url: string }

/** The prefilled WhatsApp message to a Featured tutor. Up to 5 tuitions —
 *  title, area, city, link — and never a parent contact detail. */
export function featuredMessage(firstName: string, tuitions: WaTuition[]): string {
  const lines = [`Assalam-o-Alaikum ${firstName}! New tuitions matching your profile on TutorMint:`, '']
  tuitions.slice(0, FEATURED_MAX_TUITIONS).forEach((t, i) => {
    const place = [t.area, t.city].filter(Boolean).join(', ')
    lines.push(`${i + 1}. ${t.title}${place ? ` — ${place}` : ''}`)
    lines.push(t.url)
  })
  lines.push('', 'Apply on TutorMint.', 'آپ کے لیے نئی ٹیوشنز — ٹیوٹرمنٹ پر اپلائی کریں۔')
  return lines.join('\n')
}

/** wa.me link for a Pakistani MSISDN (923001234567) with a prefilled text. */
export function waLink(msisdn: string, text: string): string {
  return `https://wa.me/${msisdn}?text=${encodeURIComponent(text)}`
}

export function firstNameOf(full: string | null | undefined): string {
  return (full ?? '').trim().split(/\s+/)[0] || 'there'
}

// ------------------------------------------------------------ Overview
/** Order of the stuck-in-onboarding breakdown follows the onboarding itself. */
export function stuckBreakdown(stops: (string | null)[]): { total: number; detail: string } {
  const counts = new Map<string, number>()
  for (const s of stops) {
    if (!s || s === PAYMENT_STEP_LABEL) continue
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return { total: parts.reduce((n, [, c]) => n + c, 0), detail: parts.map(([s, c]) => `${s} ${c}`).join(' · ') }
}

export type FunnelStep = { label: string; count: number; lostPct: number | null }

/** % lost from one step to the next (null for the first step or an empty one). */
export function funnelSteps(counts: number[], labels: string[]): FunnelStep[] {
  return counts.map((count, i) => {
    const prev = i === 0 ? null : counts[i - 1]
    const lostPct = prev === null || prev === 0 ? null : Math.round(((prev - count) / prev) * 100)
    return { label: labels[i], count, lostPct }
  })
}

