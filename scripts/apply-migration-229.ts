/**
 * scripts/apply-migration-229.ts — applies supabase/migrations/229_staff_pause_not_interested_reason.sql.
 * One transaction; without --apply it rolls back. Proves, in rolled-back
 * savepoints only, that a paused staff token stops passing the staff checks,
 * the Owner cannot be paused, and no member can write the new columns.
 * Prints counts and yes/no only — never a name, email or phone.
 *   npx tsx --env-file=.env.local scripts/apply-migration-229.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/229_staff_pause_not_interested_reason.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    const before = (await c.query(`select count(*)::int n, count(*) filter (where role='admin')::int staff from profiles`)).rows[0]
    const fuBefore = (await c.query(`select count(*)::int n from follow_up_dismissals`)).rows[0]
    await c.query(sql)
    await c.query(sql) // re-runnable
    const after = (await c.query(`select count(*)::int n, count(*) filter (where role='admin')::int staff, count(staff_paused_at)::int paused from profiles`)).rows[0]
    assert.equal(after.n, before.n, 'no profile added or removed')
    assert.equal(after.staff, before.staff, 'no staff role changed')
    assert.equal(after.paused, 0, 'nobody paused by the migration')
    assert.equal((await c.query(`select count(*)::int n from follow_up_dismissals`)).rows[0].n, fuBefore.n, 'dismissals unchanged')

    const priv = (await c.query(`select has_column_privilege('authenticated', 'public.profiles', 'staff_paused_at', 'UPDATE') a, has_column_privilege('anon', 'public.profiles', 'staff_paused_at', 'UPDATE') b`)).rows[0]
    assert.equal(priv.a, false, 'members cannot write staff_paused_at')
    assert.equal(priv.b, false, 'anon cannot write staff_paused_at')

    // A non-Owner staff account: is_admin() true, then false once paused.
    const staff = (await c.query(`select id from profiles where role = 'admin' and admin_role is not null and admin_role <> 'owner' limit 1`)).rows[0]
    if (staff) {
      await c.query('savepoint s1')
      const claims = JSON.stringify({ sub: staff.id, role: 'authenticated' })
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
      const live = (await c.query(`select public.is_admin() a, public.is_admin_with(array['admin','supervisor','operations','tuitions_staff','partner','backend_support']) w`)).rows[0]
      assert.equal(live.a, true, 'staff passes is_admin() before pausing')
      await c.query(`update profiles set staff_paused_at = now() where id = $1`, [staff.id])
      const paused = (await c.query(`select public.is_admin() a, public.is_admin_writer() wr, public.is_admin_full_writer() fw, public.is_admin_with(array['admin','supervisor','operations','tuitions_staff','partner','backend_support']) w, public.sees_all_staff_signups() s`)).rows[0]
      assert.deepEqual([paused.a, paused.wr, paused.fw, paused.w, paused.s], [false, false, false, false, false], 'a paused account passes no staff check')
      await c.query('rollback to savepoint s1')
      console.log('paused staff fails every staff check: yes')
    }

    // The Owner can never be paused.
    await c.query('savepoint s2')
    let refused = false
    try {
      await c.query(`update profiles set staff_paused_at = now() where admin_role = 'owner'`)
    } catch {
      refused = true
    }
    await c.query('rollback to savepoint s2')
    assert.ok(refused, 'pausing the Owner is refused')
    console.log('Owner pause refused: yes')

    // The quick reason check.
    await c.query('savepoint s3')
    let bad = false
    try {
      await c.query(`update follow_up_dismissals set quick_reason = 'nonsense' where id = (select id from follow_up_dismissals limit 1)`)
      bad = (await c.query(`select count(*)::int n from follow_up_dismissals`)).rows[0].n === 0
    } catch {
      bad = true
    }
    await c.query('rollback to savepoint s3')
    assert.ok(bad, 'an unknown quick reason is refused')

    console.log(`profiles unchanged: ${after.n}; staff ${after.staff}; members cannot write the pause columns`)
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
