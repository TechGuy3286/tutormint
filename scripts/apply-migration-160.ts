/**
 * scripts/apply-migration-160.ts — applies supabase/migrations/160_document_rotation_cnic_read.sql.
 * Additive (four columns + two CHECKs on user_documents), idempotent. Runs in a
 * transaction; without --apply it rolls back (dry run). Prints the row counts
 * before and after so "nothing existing changed" is visible.
 *   npx tsx --env-file=.env.local scripts/apply-migration-160.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/apply-migration-160.ts --apply
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/160_document_rotation_cnic_read.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (await c.query(`select count(*)::int as n, md5(string_agg(id::text || coalesce(status,'') || coalesce(preview_path,'') || coalesce(original_path,''), ',' order by id)) as h from user_documents`)).rows[0]
  const before = await fp()
  await c.query('begin')
  try {
    await c.query(sql)
    const after = await fp()
    const { rows: cols } = await c.query(
      `select column_name, data_type, column_default from information_schema.columns
        where table_name = 'user_documents' and column_name in ('rotation','cnic_read_status','cnic_read_number','cnic_read_at') order by 1`,
    )
    const { rows: rot } = await c.query(`select rotation, count(*)::int as n from user_documents group by 1`)
    console.log('rows before/after:', before.n, after.n, '· existing columns unchanged:', before.h === after.h)
    console.log('new columns:', JSON.stringify(cols))
    console.log('rotation values:', JSON.stringify(rot))
    if (before.n !== after.n || before.h !== after.h) throw new Error('existing data changed — rolling back')
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
