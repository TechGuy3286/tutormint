// lib/parentInterestCore.ts — PURE (owner, 18 Nov 2026 — PR-08).
//
// Parent-interest teasers: a parent shortlisted a tutor, or tried to message
// them or ask for a demo (also when the attempt could not reach an unpaid
// tutor). Every rule lives here so the routes, the daily cron, the backfill,
// the WhatsApp updates queue, the Owner's "Held activity" panel and the tests
// read one definition. No I/O.
//
// HONEST BY CONSTRUCTION. An alert is built only from real event rows of real
// parent accounts; staff, test, seed, team, hidden and erased accounts never
// count, nor does a parent whose activity is held by the burst check. No events
// → no alert. Nothing is inflated: a parent counts once per tutor however many
// times they pressed the heart.
//
// PRIVACY. A parent shows only as blurName() ("S**** K****") and their city or
// area. Never a phone, email or address.
//
// Unit-tested by scripts/test-parent-interest.ts.

import { blurName, DAY_MS, pkDayStartMs, safePlace, type TeaserText } from '@/lib/tutorTeasersCore'

export type InterestKind = 'shortlist' | 'message' | 'demo'
export type BlockedWhy = 'tutor_unpaid' | 'parent_gate' | 'cap' | 'other'

export type InterestEvent = {
  id: string
  tutorId: string
  parentId: string
  kind: InterestKind
  createdAt: string
  source: 'live' | 'backfill'
  alertedAt: string | null
}

/** The in-app alert kind; counts towards the weekly teaser cap, at most one a day. */
export const PARENT_INTEREST_KIND = 'teaser_parent_interest' as const

/** The backfill reads this far back. */
export const BACKFILL_DAYS = 30
/** An event not yet alerted stays usable this long (the backfill is sent over
 *  several days, so it may be delivered a little after its 30th day). */
export const EVENT_USABLE_DAYS = 45
/** Backfill alerts are spread out: at most this many tutors a day get an alert
 *  made only of backfilled events. */
export const BACKFILL_TUTORS_PER_DAY = 40

// ------------------------------------------------------------- burst check ---

export const BURST_LIMIT = 20
export const BURST_WINDOW_MS = 3_600_000

export type Burst = { windowStart: string; shortlists: number; attempts: number }

/**
 * Did one parent create MORE than 20 shortlists, or more than 20 message/demo
 * attempts, inside any one hour? Returns the busiest such window, else null.
 * A sliding window over the parent's own events (any tutor).
 */
export function burstOf(events: { kind: InterestKind; createdAt: string }[]): Burst | null {
  const sorted = events
    .map((e) => ({ k: e.kind === 'shortlist' ? ('s' as const) : ('a' as const), t: Date.parse(e.createdAt) }))
    .filter((e) => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t)
  let best: Burst | null = null
  for (const group of ['s', 'a'] as const) {
    const ts = sorted.filter((e) => e.k === group).map((e) => e.t)
    let lo = 0
    for (let hi = 0; hi < ts.length; hi++) {
      while (ts[hi] - ts[lo] >= BURST_WINDOW_MS) lo++
      const n = hi - lo + 1
      if (n > BURST_LIMIT) {
        const start = ts[lo]
        const inWin = sorted.filter((e) => e.t >= start && e.t < start + BURST_WINDOW_MS)
        const cand: Burst = {
          windowStart: new Date(start).toISOString(),
          shortlists: inWin.filter((e) => e.k === 's').length,
          attempts: inWin.filter((e) => e.k === 'a').length,
        }
        if (!best || cand.shortlists + cand.attempts > best.shortlists + best.attempts) best = cand
      }
    }
  }
  return best
}

export type HoldStatus = 'held' | 'released' | 'kept'
export type Hold = { status: HoldStatus; decidedAt: string | null }

/**
 * What a burst does to the parent's hold. New burst, no hold → held (the
 * default). A released account bursting again AFTER the release → held again.
 * Held or kept → unchanged. No burst → unchanged.
 */
