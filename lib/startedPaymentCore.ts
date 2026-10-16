// lib/startedPaymentCore.ts
//
// PURE. "Started payment, didn't finish" (owner, 16 Oct 2026) — what the
// Overview to-do row (once "Payments waiting over 1 hour") lists, and the
// Follow-ups → Tutors chip of the same name.
//
// These are CHECKOUTS a member opened and never completed — not payments for
// staff to approve. A bank-transfer receipt that is waiting for staff is a
// payment to approve, so it is NOT here. A row leaves the list on its own 48
// hours after the checkout started, or as soon as that member pays for the same
// thing. One row per member and package (the newest checkout).

import { SITE_URL } from '@/lib/siteUrl'

/** Shown once the checkout is over an hour old (still at the gateway before that). */
export const STARTED_PAYMENT_MIN_MS = 60 * 60 * 1000
/** Off the list 48 hours after the checkout started. */
export const STARTED_PAYMENT_CLEAR_MS = 48 * 60 * 60 * 1000

export const PAYMENT_NOT_FINISHED_KEY = 'payment_not_finished'

/** The built-in wording (Team inbox → Templates holds the editable copy). No amount. */
export const PAYMENT_NOT_FINISHED_FALLBACK =
  "Assalam o Alaikum {name}, your TutorMint payment didn't complete. Need help? Here is your link to try again: {pay_link}. Support WhatsApp 0321 5872222."

export type StartedCheckout = {
  id: string
  userId: string | null
  planCode: string | null
  status: string
  createdAt: string
  provider: string | null
  /** A receipt or bank reference was sent: a payment for staff to approve. */
  hasReceipt: boolean
}

export type MemberPaid = {
  /** Approved, not refunded payments: plan code → their approval/creation times. */
  approved: { planCode: string; at: string }[]
  /** The tutor's Verification Fee is already stamped (a grant or an earlier payment). */
  feePaid?: boolean
}

/** Is this one checkout started-and-not-finished at `nowMs`? */
export function isStartedNotFinished(p: StartedCheckout, paid: MemberPaid | undefined, nowMs: number): boolean {
  if (p.status !== 'pending' || !p.userId) return false
  if (p.hasReceipt) return false
  const t = Date.parse(p.createdAt)
  if (!Number.isFinite(t)) return false
  const age = nowMs - t
  if (age <= STARTED_PAYMENT_MIN_MS || age > STARTED_PAYMENT_CLEAR_MS) return false
  if (p.planCode === 'verified' && paid?.feePaid) return false
  // Paid for the same thing at or after this checkout started → done.
  for (const a of paid?.approved ?? []) {
    if (a.planCode === p.planCode && Date.parse(a.at) >= t) return false
  }
  return true
}

/** The list: started-not-finished checkouts, one per member and package
 *  (the newest), newest first. */
export function startedNotFinished(rows: StartedCheckout[], paidBy: Map<string, MemberPaid>, nowMs: number): StartedCheckout[] {
  const best = new Map<string, StartedCheckout>()
  for (const r of rows) {
    if (!isStartedNotFinished(r, paidBy.get(r.userId ?? ''), nowMs)) continue
    const k = `${r.userId}|${r.planCode}`
    const cur = best.get(k)
    if (!cur || Date.parse(r.createdAt) > Date.parse(cur.createdAt)) best.set(k, r)
  }
  return [...best.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

/** The member's link to try again: the payment choice screen for that package. */
export function payAgainLink(planCode: string | null | undefined): string {
  return `${SITE_URL}/pay/choose?plan=${encodeURIComponent(planCode || 'verified')}`
}

/** Fill {name} (first name) and {pay_link}. Unknown placeholders are left as written. */
export function fillPaymentNotFinished(body: string, vars: { name: string; payLink: string }): string {
  const first = (vars.name || '').trim().split(/\s+/)[0] || 'there'
  return body.replaceAll('{name}', first).replaceAll('{pay_link}', vars.payLink)
}
