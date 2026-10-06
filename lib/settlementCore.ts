// lib/settlementCore.ts
//
// The settlement check for one payment gateway (owner, 6 Oct 2026) — the PURE
// half. No I/O, so the sums and the deduction rule are unit-tested
// (scripts/test-settlement.ts). lib/settlement.ts is the I/O around it.
//
// For a date range (Pakistan time, inclusive):
//   TutorMint collected  our APPROVED payments for this gateway, by the day they
//                        were approved
//   gateway reported     MerchantShare of the PAID orders in the gateway's own
//                        file (PayPro's Orders export) with Date Paid in range
//   deductions           each owner-defined line, applied per payment with the
//                        line IN EFFECT on that payment's day
//   expected in bank     TutorMint collected − total deductions
//   bank transfers       transfers recorded for this gateway in the range
//   difference           bank transfers − expected in bank (negative = missing)
// It never changes anything; mismatches are listed.

import { isPaid, type PayproRow, type Transfer } from './reconciliationCore'

export type OurPayment = {
  ref: string
  amountPkr: number
  /** When the payment was approved (ISO instant). */
  approvedAt: string
  /** How the member paid, when the gateway told us (e.g. "JazzCash"). */
  method: string | null
}

export type Deduction = {
  id: string
  name: string
  /** Percentage of each payment, e.g. 2.5. */
  percent: number | null
  /** Fixed rupees per payment. */
  fixedPkr: number | null
  /** YYYY-MM-DD — applies to payments on or after this day. */
  effectiveFrom: string
}

export type SettlementFlag = { ref: string; ourAmount: number | null; gatewayAmount: number | null; day: string | null }

export type SettlementResult = {
  from: string
  to: string
  ourCount: number
  ourTotal: number
  hasGatewayFile: boolean
  gatewayCount: number
  gatewayReported: number
  deductionLines: { name: string; amount: number }[]
  totalDeductions: number
  expectedInBank: number
  transferCount: number
  transfersReceived: number
  /** transfersReceived − expectedInBank. Negative means money is missing. */
  difference: number
  missing: boolean
  paidNotApproved: SettlementFlag[]
  approvedNotPaid: SettlementFlag[]
  amountDifferences: SettlementFlag[]
}

const PK_OFFSET_MS = 5 * 60 * 60 * 1000

/** The Pakistan-time calendar day (YYYY-MM-DD) of an ISO instant. */
export function pkDay(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t + PK_OFFSET_MS).toISOString().slice(0, 10)
}

