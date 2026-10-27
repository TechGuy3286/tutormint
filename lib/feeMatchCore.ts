// lib/feeMatchCore.ts — PURE, client-safe (owner, 27 Oct 2026).
//
// Payment auto-linking. Most tutors send Rs 200 for the Rs 199 Verification
// Fee, and bank credits are often added AFTER the tutor's receipt was approved,
// so the old exact-amount match left them in Finance → Needs attention.
//
//   • Fee match range (app_settings pay.fee_match_min / max, default 199–210):
//     a credit in range counts as a Verification Fee payment; the extra is
//     "rounding", recorded on the payment, never a problem.
//   • A new credit is linked AUTOMATICALLY to a member's approved fee payment
//     that has no credit yet when the amount is in range, it is within 48 hours
//     of the payment, and the sender name matches the member's name (case,
//     spacing, dots and prefixes such as Muhammad / M. ignored). In range and
//     in time but a different name → a one-tap suggestion, never a link.
//   • Approving a receipt attaches the closest unlinked in-range credit within
//     48 hours (approvalPick).
//   • A credit below the range is "Partial — Rs X short" and never activates.
//
// The I/O half is lib/feeMatch.ts. Unit-tested by scripts/test-fee-match.ts.

export type FeeRange = { min: number; max: number }

export const FEE_MATCH_DEFAULT: FeeRange = { min: 199, max: 210 }
export const FEE_MIN_KEY = 'pay.fee_match_min'
export const FEE_MAX_KEY = 'pay.fee_match_max'
export const AUTO_LINK_WINDOW_MS = 48 * 3_600_000

/** A note on a stored link that the automatic rule made, and the refund-due hold. */
export const AUTO_LINK_NOTE_PREFIX = 'Automatic fee match'
export const REFUND_DUE_TARGET = 'refund_due'
/** How the board says a credit was matched by the fee-range + name rule. */
export const FEE_NAME_HOW = 'Fee range and sender name, within 48 hours'

const round2 = (n: number) => Math.round(n * 100) / 100

/** The stored setting, or the default when either end is missing or nonsense. */
export function parseFeeRange(minRaw: unknown, maxRaw: unknown): FeeRange {
  const min = Number(minRaw)
  const max = Number(maxRaw)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min || max > 100_000) return { ...FEE_MATCH_DEFAULT }
  return { min: round2(min), max: round2(max) }
}

/** What the Owner may save: whole or paisa rupees, min ≤ max, sane size. */
export function feeRangeProblem(min: number, max: number, feePrice: number): string | null {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0) return 'Enter both amounts.'
  if (max < min) return 'The highest amount must be at least the lowest.'
  if (max > feePrice * 2) return 'The highest amount cannot be more than twice the fee.'
  if (min > feePrice) return 'The lowest amount cannot be more than the fee.'
  return null
}

export function inFeeRange(amount: number, r: FeeRange): boolean {
  return amount >= r.min - 0.005 && amount <= r.max + 0.005
}

/** The extra above the price ("rounding"), never negative. */
export function roundingOf(creditAmount: number, price: number): number {
  return Math.max(0, round2(creditAmount - price))
}

/** Below the range: how much short of the fee price it is, else null. */
export function partialShort(amount: number, r: FeeRange, feePrice: number): number | null {
  if (!(amount > 0) || amount >= r.min - 0.005) return null
  return round2(Math.max(r.min, feePrice) - amount)
}

export function partialLabel(short: number): string {
  return `Partial — Rs ${short.toLocaleString('en-PK', { maximumFractionDigits: 2 })} short`
}

// ------------------------------------------------------------------ names

/** Words that are not part of telling two people apart. */
const PREFIXES = new Set([
  'muhammad', 'mohammad', 'muhammed', 'mohammed', 'mohamad', 'muhamad', 'mohd', 'muhd', 'md', 'm',
  'syed', 'sayed', 'sayyed', 'hafiz', 'mr', 'mrs', 'ms', 'miss', 'dr', 'mst', 'ch', 'chaudhry',
])

/** A name as comparable words: lower case, dots and punctuation as spaces,
 *  prefixes (Muhammad, M., Syed, Mr …) removed. */
