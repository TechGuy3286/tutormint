// lib/signupFunnelCore.ts
//
// PURE. The daily sign-up funnel on Admin → Overview (owner, 15 Oct 2026).
//
// What is counted as a page visit: a signed-out visitor's page view in a real
// browser — the existing bot / own-crawler rules (lib/searchCountCore) decide.
// Counts only: no visitor id, no IP, nothing personal is stored.

import { isBotUserAgent, isOwnCrawler } from '@/lib/searchCountCore'

export type VisitKind = 'public_page' | 'register_page' | 'signup_tutor' | 'signup_parent'

/** Is this request a real browser we count? */
export function countsAsVisit(userAgent: string | null | undefined): boolean {
  return !isOwnCrawler(userAgent) && !isBotUserAgent(userAgent)
}

/** Which counters one page view adds to. Every page is a public page visit;
 *  /register is also a register visit. Anything that is not a site path adds
 *  nothing. */
export function visitKindsFor(pathname: string | null | undefined): VisitKind[] {
  const p = (pathname ?? '').split('?')[0].replace(/\/+$/, '') || '/'
  if (!p.startsWith('/') || p.startsWith('//') || p.startsWith('/api/') || p.startsWith('/admin')) return []
  return p === '/register' ? ['public_page', 'register_page'] : ['public_page']
}

/** `gained` (PR-22): the step is HIGHER than the one before (only possible
 *  where steps are not one cohort, e.g. visits → sign-up forms): it is never
 *  shown as a loss, so a "−0%" can never appear next to a rising number. */
export type FunnelStep = { key: string; label: string; count: number; lost: number | null; lostPct: number | null; gained: number | null }

/** One window's steps with the drop between each step and the one before. */
export function funnelSteps(steps: { key: string; label: string; count: number }[]): FunnelStep[] {
  return steps.map((s, i) => {
    if (i === 0) return { ...s, lost: null, lostPct: null, gained: null }
    const prev = steps[i - 1].count
    if (s.count > prev) return { ...s, lost: null, lostPct: null, gained: s.count - prev }
    const lost = prev - s.count
    return { ...s, lost, lostPct: prev > 0 ? Math.round((lost / prev) * 100) : null, gained: null }
  })
}

/** The words beside a step: "−12 (40%)", "No drop", "+3", or nothing (step 1,
 *  or nothing before it). Never "−0%". */
export function stepChange(s: Pick<FunnelStep, 'lost' | 'lostPct' | 'gained'>): { text: string; tone: 'lost' | 'none' | 'gained' } | null {
  if (s.gained != null && s.gained > 0) return { text: `+${s.gained}`, tone: 'gained' }
  if (s.lost == null || s.lostPct == null) return null
  if (s.lost === 0) return { text: 'No drop', tone: 'none' }
  return { text: `−${s.lost} (${s.lostPct}%)`, tone: 'lost' }
}

/**
 * A cohort funnel (PR-22): each person's yes/no per step, in the order of the
 * flow; a person counts at a step only when they reached EVERY step before it,
 * so each step is a subset of the one before ("of those who reached the
 * previous step") and can never be higher.
 */
export function cohortFunnel(people: readonly (readonly boolean[])[], steps: number): number[] {
  const n = Array.from({ length: steps }, () => 0)
  for (const flags of people) {
    for (let i = 0; i < steps; i++) {
      if (!flags[i]) break
      n[i]++
    }
  }
  return n
}

const DAY_MS = 86_400_000
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000

/** The Pakistan-time calendar day of an instant, as YYYY-MM-DD. */
export function pktDay(ms: number): string {
  return new Date(ms + PKT_OFFSET_MS).toISOString().slice(0, 10)
}

export type FunnelWindow = { key: 'today' | 'yesterday' | 'last7'; label: string; days: string[]; fromMs: number; toMs: number }

/** Today, Yesterday and the Last 7 days (today and the six days before it). */
export function funnelWindows(nowMs: number): FunnelWindow[] {
  const local = nowMs + PKT_OFFSET_MS
  const todayStart = local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - PKT_OFFSET_MS
  const days = (n: number) => Array.from({ length: n }, (_, i) => pktDay(todayStart - i * DAY_MS))
  return [
    { key: 'today', label: 'Today', days: [pktDay(todayStart)], fromMs: todayStart, toMs: nowMs },
    { key: 'yesterday', label: 'Yesterday', days: [pktDay(todayStart - DAY_MS)], fromMs: todayStart - DAY_MS, toMs: todayStart },
    { key: 'last7', label: 'Last 7 days', days: days(7), fromMs: todayStart - 6 * DAY_MS, toMs: nowMs },
  ]
}
