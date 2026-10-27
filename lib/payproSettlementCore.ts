// lib/payproSettlementCore.ts — PURE rules for the PayPro settlement report
// (owner, 27 Oct 2026). I/O in lib/payproSettlement.ts.
//
// For every successful PayPro payment: date, member, gross, PayPro's fee and
// the net PayPro should pay us. PayPro pays in batches (Rs 578 = 3 × Rs 193),
// so the payouts recorded in Finance as "PayPro payout" are ALLOCATED to the
// payments OLDEST FIRST by date: the oldest payment is settled first, then the
// next, and so on. Whatever the payouts do not cover is pending.
//
// The fee:
//   • known      — the PayPro export has the order: fee = amount − MerchantShare,
//                  net = MerchantShare.
//   • check      — the export's MerchantShare is ABOVE the amount (a negative
//                  fee): shown as "Check with PayPro"; net = MerchantShare (what
//                  PayPro says it will pay).
//   • estimated  — the order is not in any uploaded export yet: the fee most
//                  often seen for the same amount in the export is used; with no
//                  such order, the net is the gross and the fee reads "Check
//                  with PayPro".
// Refunds: a refunded payment stays in the report (PayPro still settles it to
// us — the refund is paid back to the member by us), and is listed beside the
// totals with the amount paid back.

export const FEE_CHECK_WORDS = 'Check with PayPro'

export type FeeKind = 'known' | 'check' | 'estimated'

export type PayproPaymentIn = {
  id: string
  ref: string
  /** When it was approved (ISO). */
  paidAt: string
  member: string
  gross: number
  /** The export row for this order, when one was uploaded. */
  exportAmount: number | null
  exportShare: number | null
  refundedPkr: number
  refundedAt: string | null
}

export type PayoutIn = { id: string; date: string; amount: number }

export type SettlementLine = {
  id: string
  ref: string
  paidAt: string
  member: string
  gross: number
  fee: number | null
  feeKind: FeeKind
  /** What PayPro should pay us for this payment. */
  net: number
  /** How much of `net` the payouts cover (oldest first). */
  settled: number
  pending: number
  /** Whole days since it was paid, while any of it is pending. */
  daysWaiting: number | null
  refundedPkr: number
}

export type SettlementReport = {
  lines: SettlementLine[]
  count: number
  gross: number
  fees: number
  netExpected: number
  received: number
  pending: number
  /** Payouts above everything expected (nothing to allocate them to). */
  unallocated: number
  oldestUnsettled: string | null
  unsettled: SettlementLine[]
  refunds: SettlementLine[]
  refundedTotal: number
  checkCount: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The fee most often seen for each amount in the export (ties → the smaller). */
export function typicalFees(rows: { amount: number | null; share: number | null }[]): Map<number, number> {
  const tally = new Map<number, Map<number, number>>()
  for (const r of rows) {
    if (r.amount == null || r.share == null) continue
    const fee = round2(r.amount - r.share)
    if (fee < 0) continue
    const by = tally.get(r.amount) ?? new Map<number, number>()
    by.set(fee, (by.get(fee) ?? 0) + 1)
    tally.set(r.amount, by)
  }
  const out = new Map<number, number>()
  for (const [amount, by] of tally) {
    const best = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
    if (best) out.set(amount, best[0])
  }
  return out
}

/** The fee and net of one payment. */
export function feeFor(p: PayproPaymentIn, typical: Map<number, number>): { fee: number | null; kind: FeeKind; net: number } {
  if (p.exportShare != null) {
    const amount = p.exportAmount ?? p.gross
    const fee = round2(amount - p.exportShare)
    return fee < 0 ? { fee, kind: 'check', net: round2(p.exportShare) } : { fee, kind: 'known', net: round2(p.exportShare) }
  }
  const t = typical.get(p.gross)
  if (t != null) return { fee: t, kind: 'estimated', net: round2(p.gross - t) }
  return { fee: null, kind: 'check', net: round2(p.gross) }
}

const DAY = 86_400_000

/** A credit counts as a PayPro payout when it is recorded as one AND its sender
 *  names PayPro. One recorded as a PayPro payout from any other sender is kept
 *  apart for the owner to check — it is never allocated to a payment. */
export function splitPayouts(credits: (PayoutIn & { sender: string | null })[]): { payouts: PayoutIn[]; notFromPaypro: PayoutIn[] } {
  const payouts: PayoutIn[] = []
  const notFromPaypro: PayoutIn[] = []
  for (const c of credits) {
    const row = { id: c.id, date: c.date, amount: c.amount }
    if (/paypro/i.test(c.sender ?? '')) payouts.push(row)
    else notFromPaypro.push(row)
  }
  return { payouts, notFromPaypro }
}

/** Allocate the payouts to the payments oldest first and total everything. */
export function buildSettlement(
  payments: PayproPaymentIn[],
  payouts: PayoutIn[],
  typical: Map<number, number>,
  now: Date,
): SettlementReport {
  const sorted = [...payments].sort((a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt) || a.ref.localeCompare(b.ref))
  let pool = round2(payouts.reduce((s, p) => s + p.amount, 0))
  const received = pool
  const lines: SettlementLine[] = sorted.map((p) => {
    const f = feeFor(p, typical)
    const settled = round2(Math.min(pool, f.net))
    pool = round2(pool - settled)
    const pending = round2(f.net - settled)
    return {
      id: p.id,
      ref: p.ref,
      paidAt: p.paidAt,
      member: p.member,
      gross: p.gross,
      fee: f.fee,
      feeKind: f.kind,
      net: f.net,
      settled,
      pending,
      daysWaiting: pending > 0 ? Math.max(0, Math.floor((now.getTime() - Date.parse(p.paidAt)) / DAY)) : null,
      refundedPkr: p.refundedPkr,
    }
  })
  const unsettled = lines.filter((l) => l.pending > 0)
  const refunds = lines.filter((l) => l.refundedPkr > 0)
  const netExpected = round2(lines.reduce((s, l) => s + l.net, 0))
  return {
    lines,
    count: lines.length,
    gross: round2(lines.reduce((s, l) => s + l.gross, 0)),
    fees: round2(lines.reduce((s, l) => s + (l.fee ?? 0), 0)),
    netExpected,
    received,
    pending: round2(lines.reduce((s, l) => s + l.pending, 0)),
    unallocated: pool,
    oldestUnsettled: unsettled[0]?.paidAt ?? null,
    unsettled,
    refunds,
    refundedTotal: round2(refunds.reduce((s, l) => s + l.refundedPkr, 0)),
    checkCount: lines.filter((l) => l.feeKind === 'check').length,
  }
}

/** "PayPro: Rs 1,234 not settled yet" — the Finance card's line. */
export function settlementCardLine(pending: number): string {
  return `PayPro: Rs ${Math.round(pending).toLocaleString('en-PK')} not settled yet`
}

export function feeLabel(l: Pick<SettlementLine, 'fee' | 'feeKind'>): string {
  if (l.feeKind === 'check') return FEE_CHECK_WORDS
  if (l.fee == null) return FEE_CHECK_WORDS
  const v = `Rs ${l.fee.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`
  return l.feeKind === 'estimated' ? `${v} (estimated)` : v
}
