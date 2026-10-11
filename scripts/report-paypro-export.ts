/**
 * scripts/report-paypro-export.ts — read a PayPro Orders export on this machine
 * and print counts only (owner, 11 Oct 2026). Read-only: no database, no
 * network. It never prints an order's customer details — the parser does not
 * keep them.
 *   npx tsx --conditions=react-server scripts/report-paypro-export.ts "C:\path\to\order-….xlsx"
 */
import { readFileSync } from 'node:fs'

import { readPayproExport } from '../lib/payproExport'
import { isPaid } from '../lib/reconciliationCore'
import { isSettled } from '../lib/settlementCore'
import { payMethod } from '../lib/settlementMatchCore'

async function main() {
  const path = process.argv[2]
  if (!path) throw new Error('Give the path of the export.')
  const read = await readPayproExport(readFileSync(path), path)
  if (!read.ok) {
    console.log('NOT READ:', read.error)
    return
  }
  const rows = read.rows
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length
  const statuses: Record<string, number> = {}
  for (const r of rows) statuses[r.transactionStatus ?? '(empty)'] = (statuses[r.transactionStatus ?? '(empty)'] ?? 0) + 1
  const methods: Record<string, number> = {}
  for (const r of rows) methods[payMethod(r.paymentVia)] = (methods[payMethod(r.paymentVia)] ?? 0) + 1
  const settled = rows.filter((r) => isPaid(r.transactionStatus) && isSettled(r))
  const days = rows.map((r) => r.datePaid).filter((d): d is string => !!d).sort()
  console.log(
    JSON.stringify(
      {
        sheet: read.sheet,
        rowsRead: rows.length,
        statuses,
        methods,
        paid: count((r) => isPaid(r.transactionStatus)),
        settled: settled.length,
        settledMerchantShare: Math.round(settled.reduce((s, r) => s + (r.merchantShare ?? 0), 0) * 100) / 100,
        settleDates: [...new Set(settled.map((r) => r.settleDate))].sort(),
        paidFrom: days[0] ?? null,
        paidTo: days[days.length - 1] ?? null,
        amountsMissingOnPaid: count((r) => isPaid(r.transactionStatus) && (r.orderAmount === null || r.merchantShare === null)),
        datePaidMissingOnPaid: count((r) => isPaid(r.transactionStatus) && !r.datePaid),
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