export function nameTokens(name: string | null | undefined): string[] {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 0 && !PREFIXES.has(t))
}

/**
 * Do these two names belong to the same person? Every word of the shorter
 * name must be in the longer one; a one-word name must equal a one-word name
 * (one shared word alone is too weak); at least one word of three letters.
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = nameTokens(a)
  const y = nameTokens(b)
  if (x.length === 0 || y.length === 0) return false
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (!short.some((t) => t.length >= 3)) return false
  if (short.length === 1 && long.length > 1) return false
  const pool = [...long]
  for (const t of short) {
    const i = pool.indexOf(t)
    if (i < 0) return false
    pool.splice(i, 1)
  }
  return true
}

/** How many name words two names share (for ordering suggestions). */
export function sharedWords(a: string | null | undefined, b: string | null | undefined): number {
  const y = new Set(nameTokens(b))
  return nameTokens(a).filter((t) => t.length >= 3 && y.has(t)).length
}

// ------------------------------------------------------------------ times

/** The instant a credit's money arrived (Pakistan time); noon when no time. */
export function creditInstantMs(date: string, time: string | null | undefined): number {
  const hhmm = time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : '12:00'
  return Date.parse(`${date}T${hhmm}:00+05:00`)
}

/** A payment's moments: when the receipt was sent and when it was approved. */
export type PaymentMoments = { createdAt: string | null; reviewedAt: string | null }

/** Hours between a credit and the closer of the payment's two moments. */
export function gapMs(credit: { date: string; time: string | null }, p: PaymentMoments): number {
  const c = creditInstantMs(credit.date, credit.time)
  const gaps = [p.createdAt, p.reviewedAt].map((t) => (t ? Math.abs(Date.parse(t) - c) : Infinity)).filter((g) => Number.isFinite(g))
  return gaps.length ? Math.min(...gaps) : Infinity
}

export function withinWindow(credit: { date: string; time: string | null }, p: PaymentMoments): boolean {
  return gapMs(credit, p) <= AUTO_LINK_WINDOW_MS
}

// ------------------------------------------------------------------ plans

/** A bank credit with no link yet. */
export type FreeCredit = { id: string; date: string; time: string | null; amountPkr: number; senderName: string | null; isPaypro: boolean }

/** An APPROVED Verification Fee payment with no bank credit behind it yet. */
export type OpenFeePayment = PaymentMoments & { id: string; ref: string; memberId: string | null; memberName: string | null; amountPkr: number }

export type AutoLink = { creditId: string; paymentId: string; rounding: number; gap: number }
export type Suggestion = { creditId: string; paymentId: string; paymentRef: string; memberId: string | null; memberName: string | null }

/**
 * The safe links and the suggestions for a set of free credits:
 *   link       in range, within 48 h, the sender name matches — one credit to
 *              one payment, the closest in time first;
 *   suggestion in range and within 48 h, but no name match (or a tie) — the
 *              closest payment, shown for one tap; never linked.
 * PayPro payouts are never considered.
 */
