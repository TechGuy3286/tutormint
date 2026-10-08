// lib/financeCore.ts
//
// Admin → Finance (owner, 8 Oct 2026) — the PURE half. No I/O, so the totals
// are unit-tested (scripts/test-finance.ts). lib/finance.ts reads the rows.
//
// WHICH PAYMENTS COUNT. A payment is money in when it is APPROVED. Of those:
//   counted   — still attached to an account and never refunded. Every total,
//               the month-by-month "collected" column, and the by-type and
//               by-method tables use these only.
//   refunded  — any refund recorded against it (part or full). Shown in its
//               own list, never added to or subtracted from a total.
//   deleted   — the account was deleted (payments.user_id is null; the row is
//               kept with a note). Shown in its own list, never in a total.
// Dated by APPROVAL time (reviewed_at), in Pakistan time — the same rule the
// settlement check uses.
//
// THE BANK COLUMNS of the month table (PayPro deductions, expected in bank,
// received in bank, due from PayPro) follow the money: every approved PayPro
// payment moved through PayPro, so they count all of them — refunded and
// deleted-account ones included — exactly as the settlement check does. A
// bank transfer a member made straight to our account is already in the bank,
// so it counts as both expected and received.

import { deductionAmount, deductionsInEffect, pkDay, type Deduction } from './settlementCore'

export type FinancePayment = {
  id: string
  ref: string | null
  userId: string | null
  planCode: string | null
  /** 'tutor' | 'parent' | null — from the plans row. */
  audience: string | null
  amountPkr: number
  refundedAmountPkr: number | null
  refundedAt: string | null
  /** When it was approved (ISO instant). */
  approvedAt: string
  provider: string | null
  /** How the member paid, in words: JazzCash, Easypaisa, Card, Bank transfer, Other. */
  method: MethodLabel
  note: string | null
}

export type PaymentClass = 'counted' | 'refunded' | 'deleted'

export function classify(p: Pick<FinancePayment, 'userId' | 'refundedAmountPkr' | 'refundedAt'>): PaymentClass {
  if (!p.userId) return 'deleted'
  if ((p.refundedAmountPkr ?? 0) > 0 || p.refundedAt) return 'refunded'
  return 'counted'
}

// ------------------------------------------------------------ method + type
export const METHOD_LABELS = ['JazzCash', 'Easypaisa', 'Card', 'Bank transfer', 'Other'] as const
export type MethodLabel = (typeof METHOD_LABELS)[number]

/** One word for how a payment was made, from what the gateway told us
 *  (PayPro's paymentVia) or our own stored method/provider. */
export function methodLabel(via: string | null | undefined, method: string | null | undefined, provider: string | null | undefined): MethodLabel {
  const s = `${via ?? ''} ${method ?? ''}`.toLowerCase()
  if (s.includes('jazz')) return 'JazzCash'
  if (s.includes('easy')) return 'Easypaisa'
  if (/card|visa|master|debit|credit/.test(s)) return 'Card'
  if (s.includes('bank') || provider === 'manual') return 'Bank transfer'
  return 'Other'
}

export const TYPE_LABELS = ['Spam Free Platform Fee', 'Premium', 'Featured', 'Parent plans', 'Other'] as const
export type TypeLabel = (typeof TYPE_LABELS)[number]

export function typeLabel(planCode: string | null, audience: string | null): TypeLabel {
  if (planCode === 'verified') return 'Spam Free Platform Fee'
  if (audience === 'parent' || (planCode ?? '').startsWith('parent_')) return 'Parent plans'
  if (planCode === 'premium') return 'Premium'
  if (planCode === 'featured') return 'Featured'
  return 'Other'
}

// ------------------------------------------------------------ periods (PKT)
/** YYYY-MM of an instant, in Pakistan time. */
export function pkMonth(iso: string): string {
  return pkDay(iso).slice(0, 7)
}

export function previousMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** Every YYYY-MM from `first` to `last`, inclusive, oldest first. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = []
  let cur = first
  for (let i = 0; i < 600 && cur <= last; i++) {
    out.push(cur)
    const [y, m] = cur.split('-').map(Number)
    cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }
  return out
}

const round2 = (n: number) => Math.round(n * 100) / 100

export type Sum = { count: number; amount: number }
const sumOf = (rows: FinancePayment[]): Sum => ({ count: rows.length, amount: round2(rows.reduce((s, p) => s + p.amountPkr, 0)) })

// ------------------------------------------------------------ the summary
export type MonthRow = {
  month: string
  collected: number
  payproDeductions: number
  expectedInBank: number
  receivedInBank: number
  dueFromPaypro: number
}

export type FinanceTransfer = { gateway: string; transferredOn: string; amountPkr: number }

