/**
 * scripts/apply-migration-164.ts — applies supabase/migrations/164_no_contact_pause_source.sql
 * (widens one CHECK; no row changes). Transaction; without --apply it rolls back.
 *   npx tsx --env-file=.env.local scripts/apply-migration-164.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/164_no_contact_pause_source.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (await c.query(`select count(*)::int as jobs, md5(coalesce(string_agg(id::text || status || coalesce(pause_source,''), ',' order by id), '')) as fp from jobs`)).rows[0]
  const before = await fp()
  console.log('before:', JSON.stringify(before))
  await c.query('begin')
  try {
    await c.query(sql)
    const after = await fp()
    const same = JSON.stringify(before) === JSON.stringify(after)
    console.log('existing data unchanged:', same)
    const { rows } = await c.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'jobs_pause_source_check'`)
    console.log('check:', rows[0]?.def)
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
