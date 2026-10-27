/**
 * scripts/report-fee-autolink-debug.ts — READ ONLY (owner, 27 Oct 2026).
 * The board's approved fee bank-transfer payments (receipts) and their state,
 * and which credit each is matched to. Names and amounts only.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-fee-autolink-debug.ts [name-part]
 */
import { buildBoard } from '../lib/settlementMatchCore'
import { loadAll } from '../lib/settlementMatch'

async function main() {
  const filter = (process.argv[2] ?? '').toLowerCase()
  const all = await loadAll()
  if (!all) throw new Error('no board')
  const b = buildBoard({ ...all, nowIso: new Date().toISOString() })
  const creditBy = new Map(b.credits.map((c) => [c.id, c]))
  for (const r of b.receipts.filter((x) => x.approvedDay >= '2026-10-10').sort((x, y) => x.approvedDay.localeCompare(y.approvedDay))) {
    if (filter && !(r.payerName ?? '').toLowerCase().includes(filter)) continue
    const c = r.creditId ? creditBy.get(r.creditId) : null
    console.log(`${r.approvedDay} · ${r.payerName} · ${r.planCode} · Rs ${r.amountPkr} · sent ${r.createdAt?.slice(0, 16)} · approved ${r.reviewedAt?.slice(0, 16)} · ${r.state}${c ? ` → credit Rs ${c.amountPkr} ${c.date} ${c.senderName} (${c.match?.how})` : ''}`)
  }
  console.log('--- credits on/after 10 Oct')
  for (const c of b.credits.filter((x) => x.date >= '2026-10-10' && !x.isPaypro)) {
    console.log(`${c.date} ${c.time ?? ''} · Rs ${c.amountPkr} · ${c.senderName} · ${c.state}${c.ignoreKind ? ` (${c.ignoreKind})` : ''}${c.match ? ` · ${c.match.how}` : ''}`)
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
