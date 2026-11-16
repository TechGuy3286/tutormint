/**
 * scripts/apply-migration-232.ts — applies supabase/migrations/232_blank_check_cnic.sql.
 * One transaction; without --apply it rolls back. Proves the check now allows
 * 'cnic' and still refuses an unknown item (inside savepoints, rolled back —
 * no row is left) and that no row changed. Prints counts and yes/no only.
 *   npx tsx --env-file=.env.local scripts/apply-migration-232.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const n = async (c: pg.Client, sql: string) => Number((await c.query(sql)).rows[0].n)

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/232_blank_check_cnic.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  try {
    const before = await n(c, `select count(*)::int n from photo_blank_checks`)
    await c.query(sql)
    await c.query(sql) // re-runnable
    const def = String((await c.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'photo_blank_checks_item_check'`)).rows[0].d)
    assert.ok(def.includes('cnic'), 'cnic allowed')
    assert.ok(def.includes('photo') && def.includes('selfie'), 'old items kept')
    const member = (await c.query(`select id from profiles where role = 'tutor' limit 1`)).rows[0]?.id
    if (member) {
      await c.query('savepoint p')
      await c.query(`insert into photo_blank_checks (member_id, item, ref, blank, dark_share, spread) values ($1, 'cnic', 'probe-232', false, 0, 50)`, [member])
      await c.query('rollback to savepoint p')
      await c.query('savepoint q')
      let refused = false
      try {
        await c.query(`insert into photo_blank_checks (member_id, item, ref, blank, dark_share, spread) values ($1, 'nonsense', 'probe-232', false, 0, 50)`, [member])
      } catch {
        refused = true
      }
      await c.query('rollback to savepoint q')
      assert.ok(refused, 'unknown item still refused')
      console.log('probe: cnic accepted, unknown refused (rolled back)')
    }
    assert.equal(await n(c, `select count(*)::int n from photo_blank_checks`), before, 'no row changed')
    console.log('rows unchanged:', before)
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED' : 'dry run — rolled back')
  } catch (e) {
    await c.query('rollback').catch(() => {})
    console.error('FAILED, rolled back:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}

main()
