// lib/paymentAttemptsCore.ts — PURE (owner, 15 Nov 2026).
//
// "Tried to pay": unfinished payment attempts, said plainly.
//
//   • On a member page, an attempt that was started and never finished reads
//     "started, not completed" (it read "expired"), and repeats of the same
//     package on the same day (Pakistan time) are ONE line:
//       "7 payment attempts on 1 Oct — none completed".
//   • On People → Tutors → Approved, fee pending, a tutor who started at least
//     one Verification Fee payment that never completed, and has not paid since,
//     carries a "Tried to pay" chip, is counted under the "Tried to pay (N)"
//     chip, and sorts first within Not followed up.
//
// An attempt = a checkout that was started and left: it is over an hour old,
// or was closed as expired or cancelled by the member. A receipt waiting for
// approval, a rejected receipt, a paid payment and a checkout closed because the
// member paid another way are NOT unfinished attempts.

import { paymentPlanName, paymentState, type PaymentFacts, type PaymentState } from '@/lib/paymentLabelCore'

/** The states that are a started-and-left attempt. */
export const UNFINISHED_STATES: readonly PaymentState[] = ['started_not_paid', 'expired', 'cancelled']

export function isUnfinishedAttempt(p: PaymentFacts, nowMs: number): boolean {
  return UNFINISHED_STATES.includes(paymentState(p, nowMs))
}

/** The chip's words. */
export const TRIED_TO_PAY_LABEL = 'Tried to pay'

/** Did this tutor start a Verification Fee payment that never completed, and
 *  not pay since? (Any paid fee payment — at any time — means no.) */
export function triedToPay(payments: PaymentFacts[], nowMs: number): boolean {
  const fee = payments.filter((p) => p.planCode === 'verified')
  // Paid, paid another way, or a receipt now waiting for approval: not "tried".
  if (fee.some((p) => ['paid', 'paid_another_way', 'receipt_waiting'].includes(paymentState(p, nowMs)))) return false
  return fee.some((p) => isUnfinishedAttempt(p, nowMs))
}

/** The Pakistan-time calendar day of an instant: "2026-10-01". */
export function pkDayKey(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t + 5 * 3_600_000).toISOString().slice(0, 10)
}

/** "1 Oct" for a day key. */
export function dayLabel(key: string): string {
  const d = new Date(`${key}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export type PaymentLine<T> =
  | { kind: 'one'; id: string; facts: PaymentFacts; row: T }
  | { kind: 'attempts'; key: string; planCode: string | null; count: number; day: string; ids: string[]; provider: string | null; createdAt: string }

/**
 * The member page's payment lines, newest first as given: every payment as its
 * own line, except that two or more "started, not completed" attempts of the
 * same package on the same Pakistan-time day become ONE line.
 */
export function groupPaymentLines<T extends { id: string; facts: PaymentFacts }>(rows: T[], nowMs: number): PaymentLine<T>[] {
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    const st = paymentState(r.facts, nowMs)
    if (st !== 'started_not_paid' && st !== 'expired') continue
    const k = `${r.facts.planCode ?? ''}|${pkDayKey(r.facts.createdAt)}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const out: PaymentLine<T>[] = []
  const done = new Set<string>()
  for (const r of rows) {
    const st = paymentState(r.facts, nowMs)
    const k = `${r.facts.planCode ?? ''}|${pkDayKey(r.facts.createdAt)}`
    const g = st === 'started_not_paid' || st === 'expired' ? groups.get(k) : undefined
    if (g && g.length > 1) {
      if (done.has(k)) continue
      done.add(k)
      out.push({
        kind: 'attempts',
        key: k,
        planCode: r.facts.planCode,
        count: g.length,
        day: dayLabel(pkDayKey(r.facts.createdAt)),
        ids: g.map((x) => x.id),
        provider: r.facts.provider,
        createdAt: r.facts.createdAt,
      })
      continue
    }
    out.push({ kind: 'one', id: r.id, facts: r.facts, row: r })
  }
  return out
}

/** "7 payment attempts on 1 Oct — none completed" (with the package name in front). */
export function attemptsLine(line: { planCode: string | null; count: number; day: string }): string {
  return `${paymentPlanName(line.planCode)}: ${line.count} payment attempts on ${line.day} — none completed`
}
