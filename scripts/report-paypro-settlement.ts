/**
 * scripts/report-paypro-settlement.ts — READ ONLY. The PayPro settlement figures
 * (owner, 27 Oct 2026): payments, gross, fees, net expected, payouts received,
 * pending and the oldest unsettled date. Counts and rupee totals only — no
 * member name, number or reference is printed.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-paypro-settlement.ts
 */
import { loadPayproSettlement } from '../lib/payproSettlement'

async function main() {
  const r = await loadPayproSettlement()
  if (!r) throw new Error('no service client')
  const rs = (n: number) => `Rs ${n.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`
  console.log(`PayPro payments: ${r.count}`)
  console.log(`Gross: ${rs(r.gross)}`)
  console.log(`Fees: ${rs(r.fees)} (${r.checkCount} marked "Check with PayPro"; ${r.lines.filter((l) => l.feeKind === 'estimated').length} estimated)`)
  console.log(`Net expected: ${rs(r.netExpected)}`)
  console.log(`Payouts received: ${rs(r.received)}`)
  console.log(`Pending: ${rs(r.pending)} across ${r.unsettled.length} payment(s)`)
  console.log(`Unallocated payouts: ${rs(r.unallocated)}`)
  console.log(`Oldest unsettled: ${r.oldestUnsettled ? r.oldestUnsettled.slice(0, 10) : 'none'}`)
  console.log(`Recorded as PayPro payout but sender is not PayPro (not counted): ${r.notFromPaypro.length} (${rs(r.notFromPaypro.reduce((s, p) => s + p.amount, 0))})`)
  console.log(`Refunds: ${r.refunds.length} (${rs(r.refundedTotal)} paid back)`)
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  },
)
