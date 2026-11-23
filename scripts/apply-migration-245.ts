/**
 * scripts/apply-migration-245.ts — applies supabase/migrations/245_pr18_ai_posting_claims_otp_alerts.sql.
 * One transaction; without --apply it rolls back. Proves (checks inside
 * savepoints, always rolled back): a 'claim' follow-up channel is accepted; two
 * staff never hold a session claim on the same tutor; "I'm on it" of another
 * staff member is skipped; the OTP-alert recipients default holds the Owner;
 * the pg_cron jobs exist; the migration re-runs cleanly. Counts / yes-no only —
 * no name, phone or email is printed.
 *   npx tsx --env-file=.env.local scripts/apply-migration-245.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/245_pr18_ai_posting_claims_otp_alerts.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    await c.query(`set local lock_timeout = '10s'`)
    await c.query(sql)
    await c.query(sql) // re-runnable

    const staff = (await c.query(`select id from profiles where role = 'admin' and admin_role is not null order by created_at limit 2`)).rows.map((r: { id: string }) => r.id)
    const tutors = (await c.query(`select id from profiles where role = 'tutor' order by created_at limit 3`)).rows.map((r: { id: string }) => r.id)
    assert.ok(staff.length === 2 && tutors.length === 3, 'need two staff and three tutors to test claims')

    await c.query('savepoint t')
    const [a, b] = staff
    const first = (await c.query(`select claim_follow_up_session($1, $2::uuid[], 'missing') m`, [a, tutors])).rows[0].m
    assert.equal(first, tutors[0], 'A gets the first tutor')
    const second = (await c.query(`select claim_follow_up_session($1, $2::uuid[], 'missing') m`, [b, tutors])).rows[0].m
    assert.equal(second, tutors[1], 'B never gets the tutor A holds')
    await c.query(`insert into member_work_claims (member_id, staff_id, kind) values ($1, $2, 'on_it')`, [tutors[2], a])
    const third = (await c.query(`select claim_follow_up_session($1, $2::uuid[], 'missing') m`, [b, [tutors[0], tutors[2]]])).rows[0].m
    assert.equal(third, null, "B skips A's session and A's I'm on it")
    const live = Number((await c.query(`select count(*) n from member_work_claims where staff_id = $1 and kind = 'session' and released_at is null`, [b])).rows[0].n)
    assert.equal(live, 0, "B's earlier session claim was released when B asked for the next one")
    let dup = false
    try {
      await c.query('savepoint d')
      await c.query(`insert into member_work_claims (member_id, staff_id, kind) values ($1, $2, 'on_it')`, [tutors[2], b])
    } catch {
      dup = true
    } finally {
      await c.query('rollback to savepoint d')
    }
    assert.ok(dup, 'one live I am on it per member')
    await c.query(`insert into member_follow_ups (member_id, channel, source, staff_id) values ($1, 'claim', 'unpaid', $2)`, [tutors[0], a])
    await c.query('rollback to savepoint t')

    const rec = (await c.query(`select value from app_settings where key = 'alerts.otp_recipients'`)).rows[0]?.value
    const ids = JSON.parse(rec ?? '[]') as string[]
    const owner = (await c.query(`select id from profiles where role = 'admin' and admin_role = 'owner'`)).rows[0]?.id
    assert.ok(ids.includes(owner), 'the Owner is a default OTP-alert recipient')
    console.log('OTP-alert recipients by default:', ids.length)
    const jobs = (await c.query(`select jobname, schedule from cron.job where jobname like 'tm-%' order by jobname`)).rows
    console.log('pg_cron jobs:', JSON.stringify(jobs))
    assert.equal(jobs.length, 2, 'two pg_cron jobs')

    if (apply) {
      await c.query('commit')
      console.log('✓ migration 245 APPLIED')
    } else {
      await c.query('rollback')
      console.log('✓ dry run passed (rolled back). Re-run with --apply.')
    }
  } catch (e) {
    await c.query('rollback').catch(() => undefined)
    console.error('✗', e instanceof Error ? e.message : e)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}
main()
