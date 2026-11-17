/**
 * scripts/report-pr03-paypro.ts — READ-ONLY (PR-03, 17 Nov 2026). What PayPro
 * still owes, and how the earlier 1,102 and 973 figures arose. Counts and
 * amounts only — no name, account, mobile or reference is printed.
 *   npx tsx --env-file=.env.local scripts/report-pr03-paypro.ts
 */
import { createClient } from '@supabase/supabase-js'
import { allocatePayproFees, settlementUnits } from '../lib/bankStatementCore'

async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}
const r2 = (n: number) => Math.round(n * 100) / 100

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const pays = await all<{ id: string; provider_ref: string | null; amount_pkr: number; reviewed_at: string | null; created_at: string; user_id: string | null; refunded_amount_pkr: number | null }>((f, t) =>
    db.from('payments').select('id, provider_ref, amount_pkr, reviewed_at, created_at, user_id, refunded_amount_pkr').eq('provider', 'paypro').eq('status', 'approved').order('id').range(f, t),
  )
  const exportRows = await all<{ order_number: string; order_amount: number | null; merchant_share: number | null; settle_date: string | null }>((f, t) =>
    db.from('reconciliation_rows').select('order_number, order_amount, merchant_share, settle_date').eq('gateway', 'paypro').eq('is_current', true).order('id').range(f, t),
  )
  const credits = await all<{ id: string; transferred_on: string; amount_pkr: number; sender_name: string | null; personal_at: string | null; category: string | null; source: string }>((f, t) =>
    db.from('bank_transfers').select('id, transferred_on, amount_pkr, sender_name, personal_at, category, source').eq('gateway', 'paypro').order('transferred_on').range(f, t),
  )
  const gross = r2(pays.reduce((s, p) => s + Number(p.amount_pkr), 0))
  const exportBy = new Map(exportRows.map((r) => [r.order_number.trim().toUpperCase(), r]))
  let exportFees = 0
  let negative = 0
  for (const p of pays) {
    const ex = exportBy.get((p.provider_ref ?? '').trim().toUpperCase())
    if (ex?.merchant_share != null) {
      const fee = Number(ex.order_amount ?? p.amount_pkr) - Number(ex.merchant_share)
      exportFees += fee
      if (fee < 0) negative++
    }
  }
  const fromPaypro = credits.filter((c) => /paypro/i.test(c.sender_name ?? '') && !c.personal_at && c.category !== 'owner_transfer')
  const notPaypro = credits.filter((c) => !/paypro/i.test(c.sender_name ?? ''))
  const received = r2(fromPaypro.reduce((s, c) => s + Number(c.amount_pkr), 0))

  console.log(`PayPro payments approved: ${pays.length} · gross Rs ${gross} · refunded ${pays.filter((p) => Number(p.refunded_amount_pkr ?? 0) > 0).length} · deleted-account ${pays.filter((p) => !p.user_id).length}`)
  console.log(`  by amount: ${[...new Set(pays.map((p) => Number(p.amount_pkr)))].map((a) => `Rs ${a} × ${pays.filter((p) => Number(p.amount_pkr) === a).length}`).join(', ')}`)
  console.log(`PayPro export: ${exportRows.length} orders · fees per export Rs ${r2(exportFees)} (${negative} orders with MerchantShare above the amount)`)
  console.log(`Settlement credits named PayPro: ${fromPaypro.length} · Rs ${received} · by source ${[...new Set(fromPaypro.map((c) => c.source))].join(', ')}`)
  for (const c of fromPaypro) {
    const u = settlementUnits(Number(c.amount_pkr))
    console.log(`  ${c.transferred_on} Rs ${c.amount_pkr} → ${u ? `${u.units} payment(s) at Rs ${u.unit}${u.bankCharge ? ' (Rs 1 bank charge)' : ''}` : 'not a multiple of 193'}`)
  }
  console.log(`Credits recorded as PayPro payout but not from PayPro: ${notPaypro.length} · Rs ${r2(notPaypro.reduce((s, c) => s + Number(c.amount_pkr), 0))}${notPaypro.some((c) => c.personal_at) ? ' (some marked personal)' : ''}`)
  const settledUnits = fromPaypro.reduce((s, c) => s + (settlementUnits(Number(c.amount_pkr))?.units ?? 0), 0)
  console.log(`Settled payments by the credits: ${settledUnits}`)

  const alloc = allocatePayproFees(pays.map((p) => ({ id: p.id, paidAt: p.reviewed_at ?? p.created_at, gross: Number(p.amount_pkr) })), fromPaypro.map((c) => ({ id: c.id, date: c.transferred_on, amount: Number(c.amount_pkr) })))
  const realFees = r2([...alloc.feeBy.values()].reduce((s, f) => s + f, 0))
  const noFee = pays.filter((p) => !alloc.feeBy.has(p.id)).length
  console.log('--- the three figures')
  console.log(`1,102-style (no fee taken off): gross Rs ${gross} − received Rs ${received} = Rs ${r2(gross - received)}`)
  console.log(`973-style (export fees): Rs ${r2(gross - exportFees)} − Rs ${received} = Rs ${r2(gross - exportFees - received)}`)
  console.log(`Real fee (Rs 6 a payment from the settlements): fees Rs ${realFees}${noFee ? ` (${noFee} payment(s) of another amount at no known fee)` : ''} · expected Rs ${r2(gross - realFees)} · received Rs ${received} · still owed Rs ${r2(gross - realFees - received)}`)
  const unsettled = pays.filter((p) => !alloc.settledBy.has(p.id))
  console.log(`Payments no settlement covers yet: ${unsettled.length} · oldest approved ${unsettled.map((p) => (p.reviewed_at ?? p.created_at).slice(0, 10)).sort()[0] ?? '—'}`)
  const byMonth = new Map<string, { n: number; gross: number }>()
  for (const p of pays) {
    const m = (p.reviewed_at ?? p.created_at).slice(0, 7)
    const v = byMonth.get(m) ?? { n: 0, gross: 0 }
    v.n++
    v.gross += Number(p.amount_pkr)
    byMonth.set(m, v)
  }
  for (const [m, v] of [...byMonth.entries()].sort()) console.log(`  ${m}: ${v.n} payments · Rs ${v.gross}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'failed')
  process.exit(1)
})