export function holdAfterBurst(cur: Hold | null, burst: Burst | null): 'create' | 'rehold' | null {
  if (!burst) return null
  if (!cur) return 'create'
  if (cur.status === 'released') {
    const decided = cur.decidedAt ? Date.parse(cur.decidedAt) : NaN
    const start = Date.parse(burst.windowStart)
    if (!Number.isFinite(decided) || start > decided) return 'rehold'
  }
  return null
}

/** Is this parent's activity held from teasers? Held and Kept held are; Released is not. */
export function isHeld(h: Hold | null | undefined): boolean {
  return !!h && (h.status === 'held' || h.status === 'kept')
}

/** The Owner's two decisions. Release frees the events; Keep held keeps them out. */
export function decideHold(cur: Hold | null, decision: 'release' | 'keep'): { status: HoldStatus } | { error: string } {
  if (!cur) return { error: 'That account is not held.' }
  const status: HoldStatus = decision === 'release' ? 'released' : 'kept'
  if (cur.status === status) return { error: decision === 'release' ? 'That account was already released.' : 'That account is already kept held.' }
  return { status }
}

// ------------------------------------------------------------ who counts ---

export type ParentFacts = {
  role: string | null
  staff?: boolean
  isSeed?: boolean | null
  isTeam?: boolean | null
  isTestName?: boolean | null
  hidden?: boolean | null
  mergedInto?: string | null
  /** account_erasures scheduled or done. */
  erased?: boolean
}

/** May this account's activity feed a teaser? Real parents (and academies) only. */
export function parentCounts(p: ParentFacts | null | undefined): boolean {
  if (!p) return false
  if (p.staff || p.role === 'admin') return false
  if (p.role !== 'parent') return false
  if (p.isSeed || p.isTeam || p.isTestName || p.hidden || p.mergedInto || p.erased) return false
  return true
}

/**
 * The events that may go into today's alert for one tutor: not yet alerted,
 * not too old, from a parent who counts and is not held, and not the tutor
 * acting on themselves.
 */
export function usableEvents(
  events: InterestEvent[],
  p: { nowMs: number; countsParent: (id: string) => boolean; held: (id: string) => boolean },
): InterestEvent[] {
  const from = p.nowMs - EVENT_USABLE_DAYS * DAY_MS
  return events.filter(
    (e) =>
      !e.alertedAt &&
      e.parentId !== e.tutorId &&
      Date.parse(e.createdAt) >= from &&
      Date.parse(e.createdAt) <= p.nowMs &&
      p.countsParent(e.parentId) &&
      !p.held(e.parentId),
  )
}

// ---------------------------------------------------------------- wording ---

export type InterestParent = { name: string | null; city: string | null; area: string | null; kinds: InterestKind[] }

/** One entry per parent, newest first, with every kind they did. */
export function groupByParent(events: InterestEvent[], parents: Map<string, { name: string | null; city: string | null; area: string | null }>): InterestParent[] {
  const by = new Map<string, { at: string; kinds: Set<InterestKind> }>()
  for (const e of events) {
    const cur = by.get(e.parentId) ?? { at: e.createdAt, kinds: new Set<InterestKind>() }
    cur.kinds.add(e.kind)
    if (e.createdAt > cur.at) cur.at = e.createdAt
    by.set(e.parentId, cur)
  }
  return [...by.entries()]
    .sort((a, b) => b[1].at.localeCompare(a[1].at))
    .map(([id, v]) => {
      const p = parents.get(id)
      return { name: p?.name ?? null, city: p?.city ?? null, area: p?.area ?? null, kinds: [...v.kinds].sort() as InterestKind[] }
    })
}

export const INTEREST_NAMES_SHOWN = 3
export const GET_VERIFIED_LINE = 'Get verified so parents can contact you.'
export const VERIFY_HREF = '/tutor/complete-profile?step=verify'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "Lahore" when every parent is from one place (city first — areas are too fine
 *  for a group), else null. */
export function interestFrom(parents: InterestParent[]): string | null {
  const places = [...new Set(parents.map((p) => safePlace(p.city) ?? safePlace(p.area)).filter((v): v is string => !!v))]
  return places.length === 1 ? places[0] : null
}

