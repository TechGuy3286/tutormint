// lib/feePayersCore.ts
//
// "Paid this month" on Admin → Overview (owner, 7 Oct 2026) — the PURE half:
// which Rs 199 Verification Fee payments count, and a tutor's overall
// document status. No I/O, so the counting rule is unit-tested.
//
// A payment counts when it is the fee (plan_code 'verified'), approved, still
// attached to an account (a deleted account's payment has user_id null), and
// not refunded. Each tutor counts ONCE. "This month" is the calendar month in
// Pakistan time; "the last 7 days" is the last 7 × 24 hours.

import type { TutorDocs } from './badgeRule'

export type FeePaymentRow = {
  userId: string | null
  status: string
  planCode: string | null
  /** When it was approved (ISO). */
  approvedAt: string | null
  refundedAmountPkr: number | null
  refundedAt: string | null
}

const PK_OFFSET_MS = 5 * 60 * 60 * 1000

/** The instant the current Pakistan-time calendar month began. */
export function pkMonthStartMs(nowMs: number): number {
  const shifted = new Date(nowMs + PK_OFFSET_MS)
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - PK_OFFSET_MS
}

export function countsAsFeePayment(r: FeePaymentRow): boolean {
  if (r.planCode !== 'verified' || r.status !== 'approved' || !r.userId || !r.approvedAt) return false
  if ((r.refundedAmountPkr ?? 0) > 0 || r.refundedAt) return false
  return Number.isFinite(Date.parse(r.approvedAt))
}

/** Distinct tutors paid this month and in the last 7 days. */
export function countFeePayers(rows: FeePaymentRow[], nowMs: number): { month: number; week: number } {
  const monthStart = pkMonthStartMs(nowMs)
  const weekStart = nowMs - 7 * 86_400_000
  const month = new Set<string>()
  const week = new Set<string>()
  for (const r of rows) {
    if (!countsAsFeePayment(r)) continue
    const t = Date.parse(r.approvedAt as string)
    if (t > nowMs) continue
    if (t >= monthStart) month.add(r.userId as string)
    if (t >= weekStart) week.add(r.userId as string)
  }
  return { month: month.size, week: week.size }
}

export type DocOverall = 'approved' | 'waiting' | 'rejected'

/** One word for a tutor's three documents (CNIC, photo, selfie): rejected if any
 *  is rejected, approved only when all three are, otherwise waiting. */
export function docOverall(docs: TutorDocs): DocOverall {
  const states = [docs.cnic.rawStatus, docs.photo.rawStatus, docs.selfie.rawStatus]
  if (states.includes('rejected')) return 'rejected'
  if (states.every((s) => s === 'approved')) return 'approved'
  return 'waiting'
}
