/**
 * scripts/apply-migration-226.ts — applies supabase/migrations/226_paid_welcome_parent_welcome.sql.
 * One transaction; without --apply it rolls back. Prints counts only.
 *   npx tsx --env-file=.env.local scripts/apply-migration-226.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/226_paid_welcome_parent_welcome.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    const before = (await c.query(`select count(*)::int n from template_history where key = 'pf_no_tuition'`)).rows[0].n as number
    await c.query(sql)
    await c.query(sql) // re-runnable: the second run writes no second history row
    const after = (await c.query(`select count(*)::int n from template_history where key = 'pf_no_tuition'`)).rows[0].n as number
    assert.ok(after - before <= 1, 'at most one history row')
    const body = (await c.query(`select body from admin_message_templates where key = 'pf_no_tuition'`)).rows[0]?.body as string
    assert.match(body, /post your tuition yourself/)
    assert.doesNotMatch(body, /tell us/i)
    const chk = (await c.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'member_follow_ups_source_check'`)).rows[0].d as string
    assert.match(chk, /welcome/)
    console.log(`history rows added: ${after - before}; constraint has 'welcome'; template updated`)
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
