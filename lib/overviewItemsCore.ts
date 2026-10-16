// lib/overviewItemsCore.ts
//
// Admin → Overview, counts that match their lists (owner, 8 Oct 2026, item 5)
// — the PURE half. Every Overview top card, every "Today's to-do" row and every
// "Signup to payment" step (and each step's "lost" figure) is an ITEM. An item
// has ONE loader (lib/overviewItems.ts) that returns its rows; the Overview
// number is that list's length (or, for revenue, its sum), and the item's list
// page (/admin/overview/<key>) shows the same rows. So the number and the list
// cannot disagree. No I/O here, so the window rules are unit-tested.

import type { AdminScreen } from './adminNav'

export const OVERVIEW_ITEM_KEYS = [
  // top cards
  'revenue',
  'paid-today',
  // "Signed up today, not paid" (owner, 12 Oct 2026) — its list is the Unpaid
  // signups screen's Today filter, so the number and the rows cannot disagree.
  'signups-today',
  'tutors',
  'parents',
  'open-tuitions',
  // today's to-do
  'todo-docs',
  'todo-uncontacted',
  'todo-stuck',
  // The "Follow-up sent" tab beside Stuck in onboarding (owner, 9 Oct 2026) —
  // a list page only, never an Overview row.
  'todo-stuck-sent',
  'todo-payments',
  'todo-due',
  'todo-flagged',
  'todo-pausing',
  'todo-featured',
  'todo-unmet',
  // signup to payment (each takes ?days=7|30)
  'funnel-signed-up',
  'funnel-mobile',
  'funnel-onboarded',
  'funnel-paid',
  'lost-mobile',
  'lost-onboarding',
  'lost-payment',
] as const

export type OverviewItemKey = (typeof OVERVIEW_ITEM_KEYS)[number]

export function isOverviewItemKey(v: string): v is OverviewItemKey {
  return (OVERVIEW_ITEM_KEYS as readonly string[]).includes(v)
}

export type OverviewItemMeta = {
  /** The page title and breadcrumb label. */
  title: string
  /** Who may open it — the SAME SCREEN_ACCESS key the Overview filters by. */
  screen: AdminScreen
  /** Singular / plural noun for the header ("6 tutors paid this month"). */
  noun: [string, string]
  /** Funnel items carry the 7/30-day cohort. */
  funnel?: boolean
}

export const OVERVIEW_ITEMS: Record<OverviewItemKey, OverviewItemMeta> = {
  revenue: { title: 'Revenue this month', screen: 'revenue', noun: ['payment', 'payments'] },
  'paid-today': { title: 'Paid today', screen: 'payments', noun: ['tutor', 'tutors'] },
  'signups-today': { title: 'Signed up today, not paid', screen: 'unpaidSignups', noun: ['tutor', 'tutors'] },
  tutors: { title: 'Tutors', screen: 'users', noun: ['tutor', 'tutors'] },
  parents: { title: 'Parents', screen: 'users', noun: ['parent', 'parents'] },
  'open-tuitions': { title: 'Open tuitions', screen: 'jobs', noun: ['tuition', 'tuitions'] },
  'todo-docs': { title: 'Documents to approve', screen: 'tutors', noun: ['member', 'members'] },
  'todo-uncontacted': { title: 'Unpaid signups not yet contacted', screen: 'unpaidSignups', noun: ['tutor', 'tutors'] },
  'todo-stuck': { title: 'Stuck in onboarding', screen: 'unpaidSignups', noun: ['tutor', 'tutors'] },
  'todo-stuck-sent': { title: 'Follow-up sent', screen: 'unpaidSignups', noun: ['tutor', 'tutors'] },
  // Checkouts a member opened and never completed (owner, 16 Oct 2026) — not
  // payments to approve. Rules: lib/startedPaymentCore.
  'todo-payments': { title: "Started payment, didn't finish", screen: 'payments', noun: ['checkout', 'checkouts'] },
  // Renamed from "Due from PayPro" (owner, 13 Oct 2026): the money is paid by
  // customers and PayPro has not yet paid it out to our bank.
  'todo-due': { title: 'Paid by customers, waiting for PayPro payout', screen: 'finance', noun: ['order', 'orders'] },
  'todo-flagged': { title: 'Flagged messages and reports', screen: 'reports', noun: ['item', 'items'] },
  'todo-pausing': { title: 'Tuitions auto-pausing in the next 2 days', screen: 'jobs', noun: ['tuition', 'tuitions'] },
  'todo-featured': { title: 'Featured tutors with new matches', screen: 'featuredWhatsapp', noun: ['tutor', 'tutors'] },
  'todo-unmet': { title: 'Unmet searches this week', screen: 'unmetSearches', noun: ['search', 'searches'] },
  'funnel-signed-up': { title: 'Signed up', screen: 'users', noun: ['tutor', 'tutors'], funnel: true },
  'funnel-mobile': { title: 'Mobile verified', screen: 'users', noun: ['tutor', 'tutors'], funnel: true },
  'funnel-onboarded': { title: 'Onboarding done', screen: 'users', noun: ['tutor', 'tutors'], funnel: true },
  'funnel-paid': { title: 'Paid', screen: 'users', noun: ['tutor', 'tutors'], funnel: true },
  'lost-mobile': { title: 'Lost before mobile verified', screen: 'users', noun: ['tutor', 'tutors'], funnel: true },
  'lost-onboarding': { title: 'Lost before onboarding done', screen: 'users', noun: ['tutor', 'tutors'], funnel: true },
  'lost-payment': { title: 'Lost before paying', screen: 'users', noun: ['tutor', 'tutors'], funnel: true },
}

