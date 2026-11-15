/**
 * scripts/apply-migration-231.ts — applies supabase/migrations/231_call_outcome_wrong_number.sql.
 * One transaction; without --apply it rolls back. Proves the check now allows
 * 'wrong_number' (inside a savepoint, rolled back — no row is left) and that
 * no row changed. Prints counts and yes/no only.
 *   npx tsx --env-file=.env.local scripts/apply-migration-231.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const n = async (c: pg.Client, sql: string) => Number((await c.query(sql)).rows[0].n)

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/231_call_outcome_wrong_number.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  try {
    const before = await n(c, `select count(*)::int n from tutor_contact_logs`)
    await c.query(sql)
    await c.query(sql) // re-runnable
    const def = String((await c.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'tutor_contact_logs_outcome_check'`)).rows[0].d)
    assert.ok(def.includes('wrong_number'), 'wrong_number allowed')
    assert.ok(def.includes('no_answer') && def.includes('called'), 'old outcomes kept')
    // A rolled-back probe: the new value is accepted, an unknown one is refused.
    const tutor = (await c.query(`select id from profiles where role = 'tutor' limit 1`)).rows[0]?.id
    if (tutor) {
      await c.query('savepoint p')
      await c.query(`insert into tutor_contact_logs (tutor_id, outcome) values ($1, 'wrong_number')`, [tutor])
      await c.query('rollback to savepoint p')
      await c.query('savepoint q')
      let refused = false
      try {
        await c.query(`insert into tutor_contact_logs (tutor_id, outcome) values ($1, 'nonsense')`, [tutor])
      } catch {
        refused = true
      }
      await c.query('rollback to savepoint q')
      assert.ok(refused, 'unknown outcome still refused')
      console.log('probe: wrong_number accepted, unknown refused (rolled back)')
    }
    assert.equal(await n(c, `select count(*)::int n from tutor_contact_logs`), before, 'no row changed')
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
