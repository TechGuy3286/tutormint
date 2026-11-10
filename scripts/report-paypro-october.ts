/**
 * scripts/report-paypro-october.ts — READ ONLY (owner, 10 Nov 2026). Explains
 * the Finance month table for a month (default 2026-10) against the PayPro
 * settlement report: what makes Expected differ from Collected, why PayPro
 * deductions read Rs 0, how Due from PayPro is worked out, and which bank
 * credits are counted as PayPro payouts. Counts and rupee totals only — no
 * member name, number, account or reference is printed. Writes nothing.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-paypro-october.ts [YYYY-MM]
 */
import { createAdminClient } from '../lib/supabase/admin'
import { pageAll } from '../lib/pageAll'
import { loadFinance, loadFinancePayments } from '../lib/finance'
import { classify, pkMonth } from '../lib/financeCore'
import { loadPayproSettlement } from '../lib/payproSettlement'
import { ignoredCreditIds } from '../lib/ignoredCredits'

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`

async function main() {
  const ym = process.argv[2] ?? '2026-10'
  const admin = createAdminClient()
  if (!admin) throw new Error('no service client')

  const fin = await loadFinance()
  console.log('== Finance month table ==')
  for (const m of fin.months.slice(0, 4)) {
    console.log(`${m.month}: collected ${rs(m.collected)} · deductions ${rs(m.payproDeductions)} · expected ${rs(m.expectedInBank)} · received ${rs(m.receivedInBank)} · due ${rs(m.dueFromPaypro)}`)
  }

  const pays = (await loadFinancePayments()).filter((p) => pkMonth(p.approvedAt) === ym)
  console.log(`\n== Approved payments in ${ym}, by provider and class ==`)
  const groups = new Map<string, { n: number; a: number }>()
  for (const p of pays) {
    const k = `${p.provider ?? 'none'} / ${classify(p)}`
    const g = groups.get(k) ?? { n: 0, a: 0 }
    g.n++
    g.a += p.amountPkr
    groups.set(k, g)
  }
  for (const [k, g] of groups) console.log(`${k}: ${g.n} payments, ${rs(g.a)}`)

  const { data: ded } = await admin.from('gateway_deductions').select('id, name, removed_at, effective_from')
  console.log(`\n== Deduction lines stored: ${(ded ?? []).length} (live ${(ded ?? []).filter((d) => !d.removed_at).length}) ==`)

  // PayPro raw callback data: does it carry a fee?
  const raws = await pageAll<{ raw: Record<string, unknown> | null; reviewed_at: string | null }>((from, to) =>
    admin.from('payments').select('raw, reviewed_at').eq('provider', 'paypro').eq('status', 'approved').order('id').range(from, to),
  )
  const keys = new Map<string, number>()
  const walk = (o: unknown, path: string) => {
    if (!o || typeof o !== 'object') return
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p)
      else keys.set(p, (keys.get(p) ?? 0) + 1)
    }
  }
  for (const r of raws) walk(r.raw, '')
  console.log(`\n== Stored raw keys on ${raws.length} approved PayPro payments (fee-like keys flagged) ==`)
  for (const [k, n] of [...keys.entries()].sort()) {
    const flag = /fee|charge|share|commission|deduct|merchant|net|settle/i.test(k) ? '  <-- fee-like' : ''
    console.log(`${k}: ${n}${flag}`)
  }

  // Export coverage for the month's PayPro payments.
  const rows = await pageAll<{ order_number: string; order_amount: number | null; merchant_share: number | null; settle_status: string | null; settle_date: string | null }>((from, to) =>
    admin.from('reconciliation_rows').select('order_number, order_amount, merchant_share, settle_status, settle_date').eq('gateway', 'paypro').eq('is_current', true).order('id').range(from, to),
  )
  const byRef = new Map(rows.map((r) => [r.order_number.trim().toUpperCase(), r]))
  const pp = pays.filter((p) => p.provider === 'paypro')
  let inExport = 0
  let fees = 0
  let negative = 0
  for (const p of pp) {
    const r = byRef.get((p.ref ?? '').trim().toUpperCase())
    if (r && r.merchant_share != null) {
      inExport++
      const f = Number(r.order_amount ?? p.amountPkr) - Number(r.merchant_share)
      fees += f
      if (f < 0) negative++
    }
  }
  console.log(`\n== PayPro payments in ${ym}: ${pp.length}, gross ${rs(pp.reduce((s, p) => s + p.amountPkr, 0))} ==`)
  console.log(`In the uploaded PayPro export: ${inExport}; export fees on those (amount − MerchantShare): ${rs(fees)} (${negative} negative)`)
  const { data: imp } = await admin.from('reconciliation_imports').select('created_at, gateway').order('created_at', { ascending: false }).limit(3)
  console.log(`Latest PayPro export uploads: ${(imp ?? []).map((i) => `${String(i.created_at).slice(0, 16)} (${i.gateway})`).join(', ') || 'none'}`)

  // Bank credits recorded as PayPro payouts.
  const ignored = await ignoredCreditIds()
  const tr = await pageAll<{ id: string; transferred_on: string; amount_pkr: number; sender_name: string | null; source: string | null; gateway: string | null; category: string | null }>((from, to) =>
    admin.from('bank_transfers').select('id, transferred_on, amount_pkr, sender_name, source, gateway, category').order('transferred_on').range(from, to),
  )
  console.log(`\n== Bank credits (gateway paypro), by date ==`)
  for (const t of tr.filter((x) => x.gateway === 'paypro')) {
    console.log(`${t.transferred_on} · ${rs(Number(t.amount_pkr))} · sender names PayPro: ${/paypro/i.test(t.sender_name ?? '') ? 'yes' : 'no'} · source ${t.source ?? '-'} · ${ignored.has(String(t.id)) ? 'EXCLUDED' : 'counted'}`)
  }
  const manual = tr.filter((x) => x.gateway !== 'paypro')
  console.log(`Member bank-transfer credits: ${manual.length}, ${rs(manual.reduce((s, t) => s + Number(t.amount_pkr), 0))}`)

  const s = await loadPayproSettlement()
  if (s) {
    console.log(`\n== PayPro settlement report (all time) ==`)
    console.log(`payments ${s.count} · gross ${rs(s.gross)} · fees ${rs(s.fees)} (${s.checkCount} check, ${s.lines.filter((l) => l.feeKind === 'estimated').length} estimated) · net ${rs(s.netExpected)} · received ${rs(s.received)} · pending ${rs(s.pending)} over ${s.unsettled.length} · oldest ${s.oldestUnsettled?.slice(0, 10) ?? '-'} · unallocated ${rs(s.unallocated)}`)
    console.log(`not from PayPro: ${s.notFromPaypro.map((p) => `${p.date} ${rs(p.amount)}`).join(', ') || 'none'}`)
    const byMonth = new Map<string, { n: number; pending: number; net: number; fee: number }>()
    for (const l of s.lines) {
      const k = pkMonth(l.paidAt)
      const g = byMonth.get(k) ?? { n: 0, pending: 0, net: 0, fee: 0 }
      g.n++
      g.pending += l.pending
      g.net += l.net
      g.fee += l.fee ?? 0
      byMonth.set(k, g)
    }
    for (const [k, g] of byMonth) console.log(`${k}: ${g.n} payments · fees ${rs(g.fee)} · net ${rs(g.net)} · pending ${rs(g.pending)}`)
    const refOf = new Map(pays.map((p) => [p.id, p.ref ?? '']))
    for (const l of s.unsettled) {
      const r = byRef.get((refOf.get(l.id) ?? l.ref).trim().toUpperCase())
      console.log(`unsettled: paid ${l.paidAt.slice(0, 10)} · net ${rs(l.net)} · pending ${rs(l.pending)} · fee ${l.feeKind} · export settle status ${r?.settle_status ?? '-'} · settle date ${r?.settle_date ?? '-'}`)
    }
  }

  // PayPro's own callback fee field vs the export fee.
  const rawFees = await pageAll<{ provider_ref: string | null; amount_pkr: number; raw: { paypro?: { isFeeApplied?: unknown; paid?: { fee?: unknown; amountPaid?: unknown; amountPayable?: unknown } } } | null }>((from, to) =>
    admin.from('payments').select('provider_ref, amount_pkr, raw').eq('provider', 'paypro').eq('status', 'approved').order('id').range(from, to),
  )
  const feeVals = new Map<string, number>()
  let cbFeeSum = 0
  let paidMinusAmount = 0
  for (const p of rawFees) {
    const f = p.raw?.paypro?.paid?.fee
    const k = `fee=${JSON.stringify(f)} isFeeApplied=${JSON.stringify(p.raw?.paypro?.isFeeApplied)} paid=${JSON.stringify(p.raw?.paypro?.paid?.amountPaid)} payable=${JSON.stringify(p.raw?.paypro?.paid?.amountPayable)} amount=${p.amount_pkr}`
    feeVals.set(k, (feeVals.get(k) ?? 0) + 1)
    cbFeeSum += Number(f ?? 0) || 0
    paidMinusAmount += (Number(p.raw?.paypro?.paid?.amountPaid ?? 0) || 0) - Number(p.amount_pkr)
  }
  console.log(`\n== PayPro callback fields (value pattern: count) ==`)
  for (const [k, n] of feeVals) console.log(`${k}: ${n}`)
  console.log(`Sum of callback 'fee': ${rs(cbFeeSum)} · sum of (amountPaid − our amount): ${rs(paidMinusAmount)}`)
  const settleStatuses = new Map<string, number>()
  for (const r of rows) settleStatuses.set(r.settle_status ?? '-', (settleStatuses.get(r.settle_status ?? '-') ?? 0) + 1)
  const bySettle = new Map<string, { n: number; share: number; amount: number }>()
  for (const r of rows) {
    if (!r.settle_date) continue
    const g = bySettle.get(r.settle_date) ?? { n: 0, share: 0, amount: 0 }
    g.n++
    g.share += Number(r.merchant_share ?? 0)
    g.amount += Number(r.order_amount ?? 0)
    bySettle.set(r.settle_date, g)
  }
  const creditBy = new Map<string, number[]>()
  for (const t of tr.filter((x) => x.gateway === 'paypro' && /paypro/i.test(x.sender_name ?? ''))) {
    creditBy.set(t.transferred_on, [...(creditBy.get(t.transferred_on) ?? []), Number(t.amount_pkr)])
  }
  console.log(`\n== PayPro export by settle date vs PayPro credits recorded on that day ==`)
  const days = [...new Set([...bySettle.keys(), ...creditBy.keys()])].sort()
  let shareTot = 0
  let creditTot = 0
  for (const d of days) {
    const g = bySettle.get(d)
    const c = creditBy.get(d) ?? []
    shareTot += g?.share ?? 0
    creditTot += c.reduce((s, x) => s + x, 0)
    console.log(`${d}: PayPro settled ${g?.n ?? 0} orders, MerchantShare ${rs(g?.share ?? 0)} (gross ${rs(g?.amount ?? 0)}) · credits recorded ${c.map(rs).join(' + ') || 'none'}`)
  }
  console.log(`Totals: PayPro says settled ${rs(shareTot)} · credits recorded ${rs(creditTot)}`)
  const { data: reader } = await admin.from('bank_reader_state').select('enabled, status, last_success_at, credits_added').eq('id', 1).maybeSingle()
  console.log(`Bank email reader: ${reader ? `enabled ${reader.enabled}, status ${reader.status}, last success ${reader.last_success_at ?? '-'}, credits added ${reader.credits_added}` : 'no row'}`)
  console.log(`Export rows by settle status: ${[...settleStatuses.entries()].map(([k, n]) => `${k} ${n}`).join(', ')}`)
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  },
)
