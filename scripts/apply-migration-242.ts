/**
 * scripts/apply-migration-242.ts — applies supabase/migrations/242_pr16_staff_insights_grant.sql.
 * One transaction; without --apply it rolls back. Proves: the key exists and
 * parses to exactly one profile id; that id is a staff account with the
 * backend_support role and is the same id as on 'staff.all_rows';
 * 'staff.all_rows' is unchanged; the migration re-runs cleanly. Yes/no only —
 * no name, phone or email is printed.
 *   npx tsx --env-file=.env.local scripts/apply-migration-242.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { parseAllRowsStaff } from '../lib/staffAllRowsCore'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/242_pr16_staff_insights_grant.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  try {
    const allRowsBefore = (await c.query(`select value from app_settings where key='staff.all_rows'`)).rows[0]?.value ?? null
    await c.query(sql)
    await c.query(sql) // re-runnable
    const v = (await c.query(`select value from app_settings where key='staff.insights'`)).rows[0]?.value as string | undefined
    assert.ok(v, 'staff.insights exists')
    const ids = [...parseAllRowsStaff(v)]
    assert.equal(ids.length, 1, 'exactly one granted account')
    const p = (await c.query(`select role, admin_role from profiles where id=$1`, [ids[0]])).rows[0]
    assert.equal(p?.role, 'admin', 'the granted account is staff')
    assert.equal(p?.admin_role, 'backend_support', 'the granted account is Backend Support')
    const allRowsAfter = (await c.query(`select value from app_settings where key='staff.all_rows'`)).rows[0]?.value ?? null
    assert.equal(allRowsAfter, allRowsBefore, 'staff.all_rows unchanged')
    assert.ok(parseAllRowsStaff(allRowsAfter).has(ids[0]), 'same account as the all-rows grant')
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED 242 — all checks passed' : 'DRY RUN 242 (rolled back) — all checks passed')
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
