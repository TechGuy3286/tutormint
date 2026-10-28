/**
 * scripts/apply-migration-213.ts — applies supabase/migrations/213_job_fields_search_data.sql.
 * One transaction; without --apply it rolls back. Runs the file twice (it is
 * re-runnable), then checks the result. Prints counts only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-213.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/213_job_fields_search_data.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  const rows = async (q: string) => (await c.query(q)).rows
  try {
    const fp = `select count(*)::int n, md5(string_agg(id::text || coalesce(status,'') || coalesce(title,'') || coalesce(teaching_mode,'') || coalesce(budget_min_pkr::text,'') || coalesce(budget_max_pkr::text,''), '|' order by id)) h from jobs`
    const before = (await rows(fp))[0]
    await c.query(sql)
    await c.query(sql)
    const after = (await rows(fp))[0]
    const byType = await rows(`select employment_type, count(*)::int n, count(*) filter (where status='open')::int open from jobs group by 1 order by 1`)
    const nulls = (await rows(`select count(*)::int n from jobs where employment_type is null`))[0].n
    const rls = (await rows(`select count(*)::int n from pg_tables where schemaname='public' and tablename='search_console_queries' and rowsecurity`))[0].n
    const pol = (await rows(`select count(*)::int n from pg_policies where tablename='search_console_queries'`))[0].n
    const noFee = (await rows(`select count(*)::int n from jobs where status='open' and budget_min_pkr is null and budget_max_pkr is null and coalesce(budget_pkr,0)=0`))[0].n
    console.log('employment_type:', JSON.stringify(byType), 'null:', nulls)
    console.log('open tuitions with no fee:', noFee)
    console.log('search_console_queries rls/policies:', rls, pol, 'jobs otherwise unchanged:', before.h === after.h)
    if (nulls !== 0) throw new Error('employment_type left null')
    if (rls !== 1 || pol !== 1) throw new Error('RLS or policy wrong')
    if (before.h !== after.h) throw new Error('jobs changed beyond employment_type')
    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('DRY RUN — rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
