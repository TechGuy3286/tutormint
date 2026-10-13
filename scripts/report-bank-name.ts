/**
 * scripts/report-bank-name.ts — read-only: the bank NAME members are shown for
 * a bank transfer, and whether the option is switched on. No account number or
 * IBAN is read. Nothing is written.
 *   npx tsx --env-file=.env.local scripts/report-bank-name.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(`select key, value from app_settings where key in ('pay.bank_name', 'pay.method.bank_transfer', 'pay.method.online') order by key`)
  for (const r of rows) console.log(`${r.key} = ${JSON.stringify(r.value)}`)
  const plans = await c.query(`select code, audience, price_pkr, active from plans order by audience, price_pkr`)
  console.log('plans:', plans.rows.map((p: { code: string; active: boolean }) => `${p.code}${p.active ? '' : ' (inactive)'}`).join(', '))
  await c.end()
}

void main()