export function nounFor(meta: OverviewItemMeta, n: number): string {
  return n === 1 ? meta.noun[0] : meta.noun[1]
}

/** The funnel cohort window, 7 or 30 days. */
export function parseFunnelDays(v: string | null | undefined): 7 | 30 {
  return v === '30' ? 30 : 7
}

// ------------------------------------------------- payments waiting (item 6)
export const PAYMENT_WAIT_MIN_MS = 60 * 60 * 1000
export const PAYMENT_ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * "Payments waiting over 1 hour" (owner, 8 Oct 2026, item 6): a payment still
 * pending that was STARTED in the last 24 hours and has waited more than 1 hour.
 * Older pending payments are abandoned — they stay visible on the Payments
 * screen but are not a to-do.
 */
export function isWaitingPayment(p: { status: string; createdAt: string }, nowMs: number): boolean {
  if (p.status !== 'pending') return false
  const t = Date.parse(p.createdAt)
  if (!Number.isFinite(t)) return false
  const age = nowMs - t
  return age > PAYMENT_WAIT_MIN_MS && age <= PAYMENT_ABANDONED_AFTER_MS
}

// ---------------------------------------------------------- funnel steps
export type FunnelTutor = { id: string; mobileVerified: boolean; onboarded: boolean; paid: boolean }

export type FunnelSets<T extends FunnelTutor> = {
  signedUp: T[]
  mobile: T[]
  onboarded: T[]
  paid: T[]
  lostMobile: T[]
  lostOnboarding: T[]
  lostPayment: T[]
}

/** The nested funnel and who dropped out between each step. Each "lost" set is
 *  exactly the previous step minus the next, so its size is the difference the
 *  Overview shows as "% lost". */
export function funnelSets<T extends FunnelTutor>(cohort: T[]): FunnelSets<T> {
  const mobile = cohort.filter((t) => t.mobileVerified)
  const onboarded = mobile.filter((t) => t.onboarded)
  const paid = onboarded.filter((t) => t.paid)
  const without = (all: T[], some: T[]) => {
    const keep = new Set(some.map((t) => t.id))
    return all.filter((t) => !keep.has(t.id))
  }
  return {
    signedUp: cohort,
    mobile,
    onboarded,
    paid,
    lostMobile: without(cohort, mobile),
    lostOnboarding: without(mobile, onboarded),
    lostPayment: without(onboarded, paid),
  }
}

// ------------------------------------------------------------- paid today
const PK_OFFSET_MS = 5 * 60 * 60 * 1000

/** The instant today began in Pakistan time (00:00 PKT). */
export function pkDayStartMs(nowMs: number): number {
  const shifted = new Date(nowMs + PK_OFFSET_MS)
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - PK_OFFSET_MS
}

export type FeePayment = {
  userId: string | null
  approvedAt: string | null
  refundedAmountPkr: number | null
  refundedAt: string | null
  ref?: string | null
}

/**
 * "Paid today" (owner, 8 Oct 2026): tutors whose Verification Fee was
 * approved since 00:00 Pakistan time — refunded and deleted-account payments
 * left out, each tutor once (their latest fee payment today). Also the month
 * and 7-day counts for the card's subline, from the SAME rows.
 */
export function feePayersSince<T extends FeePayment>(
  rows: T[],
  nowMs: number,
  monthStartMs: number,
): { today: (T & { at: string })[]; month: number; week: number } {
  const dayStart = pkDayStartMs(nowMs)
  const weekStart = nowMs - 7 * 86_400_000
  const latest = new Map<string, T & { at: string }>()
  const month = new Set<string>()
  const week = new Set<string>()
  for (const r of rows) {
    if (!r.userId || !r.approvedAt) continue
    if ((r.refundedAmountPkr ?? 0) > 0 || r.refundedAt) continue
    const t = Date.parse(r.approvedAt)
    if (!Number.isFinite(t) || t > nowMs) continue
    if (t >= monthStartMs) month.add(r.userId)
    if (t >= weekStart) week.add(r.userId)
    if (t < dayStart) continue
    const cur = latest.get(r.userId)
    if (!cur || cur.at < r.approvedAt) latest.set(r.userId, { ...r, at: r.approvedAt })
  }
  const today = [...latest.values()].sort((a, b) => b.at.localeCompare(a.at))
  return { today, month: month.size, week: week.size }
}