export type FinanceSummary = {
  /** The Pakistan-time month and year "now" falls in. */
  thisMonth: string
  lastMonth: string
  thisYear: string
  totals: { allTime: Sum; thisMonth: Sum; lastMonth: Sum; thisYear: Sum }
  months: MonthRow[]
  byType: { label: TypeLabel; count: number; amount: number }[]
  byMethod: { label: MethodLabel; count: number; amount: number }[]
  refunded: FinancePayment[]
  deleted: FinancePayment[]
}

export function inMonth(p: FinancePayment, ym: string): boolean {
  return pkMonth(p.approvedAt) === ym
}

/** The counted payments of one Pakistan-time month — the ONE rule behind the
 *  Overview "Revenue this month" card and its list. */
export function countedInMonth(payments: FinancePayment[], ym: string): FinancePayment[] {
  return payments.filter((p) => classify(p) === 'counted' && inMonth(p, ym))
}

export function summarise(input: {
  payments: FinancePayment[]
  transfers: FinanceTransfer[]
  deductions: Deduction[]
  nowIso: string
}): FinanceSummary {
  const thisMonth = pkMonth(input.nowIso)
  const lastMonth = previousMonth(thisMonth)
  const thisYear = thisMonth.slice(0, 4)
  const counted = input.payments.filter((p) => classify(p) === 'counted')

  const totals = {
    allTime: sumOf(counted),
    thisMonth: sumOf(counted.filter((p) => inMonth(p, thisMonth))),
    lastMonth: sumOf(counted.filter((p) => inMonth(p, lastMonth))),
    thisYear: sumOf(counted.filter((p) => pkMonth(p.approvedAt).startsWith(`${thisYear}-`))),
  }

  // Month table: from the first month with any approved payment or transfer.
  const firstCandidates = [
    ...input.payments.map((p) => pkMonth(p.approvedAt)),
    ...input.transfers.map((t) => t.transferredOn.slice(0, 7)),
  ].filter(Boolean)
  const first = firstCandidates.length ? firstCandidates.sort()[0] : thisMonth
  const months = monthsBetween(first, thisMonth)
    .map((ym): MonthRow => {
      const collected = round2(counted.filter((p) => inMonth(p, ym)).reduce((s, p) => s + p.amountPkr, 0))
      const paypro = input.payments.filter((p) => p.provider === 'paypro' && inMonth(p, ym))
      let deductions = 0
      for (const p of paypro) {
        for (const l of deductionsInEffect(pkDay(p.approvedAt), input.deductions)) deductions += deductionAmount(l, p.amountPkr)
      }
      deductions = round2(deductions)
      const payproGross = round2(paypro.reduce((s, p) => s + p.amountPkr, 0))
      const direct = round2(
        input.payments.filter((p) => p.provider === 'manual' && inMonth(p, ym)).reduce((s, p) => s + p.amountPkr, 0),
      )
      const payproTransfers = round2(
        input.transfers.filter((t) => t.gateway === 'paypro' && t.transferredOn.slice(0, 7) === ym).reduce((s, t) => s + t.amountPkr, 0),
      )
      const expectedFromPaypro = round2(payproGross - deductions)
      return {
        month: ym,
        collected,
        payproDeductions: deductions,
        expectedInBank: round2(expectedFromPaypro + direct),
        receivedInBank: round2(payproTransfers + direct),
        dueFromPaypro: round2(expectedFromPaypro - payproTransfers),
      }
    })
    .reverse()

  const byType = TYPE_LABELS.map((label) => {
    const rows = counted.filter((p) => typeLabel(p.planCode, p.audience) === label)
    return { label, ...sumOf(rows) }
  }).filter((r) => r.count > 0 || r.label !== 'Other')

  const byMethod = METHOD_LABELS.map((label) => {
    const rows = counted.filter((p) => p.method === label)
    return { label, ...sumOf(rows) }
  }).filter((r) => r.count > 0 || r.label !== 'Other')

  const newestFirst = (a: FinancePayment, b: FinancePayment) => b.approvedAt.localeCompare(a.approvedAt)
  return {
    thisMonth,
    lastMonth,
    thisYear,
    totals,
    months,
    byType,
    byMethod,
    refunded: input.payments.filter((p) => classify(p) === 'refunded').sort(newestFirst),
    deleted: input.payments.filter((p) => classify(p) === 'deleted').sort(newestFirst),
  }
}

/** Payments approved on a Pakistan-time day inside [from, to] (YYYY-MM-DD). */
export function inDayRange(payments: FinancePayment[], from: string, to: string): FinancePayment[] {
  return payments
    .filter((p) => {
      const d = pkDay(p.approvedAt)
      return d >= from && d <= to
    })
    .sort((a, b) => a.approvedAt.localeCompare(b.approvedAt))
}

/** "1–31 Oct 2026" for a YYYY-MM month. */
export function monthRangeLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })
  return `1–${last} ${name} ${y}`
}
