/**
 * scripts/report-bank-settings.ts — read-only. For each bank-detail setting,
 * says whether app_settings holds a value and whether the MANUAL_PAY_* env
 * fallback is set. Never prints a value.
 *   npx tsx --env-file=.env.local scripts/report-bank-settings.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const KEYS: [string, string | null][] = [
  ['pay.bank_name', 'MANUAL_PAY_BANK_NAME'],
  ['pay.account_title', 'MANUAL_PAY_ACCOUNT_TITLE'],
  ['pay.account_number', 'MANUAL_PAY_ACCOUNT_NUMBER'],
  ['pay.iban', 'MANUAL_PAY_IBAN'],
  ['pay.raast_id', null],
  ['pay.method.bank_transfer', null],
  ['pay.paypro.cutoff', null],
]

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const { rows } = await c.query(`select key, length(coalesce(value::text, '')) n from app_settings where key = any($1)`, [KEYS.map((k) => k[0])])
    const len = new Map<string, number>(rows.map((r: { key: string; n: number }) => [r.key, Number(r.n)]))
    for (const [k, env] of KEYS) {
      const set = (len.get(k) ?? 0) > 0
      console.log(`${k}: ${set ? 'set in settings' : len.has(k) ? 'empty in settings' : 'no row'}${env ? `; env ${process.env[env] ? 'set' : 'unset'}` : ''}`)
    }
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
