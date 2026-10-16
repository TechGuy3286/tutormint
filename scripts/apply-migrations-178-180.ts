/**
 * scripts/apply-migrations-178-180.ts — applies 178_tuitions_on_google.sql and
 * 180_started_payment_area_landmark.sql (179 has its own runner). One
 * transaction; without --apply it rolls back. Runs each file twice (idempotent)
 * and checks that no existing jobs/payments row and no other policy changed,
 * then reports what the new pieces return.
 *   npx tsx --env-file=.env.local scripts/apply-migrations-178-180.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

type Row = Record<string, string>

async function main() {
  const apply = process.argv.includes('--apply')
  const files = ['178_tuitions_on_google.sql', '180_started_payment_area_landmark.sql'].map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (
      await c.query(
        `select (select md5(string_agg(id::text || status || coalesce(city,'') || coalesce(area,'') || coalesce(title,''), ',' order by id)) from jobs) as jobs,
                (select md5(string_agg(id::text || status, ',' order by id)) from payments) as payments,
                (select md5(string_agg(id::text || url || coalesce(sent_at::text,'') || coalesce(last_error,''), ',' order by id)) from indexing_queue) as queue,
                (select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname))
                   from pg_policies where schemaname in ('public','storage') and tablename <> 'indexing_attempts') as policies`,
      )
    ).rows[0] as Row
  const before = await fp()
  await c.query('begin')
  try {
    for (const sql of files) {
      await c.query(sql)
      await c.query(sql)
    }
    const after = await fp()
    for (const k of Object.keys(before)) {
      console.log(`${k} unchanged:`, before[k] === after[k])
      if (before[k] !== after[k]) throw new Error(`${k} changed`)
    }
    const t = await c.query(
      `select status, count(*) n from indexable_tuitions() group by status order by status`,
    )
    console.log('indexable_tuitions():', t.rows.map((r: Row) => `${r.status}=${r.n}`).join(', '))
    const old = await c.query(`select count(*) n from indexable_job_slugs()`)
    console.log('indexable_job_slugs() (unchanged, open only):', old.rows[0].n)
    const a = await c.query(`select count(*) n, sum(case when ok then 1 else 0 end) ok from indexing_attempts`)
    console.log('indexing_attempts backfilled:', a.rows[0].n, 'ok:', a.rows[0].ok)
    const tpl = await c.query(`select key from admin_message_templates where key = 'payment_not_finished'`)
    console.log('template payment_not_finished:', tpl.rows.length === 1)
    const col = await c.query(`select column_name from information_schema.columns where table_name='jobs' and column_name='area_landmark'`)
    console.log('jobs.area_landmark:', col.rows.length === 1)
    const rls = await c.query(`select relrowsecurity from pg_class where relname='indexing_attempts'`)
    console.log('indexing_attempts RLS:', rls.rows[0]?.relrowsecurity)
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED' : 'dry run — rolled back')
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
