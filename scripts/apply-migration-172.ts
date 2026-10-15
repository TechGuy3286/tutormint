/**
 * scripts/apply-migration-172.ts — applies supabase/migrations/172_sms_health.sql
 * (two new tables, sms_sends and sms_alerts, admin-read; no existing row or
 * policy changes). One transaction; without --apply it rolls back.
 *   npx tsx --env-file=.env.local scripts/apply-migration-172.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/172_sms_health.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const policies = async () =>
    (
      await c.query(
        `select count(*)::int as n, md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) as fp
           from pg_policies where schemaname in ('public', 'storage') and tablename not in ('sms_sends', 'sms_alerts')`,
      )
    ).rows[0] as { n: number; fp: string }
  const polBefore = await policies()
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query(sql) // idempotent: a second run must not fail
    const polAfter = await policies()
    const tables = await c.query(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('sms_sends', 'sms_alerts') order by 1`,
    )
    const pol = await c.query(`select tablename, policyname, cmd from pg_policies where tablename in ('sms_sends', 'sms_alerts') order by 1`)
    console.log('other policies before/after:', polBefore.n, polAfter.n, '· unchanged:', polBefore.fp === polAfter.fp)
    console.log('tables:', JSON.stringify(tables.rows))
    console.log('policies:', JSON.stringify(pol.rows))
    if (polBefore.fp !== polAfter.fp) throw new Error('an existing policy changed')
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
