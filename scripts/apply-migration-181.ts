/**
 * scripts/apply-migration-181.ts — applies supabase/migrations/181_indexing_skips.sql
 * (indexing_queue.skipped_at + skip_reason, additive). One transaction; without
 * --apply it rolls back. Runs the file twice (idempotent) and checks that no
 * existing queue row or policy changed.
 *   npx tsx --env-file=.env.local scripts/apply-migration-181.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

type Row = Record<string, string>

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/181_indexing_skips.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (
      await c.query(
        `select (select md5(string_agg(id::text || url || kind || coalesce(sent_at::text, '') || coalesce(last_error, ''), ',' order by id)) from indexing_queue) as queue,
                (select count(*)::text from indexing_queue) as rows,
                (select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname))
                   from pg_policies where schemaname in ('public','storage')) as policies`,
      )
    ).rows[0] as Row
  const before = await fp()
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query(sql)
    const after = await fp()
    for (const k of Object.keys(before)) {
      console.log(`${k} unchanged:`, before[k] === after[k])
      if (before[k] !== after[k]) throw new Error(`${k} changed`)
    }
    const cols = await c.query(
      `select column_name, data_type from information_schema.columns where table_name = 'indexing_queue' and column_name in ('skipped_at','skip_reason') order by 1`,
    )
    console.log('columns:', cols.rows.map((r: Row) => `${r.column_name} ${r.data_type}`).join(', '))
    if (cols.rows.length !== 2) throw new Error('columns missing')
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
