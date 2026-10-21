/**
 * scripts/apply-migration-190.ts — applies supabase/migrations/190_selfie_photo_match.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent) and checks no user_documents row changed.
 *   npx tsx --env-file=.env.local scripts/apply-migration-190.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/190_selfie_photo_match.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const fp = `select count(*)::int n, md5(string_agg(id::text || kind || status || coalesce(original_path,''), ',' order by id)) h from user_documents`
    const before = (await c.query(fp)).rows[0]
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(fp)).rows[0]
    if (before.n !== after.n || before.h !== after.h) throw new Error('a user_documents row changed')
    const cols = (await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name='user_documents' and column_name in ('photo_dhash','same_as_profile_photo') order by 1`)).rows.map((r: { column_name: string }) => r.column_name)
    if (cols.length !== 2) throw new Error('columns missing')
    console.log(`user_documents ${after.n}, unchanged; columns: ${cols.join(', ')}`)
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
