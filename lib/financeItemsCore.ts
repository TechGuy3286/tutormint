// lib/financeItemsCore.ts
//
// The simpler Finance page (owner, 21 Oct 2026): ONE list of the month's money
// items — every bank credit, every PayPro order, every approved bank-transfer
// receipt, and every approved PayPro payment missing from the PayPro file —
// each in exactly ONE of two filters, "Needs attention" or "All good ✅", with
// a plain label. Built only from the settlement view (lib/settlementMatchCore
// monthView): the matching rules and every number are unchanged; this is
// layout.
//
// PURE — unit-tested by scripts/test-finance-items.ts.

import type { MonthView } from '@/lib/settlementMatchCore'

export type FinanceGroup = 'attention' | 'good'

export type FinanceItem = {
  /** Unique across the list: credit:<id> · order:<number> · receipt:<id> · missing:<ref>. */
  key: string
  kind: 'credit' | 'order' | 'receipt' | 'missing' | 'alert' | 'refund_due'
  group: FinanceGroup
  /** The plain label, e.g. "Money in the bank, not linked yet". */
  label: string
  /** The money figure for the row (Rs), when there is one. */
  amount: number | null
  day: string | null
  /** Shown in red (overdue, or something that does not add up). */
  red: boolean
  creditId?: string
  orderNumber?: string
  receiptId?: string
  ref?: string
  /** A credit: read from the bank's email, or entered by hand. */
  source?: 'Email' | 'Manual'
  /** An alert (finance_alerts): its id and plain detail. */
  alertId?: string
  detail?: string | null
  /** A refund due (refund_dues): its id. */
  refundDueId?: string
}

/** Per-credit hints (lib/feeMatch creditHints): a one-tap suggestion, a
 *  partial payment, or the rounding a linked fee credit carried. */
export type CreditHintInput =
  | { kind: 'suggest'; paymentId: string; paymentRef: string; memberId: string | null; memberName: string | null }
  | { kind: 'partial'; short: number; memberId: string | null; memberName: string | null }
  | { kind: 'rounding'; rounding: number }

/** An open refund due (refund_dues). */
export type RefundDueInput = { id: string; memberName: string | null; paymentRef: string | null; amountPkr: number; createdAt: string }

const rsWords = (n: number) => `Rs ${n.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`

/** A Finance → Needs attention item that is not money (migration 200). */
export type AlertInput = { id: string; title: string; detail: string | null; amountPkr: number | null; happenedAt: string | null; createdAt: string }

const days = (n: number | null | undefined) => (n === null || n === undefined ? '' : ` (${n} day${n === 1 ? '' : 's'})`)