/**
 * The grouped alert. Unpaid:
 *   "❤️ 2 parents from Lahore shortlisted your profile: J**** A****, S**** K****"
 *   body "Get verified so parents can contact you."
 * Paid: the same title, no verify line. Contact attempts read "tried to
 * contact you" (unpaid — it could not reach them) or "contacted you" (paid).
 * Both kinds: "showed interest in your profile" and a count line. Null when
 * there are no parents.
 */
export function interestTeaser(parents: InterestParent[], paid: boolean): TeaserText | null {
  const n = parents.length
  if (n === 0) return null
  const shortlisted = parents.filter((p) => p.kinds.includes('shortlist')).length
  const contacted = parents.filter((p) => p.kinds.includes('message') || p.kinds.includes('demo')).length
  const from = interestFrom(parents)
  const who = `${plural(n, 'parent', 'parents')}${from ? ` from ${from}` : ''}`
  const contactWords = paid ? 'contacted you' : 'tried to contact you'
  const verb = contacted === 0 ? 'shortlisted your profile' : shortlisted === 0 ? contactWords : 'showed interest in your profile'
  const names = parents.slice(0, INTEREST_NAMES_SHOWN).map((p) => blurName(p.name))
  const more = n - names.length
  const list = `${names.join(', ')}${more > 0 ? ` and ${plural(more, 'more', 'more')}` : ''}`
  const title = `❤️ ${who} ${verb}: ${list}`
  const parts: string[] = []
  if (shortlisted > 0 && contacted > 0) parts.push(`${shortlisted} shortlisted you · ${contacted} ${contactWords}.`)
  if (!paid) parts.push(GET_VERIFIED_LINE)
  return {
    title,
    body: parts.length ? parts.join(' ') : null,
    href: paid ? (contacted > 0 ? '/messages' : '/tutor/dashboard') : VERIFY_HREF,
  }
}

// ---------------------------------------------------------------- backfill ---

/**
 * Which tutors may get an alert made ONLY of backfilled events today: the
 * newest activity first, at most BACKFILL_TUTORS_PER_DAY. A tutor with any live
 * (new) event is never held back by this — their alert goes on the usual rules.
 */
export function backfillPicks(byTutor: Map<string, InterestEvent[]>, limit = BACKFILL_TUTORS_PER_DAY): Set<string> {
  const onlyBackfill = [...byTutor.entries()].filter(([, ev]) => ev.length > 0 && ev.every((e) => e.source === 'backfill'))
  onlyBackfill.sort((a, b) => {
    const la = a[1].map((e) => e.createdAt).sort().pop() ?? ''
    const lb = b[1].map((e) => e.createdAt).sort().pop() ?? ''
    return lb.localeCompare(la) || a[0].localeCompare(b[0])
  })
  return new Set(onlyBackfill.slice(0, Math.max(0, limit)).map(([id]) => id))
}

/** Was a parent-interest alert already sent today (Pakistan)? */
export function interestSentToday(log: { kind: string; created_at: string }[], nowMs: number): boolean {
  const start = pkDayStartMs(nowMs)
  return log.some((l) => l.kind === PARENT_INTEREST_KIND && Date.parse(l.created_at) >= start)
}

// -------------------------------------------------- unpaid apply line (PR-08) ---

/** The new-tuitions teaser's body for an unpaid tutor: whichever step stands
 *  between them and Apply. */
export function unpaidApplyLine(profileComplete: boolean): { body: string; href: string } {
  return profileComplete
    ? { body: 'Pay the Verification Fee to apply.', href: VERIFY_HREF }
    : { body: 'Finish your profile to apply.', href: '/tutor/complete-profile' }
}

// ------------------------------------------- WhatsApp queue, unpaid rows ---
//
// PR-10 (owner, 19 Nov 2026): PR-08's unpaid rows (priority by People stage,
// 50 a day) moved into the Parent interest inbox (lib/interestInboxCore —
// hottest first, the same 50-a-day cap: INBOX_UNPAID_DAILY_CAP).
