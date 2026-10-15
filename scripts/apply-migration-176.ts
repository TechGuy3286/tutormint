/**
 * scripts/apply-migration-176.ts — applies supabase/migrations/176_owner_only_approvals.sql
 * (one trigger function, three triggers). One transaction; without --apply it
 * rolls back. Runs the file twice (idempotent), checks no row or policy
 * changed, and PROVES the guard inside a savepoint: a non-Owner staff token
 * cannot change an approval column, the Owner can, a staff token can still
 * change an ordinary column, and the service role is untouched. The proof is
 * always rolled back.
 *   npx tsx --env-file=.env.local scripts/apply-migration-176.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

type Row = Record<string, string>

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/176_owner_only_approvals.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (
      await c.query(
        `select (select md5(string_agg(id::text || coalesce(verification_state,'') || coalesce(profile_pic_status,'') || coalesce(cnic_verified_at::text,''), ',' order by id)) from profiles) as profiles,
                (select md5(string_agg(id::text || status::text, ',' order by id)) from payments) as payments,
                (select md5(string_agg(id::text || coalesce(video_status,''), ',' order by id)) from tutor_profiles) as tutors,
                (select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname))
                   from pg_policies where schemaname in ('public','storage')) as policies`,
      )
    ).rows[0] as Row
  const before = await fp()
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query(sql)
    const after = await fp()
    for (const k of Object.keys(before)) {
      console.log(`${k} unchanged:`, before[k] === after[k])
      if (before[k] !== after[k]) throw new Error(`${k} changed`)
    }

    // ---- proof, always rolled back ----
    const staff = (await c.query(`select id from profiles where role='admin' and admin_role in ('admin','operations','partner') limit 1`)).rows[0]?.id
    const owner = (await c.query(`select id from profiles where role='admin' and admin_role='owner' limit 1`)).rows[0]?.id
    const member = (await c.query(`select id, profile_pic_status from profiles where role='tutor' limit 1`)).rows[0]
    const as = async (uid: string) => {
      await c.query(`set local role authenticated`)
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })])
    }
    const attempt = async (label: string, uid: string, stmt: string, params: unknown[], expectRefused: boolean) => {
      await c.query('savepoint p')
      let refused = false
      try {
        await as(uid)
        await c.query(stmt, params)
      } catch (e) {
        refused = (e as { code?: string }).code === '42501'
        console.log(`   (${label}) ${(e as Error).message}`)
        if (!refused) throw e
      }
      await c.query('rollback to savepoint p')
      await c.query('reset role')
      console.log(`${label}: ${refused ? 'refused' : 'allowed'}`)
      if (refused !== expectRefused) throw new Error(`${label}: expected ${expectRefused ? 'refused' : 'allowed'}`)
    }
    // Most approval columns are already closed to `authenticated` by column
    // grants; the two still writable by a staff token are profiles.cnic_number
    // (is_admin_writer) and the payment decision columns (is_admin_full_writer).
    // The trigger is what refuses those. An Admin-role account is used because
    // both write policies admit it.
    const adminStaff = (await c.query(`select id from profiles where role='admin' and admin_role='admin' limit 1`)).rows[0]?.id ?? staff
    if (adminStaff && member) {
      await attempt('staff approves a photo directly (grants)', adminStaff, `update profiles set profile_pic_status='approved' where id=$1`, [member.id], true)
      await attempt('staff types a CNIC number directly (trigger)', adminStaff, `update profiles set cnic_number='35202-1234567-1' where id=$1 and cnic_number is distinct from '35202-1234567-1' returning id`, [member.id], true)
      await attempt('staff changes an ordinary column', adminStaff, `update profiles set city=city where id=$1`, [member.id], false)
      if (owner) await attempt('Owner types a CNIC number directly', owner, `update profiles set cnic_number='35202-1234567-1' where id=$1 returning id`, [member.id], false)
    }
    const pay = (await c.query(`select id, status from payments limit 1`)).rows[0]
    if (adminStaff && pay) {
      const to = pay.status === 'approved' ? 'rejected' : 'approved'
      await attempt('staff changes a payment status directly (trigger)', adminStaff, `update payments set status=$1 where id=$2`, [to, pay.id], true)
      if (owner) await attempt('Owner changes a payment status directly', owner, `update payments set status=$1 where id=$2`, [to, pay.id], false)
    }
    // Service role / SQL session: no auth.uid(), untouched.
    if (member) {
      await c.query('savepoint q')
      await c.query(`update profiles set profile_pic_status=profile_pic_status where id=$1`, [member.id])
      await c.query('rollback to savepoint q')
      console.log('service role / SQL session: allowed')
    }

    const trg = await c.query(
      `select event_object_table from information_schema.triggers where trigger_name='owner_only_approval' order by 1`,
    )
    console.log('triggers on:', trg.rows.map((r: Row) => r.event_object_table).join(', '))

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
