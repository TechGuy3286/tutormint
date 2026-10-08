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
  'paid-this-month',
  'tutors',
  'parents',
  'open-tuitions',
  // today's to-do
  'todo-docs',
  'todo-uncontacted',
  'todo-stuck',
  'todo-payments',
  'todo-due',
  'todo-flagged',
  'todo-pausing',
  'todo-featured',
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
  'paid-this-month': { title: 'Paid this month', screen: 'payments', noun: ['tutor', 'tutors'] },
  tutors: { title: 'Tutors', screen: 'users', noun: ['tutor', 'tutors'] },
  parents: { title: 'Parents', screen: 'users', noun: ['parent', 'parents'] },
  'open-tuitions': { title: 'Open tuitions', screen: 'jobs', noun: ['tuition', 'tuitions'] },
  'todo-docs': { title: 'Documents to approve', screen: 'tutors', noun: ['tutor', 'tutors'] },
  'todo-uncontacted': { title: 'Unpaid signups not yet contacted', screen: 'unpaidSignups', noun: ['tutor', 'tutors'] },
  'todo-stuck': { title: 'Stuck in onboarding', screen: 'unpaidSignups', noun: ['tutor', 'tutors'] },
  'todo-payments': { title: 'Payments waiting over 1 hour', screen: 'payments', noun: ['payment', 'payments'] },
  'todo-due': { title: 'Due from PayPro', screen: 'finance', noun: ['order', 'orders'] },
  'todo-flagged': { title: 'Flagged messages and reports', screen: 'reports', noun: ['item', 'items'] },
  'todo-pausing': { title: 'Tuitions auto-pausing in the next 2 days', screen: 'jobs', noun: ['tuition', 'tuitions'] },
  'todo-featured': { title: 'Featured tutors with new matches', screen: 'featuredWhatsapp', noun: ['tutor', 'tutors'] },
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
