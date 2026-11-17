/**
 * scripts/report-pr03-before.ts — READ-ONLY (PR-03, 17 Nov 2026). Counts only:
 * bank credits by source / gateway / month, PayPro payments by month, pending
 * bank-transfer receipts. No name, number, account or reference is printed.
 *   npx tsx --env-file=.env.local scripts/report-pr03-before.ts
 */
import { createClient } from '@supabase/supabase-js'

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

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const credits = await all<{ id: string; source: string; gateway: string | null; transferred_on: string; amount_pkr: number; personal_at: string | null; sender_name: string | null; category: string | null }>((f, t) =>
    db.from('bank_transfers').select('id, source, gateway, transferred_on, amount_pkr, personal_at, sender_name, category').order('id').range(f, t),
  )
  const tally = new Map<string, { n: number; amt: number }>()
  for (const c of credits) {
    const payproName = /paypro/i.test(c.sender_name ?? '') ? 'paypro-named' : 'other-name'
    const k = `${c.transferred_on.slice(0, 7)} ${c.source} gw=${c.gateway} ${payproName}${c.personal_at ? ' PERSONAL' : ''}${c.category ? ` cat=${c.category}` : ''}`
    const v = tally.get(k) ?? { n: 0, amt: 0 }
    v.n++
    v.amt += Number(c.amount_pkr)
    tally.set(k, v)
  }
  console.log('bank credits:', credits.length)
  for (const [k, v] of [...tally.entries()].sort()) console.log(`  ${k}: ${v.n} · Rs ${v.amt}`)
  const pay = await all<{ provider: string; status: string; amount_pkr: number; reviewed_at: string | null; created_at: string; plan_code: string | null; screenshot_path: string | null }>((f, t) =>
    db.from('payments').select('provider, status, amount_pkr, reviewed_at, created_at, plan_code, screenshot_path').in('status', ['approved', 'pending', 'rejected']).order('id').range(f, t),
  )
  const p2 = new Map<string, { n: number; amt: number }>()
  for (const p of pay) {
    if (p.status === 'pending' && p.provider !== 'manual') continue
    const k = `${(p.reviewed_at ?? p.created_at).slice(0, 7)} ${p.provider} ${p.status} ${p.plan_code}${p.screenshot_path ? ' receipt' : ''}`
    const v = p2.get(k) ?? { n: 0, amt: 0 }
    v.n++
    v.amt += Number(p.amount_pkr)
    p2.set(k, v)
  }
  console.log('payments:')
  for (const [k, v] of [...p2.entries()].sort()) console.log(`  ${k}: ${v.n} · Rs ${v.amt}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'failed')
  process.exit(1)
})
