/**
 * scripts/apply-migration-174.ts — applies supabase/migrations/174_payment_return_to.sql
 * (one nullable column + its CHECK on payments). One transaction; without
 * --apply it rolls back. No payment row changes: the fingerprint of every
 * existing payment is compared before and after.
 *   npx tsx --env-file=.env.local scripts/apply-migration-174.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/174_payment_return_to.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (
      await c.query(
        `select count(*)::int as n,
                md5(coalesce(string_agg(id::text || status || coalesce(plan_code,'') || coalesce(amount_pkr::text,''), ',' order by id), '')) as rows,
                (select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname))
                   from pg_policies where schemaname in ('public','storage')) as policies
           from payments`,
      )
    ).rows[0] as { n: number; rows: string; policies: string }
  const before = await fp()
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query(sql) // idempotent: a second run must not fail
    const after = await fp()
    console.log('payments:', before.n, '->', after.n, '· rows unchanged:', before.rows === after.rows, '· policies unchanged:', before.policies === after.policies)
    if (before.rows !== after.rows || before.policies !== after.policies) throw new Error('an existing row or policy changed')
    const col = await c.query(`select column_name, data_type from information_schema.columns where table_name='payments' and column_name='return_to'`)
    console.log('column:', JSON.stringify(col.rows))
    for (const bad of ['//evil.com', 'https://evil.com', '/a\\b']) {
      await c.query('savepoint s')
      try {
        await c.query(`update payments set return_to = $1 where id = (select id from payments limit 1)`, [bad])
        throw new Error(`CHECK let ${bad} through`)
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('CHECK let')) throw e
        await c.query('rollback to savepoint s')
      }
    }
    console.log('CHECK refuses //host, absolute URL, backslash: ok')
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