export function financeItems(
  view: MonthView,
  alerts: readonly AlertInput[] = [],
  hints: Readonly<Record<string, CreditHintInput>> = {},
  refunds: readonly RefundDueInput[] = [],
): FinanceItem[] {
  const out: FinanceItem[] = []

  // Refunds due (owner, 27 Oct 2026): a duplicate payment to send back. Always
  // Needs attention until marked refunded, whatever month the credit is in.
  for (const r of refunds) {
    out.push({
      key: `refund:${r.id}`,
      kind: 'refund_due',
      group: 'attention',
      label: `Refund due — ${r.memberName ?? 'member'} paid twice`,
      amount: r.amountPkr,
      day: r.createdAt.slice(0, 10),
      red: true,
      refundDueId: r.id,
      detail: r.paymentRef ? `Duplicate of ${r.paymentRef}` : null,
    })
  }

  // Alerts first: a late PayPro callback, a bank email that could not be read
  // or verified, a mailbox that is not bank-only, the reader failing.
  for (const a of alerts) {
    out.push({
      key: `alert:${a.id}`,
      kind: 'alert',
      group: 'attention',
      label: a.title,
      amount: a.amountPkr,
      day: (a.happenedAt ?? a.createdAt).slice(0, 10),
      red: true,
      alertId: a.id,
      detail: a.detail,
    })
  }

  for (const c of view.credits) {
    const mismatch = c.state === 'matched' && c.match?.status === 'amount_mismatch'
    const group: FinanceGroup = c.state === 'unmatched' || c.state === 'held' || mismatch ? 'attention' : 'good'
    const hint = hints[c.id]
    const label =
      c.state === 'ignored'
        ? c.ignoreKind === 'refund_due'
          ? 'Duplicate payment — refund due'
          : c.ignoreKind === 'owner_transfer'
            ? 'Owner / partner transfer (not revenue)'
            : 'Ignored (not a sale)'
        : hint?.kind === 'partial' && c.state !== 'matched'
          ? `Partial — ${rsWords(hint.short)} short${hint.memberName ? ` · likely ${hint.memberName}` : ''}`
          : hint?.kind === 'suggest' && c.state !== 'matched'
            ? `Money in the bank, not linked yet · maybe ${hint.memberName ?? 'a member'}'s payment ${hint.paymentRef}`
        : mismatch
          ? "Money in the bank, amount doesn't match what it pays"
          : c.state === 'matched'
            ? `Money in the bank, linked ✅${hint?.kind === 'rounding' ? ` (${rsWords(hint.rounding)} rounding)` : ''}`
            : c.state === 'held'
              ? 'Money in the bank, unlinked by hand'
              : 'Money in the bank, not linked yet'
    out.push({ key: `credit:${c.id}`, kind: 'credit', group, label, amount: c.amountPkr, day: c.date, red: group === 'attention', creditId: c.id, source: c.source === 'email' ? 'Email' : 'Manual' })
  }

  for (const o of view.orders) {
    const problems: string[] = []
    if (o.flags.includes('not_approved')) problems.push('Paid at PayPro, not approved on TutorMint')
    else if (o.flags.includes('not_in_tutormint')) problems.push('In the PayPro file, not in TutorMint')
    if (o.flags.includes('amount_differs')) problems.push('PayPro amount differs from TutorMint')
    if (o.state === 'waiting') problems.push(`Paid, waiting for the bank${days(o.ageDays)}`)
    if (o.state === 'settled_no_credit') problems.push(`PayPro paid it out, no bank credit yet${days(o.ageDays)}`)
    const group: FinanceGroup = problems.length > 0 ? 'attention' : 'good'
    const label = group === 'attention' ? problems.join(' · ') : o.state === 'matched' ? 'Paid and in the bank ✅' : 'Not paid at PayPro'
    const red = o.flags.length > 0 || o.overdue
    out.push({
      key: `order:${o.orderNumber}`,
      kind: 'order',
      group,
      label,
      amount: o.merchantShare ?? o.orderAmount,
      day: o.datePaid ?? o.settleDate,
      red: group === 'attention' && red,
      orderNumber: o.orderNumber,
    })
  }

  for (const r of view.receipts) {
    const waiting = r.state === 'waiting'
    out.push({
      key: `receipt:${r.id}`,
      kind: 'receipt',
      group: waiting ? 'attention' : 'good',
      label: waiting ? `Bank transfer approved, no bank credit yet${days(r.ageDays)}` : 'Bank transfer in the bank ✅',
      amount: r.amountPkr,
      day: r.approvedDay,
      red: waiting && r.overdue,
      receiptId: r.id,
      ref: r.ref,
    })
  }

  // Approved on TutorMint inside the file's dates, not in the PayPro file.
  for (const a of view.attention) {
    if (a.kind !== 'not_in_export') continue
    const ref = a.title.split(': ').slice(1).join(': ') || a.title
    out.push({ key: `missing:${ref}`, kind: 'missing', group: 'attention', label: 'Approved on TutorMint, not in the PayPro file', amount: null, day: a.day, red: true, ref })
  }

  // Red first, then newest.
  return out.sort((a, b) => Number(b.red) - Number(a.red) || (b.day ?? '').localeCompare(a.day ?? '') || a.key.localeCompare(b.key))
}

export function financeCounts(items: FinanceItem[]): Record<FinanceGroup, number> {
  return {
    attention: items.filter((i) => i.group === 'attention').length,
    good: items.filter((i) => i.group === 'good').length,
  }
}

export function pickFinanceGroup(v: string | null | undefined, counts: Record<FinanceGroup, number>): FinanceGroup {
  if (v === 'attention' || v === 'good') return v
  return counts.attention > 0 ? 'attention' : 'good'
}

/** The three summary cards. Received and In the bank are the settlement
 *  view's own figures; Needs attention is the filter's count. */
export function financeCards(view: MonthView, items: FinanceItem[]) {
  return { received: view.cards.received, inBank: view.cards.netSettled, attention: financeCounts(items).attention }
}
