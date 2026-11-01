/**
 * scripts/apply-migration-220.ts — applies supabase/migrations/220_self_referral_devices.sql.
 * One transaction; without --apply it rolls back. Runs the file twice, then in
 * a rolled-back savepoint checks the hash CHECKs and the one-mark-per-device
 * index, and that anon and authenticated cannot read the table. Prints results
 * only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-220.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/220_self_referral_devices.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  try {
    await c.query(sql)
    await c.query(sql)
    await c.query('savepoint probe')
    const { rows: u } = await c.query(`select id from auth.users order by created_at limit 1`)
    const uid = u[0].id as string
    const h = 'a'.repeat(64)
    await c.query(`insert into member_device_marks (member_id, kind, device_hash, ip_hash) values ($1,'signup',$2,null)`, [uid, h])
    await assert.rejects(c.query(`insert into member_device_marks (member_id, kind, device_hash) values ($1,'signup',$2)`, [uid, h]), /duplicate/)
    await c.query('rollback to savepoint probe')
    await assert.rejects(c.query(`insert into member_device_marks (member_id, kind, device_hash) values ($1,'signup','not-a-hash')`, [uid]), /check/)
    await c.query('rollback to savepoint probe')
    await assert.rejects(c.query(`insert into member_device_marks (member_id, kind) values ($1,'other')`, [uid]), /check/)
    await c.query('rollback to savepoint probe')
    for (const role of ['anon', 'authenticated']) {
      await c.query(`set local role ${role}`)
      await assert.rejects(c.query(`select 1 from member_device_marks limit 1`), /permission denied/)
      await c.query('rollback to savepoint probe')
    }
    // staff_tenure: anon cannot read; a signed-in member token sees nothing.
    await c.query(`set local role anon`)
    await assert.rejects(c.query(`select 1 from staff_tenure limit 1`), /permission denied/)
    await c.query('rollback to savepoint probe')
    await assert.rejects(c.query(`insert into staff_tenure (staff_id, joined_at, source) values ($1, now(), 'guess')`, [uid]), /check|foreign/)
    await c.query('rollback to savepoint probe')
    const { rows: tp } = await c.query(`select count(*)::int n from pg_policies where tablename = 'staff_tenure' and cmd = 'SELECT'`)
    assert.equal(tp[0].n, 1)
    const { rows: rls } = await c.query(`select relrowsecurity from pg_class where relname = 'member_device_marks'`)
    assert.equal(rls[0].relrowsecurity, true)
    const { rows: pol } = await c.query(`select count(*)::int n from pg_policies where tablename = 'member_device_marks'`)
    assert.equal(pol[0].n, 0)
    console.log('checks passed: hashes only, one mark per device, no anon/authenticated access, RLS on with no policies')
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
