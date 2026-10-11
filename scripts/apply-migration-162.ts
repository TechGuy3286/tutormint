/**
 * scripts/apply-migration-162.ts — applies supabase/migrations/162_settlements_matching.sql.
 * Additive (new columns on reconciliation_rows and bank_transfers, one new
 * staff-only table), idempotent. Runs in a transaction; without --apply it
 * rolls back (dry run). Prints the existing settlement data before and after so
 * "nothing existing changed" is visible.
 *   npx tsx --env-file=.env.local scripts/apply-migration-162.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/apply-migration-162.ts --apply
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/162_settlements_matching.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (
      await c.query(
        `select (select count(*)::int from reconciliation_imports) as imports,
                (select count(*)::int from reconciliation_rows) as rows,
                (select md5(coalesce(string_agg(id::text || import_id::text || order_number || coalesce(transaction_status,'') || coalesce(order_amount::text,'') || coalesce(merchant_share::text,'') || coalesce(date_paid::text,'') || coalesce(settle_date::text,''), ',' order by id), '')) from reconciliation_rows) as rows_fp,
                (select count(*)::int from bank_transfers) as transfers,
                (select md5(coalesce(string_agg(id::text || transferred_on::text || amount_pkr::text || coalesce(reference,'') || source || gateway, ',' order by id), '')) from bank_transfers) as transfers_fp,
                (select count(*)::int from gateway_deductions) as deductions,
                (select count(*)::int from payments) as payments`,
      )
    ).rows[0]
  const before = await fp()
  console.log('before:', JSON.stringify(before))
  await c.query('begin')
  try {
    await c.query(sql)
    const after = await fp()
    const same = JSON.stringify(before) === JSON.stringify(after)
    console.log('existing data unchanged:', same)
    const { rows: cur } = await c.query(
      `select count(*) filter (where is_current)::int as current, count(*) filter (where not is_current)::int as older,
              count(*) filter (where method is not null)::int as with_method, count(*) filter (where fee is not null)::int as with_fee
         from reconciliation_rows`,
    )
    console.log('reconciliation_rows:', JSON.stringify(cur[0]))
    const { rows: tables } = await c.query(
      `select c.relname as table, c.relrowsecurity as rls,
              (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('settlement_links') order by 1`,
    )
    console.log('new table:', JSON.stringify(tables))
    const { rows: pid } = await c.query(
      `select data_type from information_schema.columns where table_schema='public' and table_name='payments' and column_name='id'`,
    )
    console.log('payments.id type:', pid[0]?.data_type)
    if (!same) throw new Error('existing data changed — rolling back')
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'COMMITTED' : 'DRY RUN — rolled back')
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
