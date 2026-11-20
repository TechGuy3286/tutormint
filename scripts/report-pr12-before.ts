/** PR-12 read-only "before" audit. Prints counts and ids only — never a phone, email, CNIC or account number.
 *  npx tsx --env-file=.env.local scripts/report-pr12-before.ts */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const PATTERN = String.raw`middle ?m[ae]n|commission|no agent|without (an )?agent|agent[- ]free|koi agent|ایجنٹ|کمیشن|مڈل ?مین`
const SKIP = /(_log|_sends|_events|audit|activity|rate_limit|legacy_|indexing_queue|search|_rows$|admin_summary|admin_list_rows|pending_signups|sessions)/i

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 20000 })
  await c.connect()
  try {
    await c.query('begin read only')
    const staff = await c.query(`select id, coalesce(display_name, full_name) as name, admin_role from profiles where admin_role is not null order by admin_role`)
    console.log('STAFF'); for (const r of staff.rows) console.log(' ', r.admin_role, r.id, r.name)

    const pp = await c.query(`select status, count(*)::int n, max(created_at) last from payments where provider = 'paypro' group by status`)
    console.log('PAYPRO payments by status', pp.rows)
    const pend = await c.query(`select count(*)::int n from payments where provider='paypro' and status='pending' and created_at > now() - interval '30 days'`)
    console.log('PAYPRO pending in last 30 days', pend.rows[0].n)
    const cut = await c.query(`select value from app_settings where key = 'pay.paypro.cutoff'`)
    console.log('cutoff', cut.rows[0]?.value)

    const tables = await c.query(`select distinct table_name from information_schema.columns where table_schema='public' and data_type in ('text','jsonb','character varying','ARRAY') and table_name in (select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE') order by 1`)
    console.log('TEXT HITS (table: rows)')
    for (const { table_name: t } of tables.rows) {
      if (SKIP.test(t)) continue
      try {
        await c.query('savepoint s')
        const r = await c.query(`select count(*)::int n from public."${t}" x where x::text ~* $1`, [PATTERN])
        await c.query('release savepoint s')
        if (r.rows[0].n > 0) console.log(' ', t, r.rows[0].n)
      } catch (e) {
        await c.query('rollback to savepoint s')
        console.log('  (skipped)', t, (e as Error).message.slice(0, 60))
      }
    }
    await c.query('rollback')
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
