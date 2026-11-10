/**
 * scripts/apply-migration-228.ts — applies supabase/migrations/228_personal_bank_credits.sql.
 * One transaction; without --apply it rolls back. Prints counts only.
 *   npx tsx --env-file=.env.local scripts/apply-migration-228.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/228_personal_bank_credits.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    const before = (await c.query(`select count(*)::int n, coalesce(sum(amount_pkr), 0)::numeric s from bank_transfers`)).rows[0]
    await c.query(sql)
    await c.query(sql) // re-runnable
    const cols = (await c.query(`select column_name from information_schema.columns where table_name = 'bank_transfers' and column_name like 'personal%'`)).rows.length
    assert.equal(cols, 6, 'six personal_* columns')
    const after = (await c.query(`select count(*)::int n, coalesce(sum(amount_pkr), 0)::numeric s, count(personal_at)::int p from bank_transfers`)).rows[0]
    assert.equal(after.n, before.n, 'no row added or removed')
    assert.equal(String(after.s), String(before.s), 'no amount changed')
    assert.equal(after.p, 0, 'nothing marked personal by the migration')
    // The note check refuses a mark without a note.
    await c.query('savepoint s1')
    let refused = false
    try {
      await c.query(`update bank_transfers set personal_at = now() where id = (select id from bank_transfers limit 1)`)
    } catch {
      refused = true
    }
    await c.query('rollback to savepoint s1')
    assert.ok(refused, 'a mark without a note is refused')
    console.log(`bank credits unchanged: ${after.n}; personal columns added; note check proven`)
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