export function dayInRange(day: string | null, from: string, to: string): boolean {
  return !!day && day >= from && day <= to
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The deduction lines in effect on `day`: for each NAME, the line with the
 * latest effective date on or before that day. So adding "PayPro fee 3% from
 * 1 Nov" leaves October's payments on the old rate.
 */
export function deductionsInEffect(day: string, lines: Deduction[]): Deduction[] {
  const byName = new Map<string, Deduction>()
  for (const l of lines) {
    if (l.effectiveFrom > day) continue
    const key = l.name.trim().toLowerCase()
    const cur = byName.get(key)
    if (!cur || l.effectiveFrom > cur.effectiveFrom || (l.effectiveFrom === cur.effectiveFrom && l.id > cur.id)) byName.set(key, l)
  }
  return [...byName.values()]
}

/** One deduction line's amount on one payment. */
export function deductionAmount(line: Deduction, amountPkr: number): number {
  return (line.percent ? (amountPkr * line.percent) / 100 : 0) + (line.fixedPkr ?? 0)
}

export function settle(input: {
  from: string
  to: string
  /** Every APPROVED payment for this gateway (all time — used for the flags). */
  approved: OurPayment[]
  /** The gateway's own file rows, or null when none has been uploaded. */
  gatewayRows: PayproRow[] | null
  transfers: Transfer[]
  deductions: Deduction[]
}): SettlementResult {
  const { from, to } = input
  const ours = input.approved.filter((p) => dayInRange(pkDay(p.approvedAt), from, to))
  const ourTotal = round2(ours.reduce((s, p) => s + p.amountPkr, 0))

  // Deductions, per payment, with the rates of that payment's day.
  const lineTotals = new Map<string, { name: string; amount: number }>()
  for (const p of ours) {
    for (const l of deductionsInEffect(pkDay(p.approvedAt), input.deductions)) {
      const key = l.name.trim().toLowerCase()
      const cur = lineTotals.get(key) ?? { name: l.name.trim(), amount: 0 }
      cur.amount += deductionAmount(l, p.amountPkr)
      lineTotals.set(key, cur)
    }
  }
  const deductionLines = [...lineTotals.values()].map((l) => ({ name: l.name, amount: round2(l.amount) }))
  const totalDeductions = round2(deductionLines.reduce((s, l) => s + l.amount, 0))
  const expectedInBank = round2(ourTotal - totalDeductions)

  const rows = input.gatewayRows ?? []
  const paidRows = rows.filter((r) => isPaid(r.transactionStatus))
  const paidInRange = paidRows.filter((r) => dayInRange(r.datePaid, from, to))
  const gatewayReported = round2(paidInRange.reduce((s, r) => s + (r.merchantShare ?? 0), 0))

  const transfers = input.transfers.filter((t) => dayInRange(t.transferredOn, from, to))
  const transfersReceived = round2(transfers.reduce((s, t) => s + t.amountPkr, 0))
  const difference = round2(transfersReceived - expectedInBank)

  // Flags — listed only, never acted on.
  const key = (s: string) => s.trim().toLowerCase()
  const approvedByRef = new Map(input.approved.map((p) => [key(p.ref), p]))
  const paidByRef = new Map(paidRows.map((r) => [key(r.orderNumber), r]))
  const hasGatewayFile = input.gatewayRows !== null

  const paidNotApproved: SettlementFlag[] = paidInRange
    .filter((r) => !approvedByRef.has(key(r.orderNumber)))
    .map((r) => ({ ref: r.orderNumber, ourAmount: null, gatewayAmount: r.orderAmount, day: r.datePaid }))
  const approvedNotPaid: SettlementFlag[] = hasGatewayFile
    ? ours
        .filter((p) => !paidByRef.has(key(p.ref)))
        .map((p) => ({ ref: p.ref, ourAmount: p.amountPkr, gatewayAmount: null, day: pkDay(p.approvedAt) }))
    : []
  const amountDifferences: SettlementFlag[] = ours
    .map((p) => ({ p, r: paidByRef.get(key(p.ref)) }))
    .filter(({ p, r }) => r && r.orderAmount !== null && Math.abs((r.orderAmount ?? 0) - p.amountPkr) > 0.005)
    .map(({ p, r }) => ({ ref: p.ref, ourAmount: p.amountPkr, gatewayAmount: r!.orderAmount, day: pkDay(p.approvedAt) }))

  return {
    from,
    to,
    ourCount: ours.length,
    ourTotal,
    hasGatewayFile,
    gatewayCount: paidInRange.length,
    gatewayReported,
    deductionLines,
    totalDeductions,
    expectedInBank,
    transferCount: transfers.length,
    transfersReceived,
    difference,
    missing: difference < -0.005,
    paidNotApproved,
    approvedNotPaid,
    amountDifferences,
  }
}

/** Validate a new deduction line. Returns a plain-English problem, or null. */
export function deductionProblem(d: { name: string; percent: number | null; fixedPkr: number | null; effectiveFrom: string }): string | null {
  if (!d.name.trim()) return 'Give the deduction a name, like “PayPro fee”.'
  if (d.percent === null && d.fixedPkr === null) return 'Enter a percentage, a fixed amount, or both.'
  if (d.percent !== null && (d.percent < 0 || d.percent > 100)) return 'The percentage must be between 0 and 100.'
  if (d.fixedPkr !== null && d.fixedPkr < 0) return 'The fixed amount cannot be negative.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.effectiveFrom)) return 'Choose the date the deduction starts.'
  return null
}
