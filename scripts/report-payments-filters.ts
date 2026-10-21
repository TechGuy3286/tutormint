/**
 * scripts/report-payments-filters.ts — READ ONLY (owner, 21 Oct 2026).
 *
 * How the Payments page's two filters (Paid / Completed, Unpaid / Incomplete)
 * split every payment today, how many rows are hidden as nameless, and every
 * PayPro order whose fee (Order-Amount − MerchantShare) is negative. Never
 * prints a phone number, email, account number or IBAN. Changes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/report-payments-filters.ts
 */

// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { paymentBucket, isNamelessPayment, type PaymentFilterFacts } from '../lib/paymentFiltersCore'
import { feeNeedsCheck, feeOf } from '../lib/settlementMatchCore'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const { rows } = await c.query(
      `select p.id, p.status, p.provider, p.screenshot_path is not null as has_receipt, p.reference,
              p.amount_pkr, p.refunded_amount_pkr, p.checkout_closed_at, p.checkout_close_reason,
              p.user_id, p.note, p.created_at, pr.full_name, pr.is_test_name, pr.hidden_from_public
         from payments p left join profiles pr on pr.id = p.user_id`,
    )
    const counts: Record<string, number> = { paid: 0, unpaid: 0, waiting: 0, hidden: 0, hiddenPaid: 0 }
    const byLabel: Record<string, number> = {}
    for (const r of rows) {
      const f: PaymentFilterFacts = {
        status: r.status,
        provider: r.provider,
        hasReceipt: r.has_receipt,
        payerReference: r.reference,
        amountPkr: r.amount_pkr,
        refundedAmountPkr: r.refunded_amount_pkr,
        checkoutClosedAt: r.checkout_closed_at ? String(r.checkout_closed_at) : null,
        checkoutCloseReason: r.checkout_close_reason,
        createdAt: new Date(r.created_at).toISOString(),
        hasMember: !!r.user_id && !!r.full_name && r.full_name.trim() !== '',
        isTestAccount: !!r.is_test_name || !!r.hidden_from_public,
      }
      const b = paymentBucket(f, Date.now())
      const hidden = isNamelessPayment(f)
      if (hidden) {
        counts.hidden++
        if (b.filter === 'paid') counts.hiddenPaid++
        continue
      }
      counts[b.filter]++
      if (b.waiting) counts.waiting++
      byLabel[b.label] = (byLabel[b.label] ?? 0) + 1
    }
    console.log('Total payments:', rows.length)
    console.log('Visible Paid / Completed:', counts.paid)
    console.log('Visible Unpaid / Incomplete:', counts.unpaid, '(receipts waiting:', counts.waiting + ')')
    console.log('Hidden nameless rows:', counts.hidden, '(of which paid:', counts.hiddenPaid + ')')
    console.log('Labels:', byLabel)

    const orders = await c.query(
      `select order_number, method, transaction_status, order_amount, merchant_share, date_paid, settle_date
         from reconciliation_rows where is_current = true`,
    )
    console.log('\nPayPro orders (current):', orders.rows.length)
    for (const o of orders.rows) {
      const fee = feeOf({ orderAmount: o.order_amount === null ? null : Number(o.order_amount), merchantShare: o.merchant_share === null ? null : Number(o.merchant_share) })
      if (feeNeedsCheck(fee)) {
        console.log('  negative fee:', o.order_number, o.method, o.transaction_status, 'amount', o.order_amount, 'share', o.merchant_share, 'fee', fee, 'paid', o.date_paid, 'settled', o.settle_date)
      }
    }
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