export function autoLinkPlan(credits: FreeCredit[], payments: OpenFeePayment[], range: FeeRange): { links: AutoLink[]; suggestions: Suggestion[] } {
  type Pair = { c: FreeCredit; p: OpenFeePayment; gap: number; named: boolean }
  const pairs: Pair[] = []
  for (const c of credits) {
    if (c.isPaypro || !inFeeRange(c.amountPkr, range)) continue
    for (const p of payments) {
      const gap = gapMs(c, p)
      if (gap > AUTO_LINK_WINDOW_MS) continue
      pairs.push({ c, p, gap, named: namesMatch(c.senderName, p.memberName) })
    }
  }
  // Name matches, closest first; a credit whose name matches TWO open payments
  // equally is not safe and drops to a suggestion.
  const named = pairs.filter((x) => x.named).sort((a, b) => a.gap - b.gap || a.c.id.localeCompare(b.c.id))
  const usedC = new Set<string>()
  const usedP = new Set<string>()
  const links: AutoLink[] = []
  for (const x of named) {
    if (usedC.has(x.c.id) || usedP.has(x.p.id)) continue
    const rivals = named.filter((y) => y.c.id === x.c.id && y.p.id !== x.p.id && !usedP.has(y.p.id) && namesTie(y, x))
    const otherCredits = named.filter((y) => y.p.id === x.p.id && y.c.id !== x.c.id && !usedC.has(y.c.id) && namesTie(y, x))
    if (rivals.length > 0 || otherCredits.length > 0) continue
    links.push({ creditId: x.c.id, paymentId: x.p.id, rounding: roundingOf(x.c.amountPkr, x.p.amountPkr), gap: x.gap })
    usedC.add(x.c.id)
    usedP.add(x.p.id)
  }
  const suggestions: Suggestion[] = []
  for (const c of credits) {
    if (usedC.has(c.id)) continue
    // The most shared name words first ("Tehmina Naa" → Tehmina Nigah), then the closest in time.
    const best = pairs
      .filter((x) => x.c.id === c.id && !usedP.has(x.p.id))
      .sort((a, b) => sharedWords(b.c.senderName, b.p.memberName) - sharedWords(a.c.senderName, a.p.memberName) || a.gap - b.gap)[0]
    if (best) suggestions.push({ creditId: c.id, paymentId: best.p.id, paymentRef: best.p.ref, memberId: best.p.memberId, memberName: best.p.memberName })
  }
  return { links, suggestions }

  function namesTie(a: Pair, b: Pair) {
    return Math.abs(a.gap - b.gap) < 60_000
  }
}

/**
 * Approving a receipt: the closest free credit in range within 48 hours of the
 * payment (no name needed — the Owner is looking at it). Null when none.
 */
export function approvalPick(payment: PaymentMoments, credits: FreeCredit[], range: FeeRange): { creditId: string; gap: number } | null {
  let best: { creditId: string; gap: number } | null = null
  for (const c of credits) {
    if (c.isPaypro || !inFeeRange(c.amountPkr, range)) continue
    const gap = gapMs(c, payment)
    if (gap > AUTO_LINK_WINDOW_MS) continue
    if (!best || gap < best.gap) best = { creditId: c.id, gap }
  }
  return best
}

/** The likely member behind a partial credit: the one name match, else null. */
export function likelyMember<T extends { id: string; name: string | null }>(senderName: string | null, members: T[]): T | null {
  const hits = members.filter((m) => namesMatch(senderName, m.name))
  return hits.length === 1 ? hits[0] : null
}

// ------------------------------------------------- "already paid" (item 4)

export type ExistingFee = {
  paymentId: string
  ref: string
  amountPkr: number
  approvedAt: string | null
  provider: string
  /** A bank credit already pays it (manual receipt matched), or it is a PayPro payment. */
  hasCredit: boolean
}

/** The one option the "already paid" message offers for the existing payment. */
export function alreadyPaidOption(e: ExistingFee): 'link_existing' | 'refund_due' {
  return e.hasCredit || e.provider !== 'manual' ? 'refund_due' : 'link_existing'
}

export const OWNER_TRANSFER = 'owner_transfer'

/** The re-label choices (owner, 27 Oct 2026). */
export const CREDIT_LABELS = {
  paypro: 'PayPro payout',
  member: 'Bank transfer from a member',
  owner_transfer: 'Owner / partner transfer (not revenue)',
} as const
export type CreditLabel = keyof typeof CREDIT_LABELS

export function isCreditLabel(v: unknown): v is CreditLabel {
  return typeof v === 'string' && v in CREDIT_LABELS
}

/** How a credit is labelled now. */
export function creditLabelOf(c: { isPaypro: boolean; category?: string | null }): CreditLabel {
  if (c.category === OWNER_TRANSFER) return 'owner_transfer'
  return c.isPaypro ? 'paypro' : 'member'
}

/** The row change a re-label makes. */
export function relabelPatch(to: CreditLabel): { gateway?: 'paypro' | 'manual'; category: string | null } {
  if (to === 'owner_transfer') return { category: OWNER_TRANSFER }
  return { gateway: to === 'paypro' ? 'paypro' : 'manual', category: null }
}
