/**
 * scripts/report-big-credit.ts — READ ONLY (owner, 27 Oct 2026). Bank credits
 * of Rs 5,000 or more: date, amount, how they are labelled, source. Never a
 * name, account or reference.
 *
 *   npx tsx --env-file=.env.local scripts/report-big-credit.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  try {
    const q = await c.query(
      `select transferred_on::text as transferred_on, amount_pkr, gateway, category, source,
              (sender_name ilike '%paypro%' or sender_name ilike '%pay pro%') as sender_says_paypro
         from bank_transfers where amount_pkr >= 5000 order by transferred_on`,
    )
    for (const r of q.rows) console.log(`${r.transferred_on.toISOString?.().slice(0, 10) ?? r.transferred_on} · Rs ${r.amount_pkr} · labelled ${r.gateway === 'paypro' ? 'PayPro payout' : 'member transfer'}${r.category ? ` (${r.category})` : ''} · source ${r.source} · sender names PayPro: ${r.sender_says_paypro}`)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(String(e?.message ?? e))
  process.exit(1)
})
