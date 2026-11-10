/**
 * scripts/apply-migration-227.ts — applies supabase/migrations/227_looks_fine_application_views.sql.
 * One transaction; without --apply it rolls back. Prints counts only.
 *   npx tsx --env-file=.env.local scripts/apply-migration-227.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/227_looks_fine_application_views.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    const blankBefore = (await c.query(`select count(*)::int n from photo_blank_checks where blank`)).rows[0].n as number
    await c.query(sql)
    await c.query(sql) // re-runnable
    const cols = (await c.query(`select column_name from information_schema.columns where table_name = 'photo_blank_checks' and column_name like 'cleared%'`)).rows.length
    assert.equal(cols, 3, 'three cleared_* columns')
    const views = (await c.query(`select count(*)::int n from application_views`)).rows[0].n as number
    assert.equal(views, 0)
    const rls = (await c.query(`select relrowsecurity r from pg_class where relname = 'application_views'`)).rows[0].r as boolean
    assert.ok(rls, 'RLS on')
    const blankAfter = (await c.query(`select count(*)::int n from photo_blank_checks where blank and cleared_at is null`)).rows[0].n as number
    assert.equal(blankAfter, blankBefore, 'no flag changed')
    console.log(`blank flags unchanged: ${blankAfter}; application_views created (RLS on)`)
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
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