/**
 * The "Paid today" LIST with a period switch (owner, 15 Oct 2026): it replaced
 * Payments → Recent payers. The same rule as feePayersSince — approved fee, not
 * refunded, account not deleted, each tutor once (their latest fee payment in
 * the range) — over [startMs, endMs). With the "today" range it returns exactly
 * feePayersSince(...).today, so the card and its list still agree.
 */
export function feePayersInRange<T extends FeePayment>(
  rows: T[],
  startMs: number,
  endMs: number,
): (T & { at: string })[] {
  const latest = new Map<string, T & { at: string }>()
  for (const r of rows) {
    if (!r.userId || !r.approvedAt) continue
    if ((r.refundedAmountPkr ?? 0) > 0 || r.refundedAt) continue
    const t = Date.parse(r.approvedAt)
    if (!Number.isFinite(t) || t < startMs || t >= endMs) continue
    const cur = latest.get(r.userId)
    if (!cur || cur.at < r.approvedAt) latest.set(r.userId, { ...r, at: r.approvedAt })
  }
  return [...latest.values()].sort((a, b) => b.at.localeCompare(a.at))
}

export type PayerPeriod = 'today' | 'yesterday' | 'last7' | 'month'
export const PAYER_PERIODS: { key: PayerPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
]

export function parsePayerPeriod(v: string | null | undefined): PayerPeriod {
  return PAYER_PERIODS.some((p) => p.key === v) ? (v as PayerPeriod) : 'today'
}

/** [start, end) of a payer period in Pakistan time — the same windows as the
 *  rest of the admin (Last 7 days = today and the six days before). */
export function payerPeriodRange(p: PayerPeriod, nowMs: number): { start: number; end: number } {
  const today = pkDayStartMs(nowMs)
  const DAY = 86_400_000
  switch (p) {
    case 'today':
      return { start: today, end: nowMs + 1 }
    case 'yesterday':
      return { start: today - DAY, end: today }
    case 'last7':
      return { start: today - 6 * DAY, end: nowMs + 1 }
    case 'month': {
      const shifted = new Date(nowMs + PK_OFFSET_MS)
      return { start: Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - PK_OFFSET_MS, end: nowMs + 1 }
    }
  }
}

/** Where Payments → Recent payers went: the Paid today list on a period. */
export function paidListHref(period: PayerPeriod): string {
  return period === 'today' ? '/admin/overview/paid-today' : `/admin/overview/paid-today?period=${period}`
}

/** Where the "Signed up today, not paid" card opens: the Tutors tab of Follow-ups (was Unpaid signups)
 *  list on its Today filter (WhatsApp, Call and Follow-up sent already live there). */
export const SIGNUPS_TODAY_HREF = '/admin/follow-ups?filter=today'

// ----------------------------------------------- the PayPro file's age ------

/** A PayPro file older than this many days shows its date in red. */
export const PAYPRO_FILE_STALE_DAYS = 2

export type FileNote = {
  /** "Based on the PayPro file uploaded " */
  before: string
  /** The upload date and time, Pakistan time — shown in red when stale. */
  date: string
  /** ". Upload a newer file to update." */
  after: string
  stale: boolean
  href: string
  linkLabel: string
}

/**
 * The line under "Paid by customers, waiting for PayPro payout" (owner, 13 Oct
 * 2026): which upload the list is based on, and whether it is getting old.
 * `dateText` is the upload time already formatted in Pakistan time.
 */
export function payproFileNote(uploadedAt: string | null, dateText: string | null, nowMs: number): FileNote | null {
  if (!uploadedAt || !dateText) return null
  const age = nowMs - new Date(uploadedAt).getTime()
  return {
    before: 'Based on the PayPro file uploaded ',
    date: dateText,
    after: '. Upload a newer file to update.',
    stale: age > PAYPRO_FILE_STALE_DAYS * 24 * 3600_000,
    href: '/admin/finance?tab=settlement',
    linkLabel: 'Settlement check',
  }
}

/** "Rs 193 · paid 8 Oct 2026 · 5 days" — one waiting order's card line. */
export function waitingOrderLine(o: { amountText: string | null; paidText: string | null; ageDays: number | null; overdue?: boolean }): string {
  return [
    o.amountText,
    o.paidText ? `paid ${o.paidText}` : null,
    o.ageDays !== null ? `${o.ageDays} day${o.ageDays === 1 ? '' : 's'}` : null,
    o.overdue ? 'overdue' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
