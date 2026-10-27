/**
 * scripts/report-paypro-payouts.ts — READ ONLY. How the bank credits are
 * labelled (owner, 27 Oct 2026): counts and totals by gateway and source, and
 * how many name PayPro as the sender. No names, numbers or references printed.
 *
 *   npx tsx --env-file=.env.local scripts/report-paypro-payouts.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  try {
    const q = await c.query(`
      select gateway, source,
             (upper(coalesce(sender_name,'')) like '%PAYPRO%') as names_paypro,
             count(*)::int n, sum(amount_pkr)::numeric total
        from bank_transfers group by 1,2,3 order by 1,2,3`)
    for (const r of q.rows) console.log(`gateway=${r.gateway} source=${r.source} sender_names_paypro=${r.names_paypro} n=${r.n} total=${r.total}`)
    const links = await c.query(`select kind, count(*)::int n from settlement_links where removed_at is null group by 1`)
    for (const r of links.rows) console.log(`settlement_links kind=${r.kind} n=${r.n}`)
    const m = await c.query(`select provider, status, count(*)::int n, sum(amount_pkr)::int t from payments where status='approved' group by 1,2`)
    for (const r of m.rows) console.log(`payments provider=${r.provider} approved n=${r.n} total=${r.t}`)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
