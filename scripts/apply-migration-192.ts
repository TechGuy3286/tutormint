/**
 * scripts/apply-migration-192.ts — applies supabase/migrations/192_application_stages.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent), checks no applications row lost or changed any other column,
 * proves a signed-in tutor cannot change a stage, and prints the backfill
 * counts. No phone, CNIC or email is printed.
 *   npx tsx --env-file=.env.local scripts/apply-migration-192.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/192_application_stages.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const fp = `select count(*)::int n, md5(string_agg(id::text || coalesce(job_id::text,'') || tutor_id::text || status || coalesce(withdrawn_at::text,''), ',' order by id)) h from applications`
    const jobsFp = `select count(*)::int n, md5(string_agg(id::text || status || coalesce(paused_at::text,'') || coalesce(resumed_at::text,''), ',' order by id)) h from jobs`
    const before = (await c.query(fp)).rows[0]
    const jBefore = (await c.query(jobsFp)).rows[0]
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(fp)).rows[0]
    const jAfter = (await c.query(jobsFp)).rows[0]
    if (before.n !== after.n || before.h !== after.h) throw new Error('an applications row changed')
    if (jBefore.n !== jAfter.n || jBefore.h !== jAfter.h) throw new Error('a jobs row changed')

    const stages = (await c.query(`select stage, count(*)::int n from applications group by stage order by stage`)).rows
    console.log('stages', stages)
    const owners = (await c.query(`select count(*)::int n, count(distinct staff_id)::int staff from tuition_owners`)).rows[0]
    const unassigned = (await c.query(`select count(*)::int n from jobs j where not exists (select 1 from tuition_owners o where o.job_id = j.id)`)).rows[0]
    console.log(`tuition owners: ${owners.n} tuitions across ${owners.staff} staff; unassigned tuitions ${unassigned.n}`)

    // The lock: act as the tutor of one application and try to change its stage.
    const one = (await c.query(`select id, tutor_id from applications limit 1`)).rows[0]
    if (one) {
      await c.query('savepoint lock_probe')
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: one.tutor_id, role: 'authenticated' })])
      await c.query(`set local role authenticated`)
      let refused = false
      try {
        await c.query(`update applications set stage = 'hired' where id = $1`, [one.id])
      } catch (e) {
        refused = (e as { code?: string }).code === '42501'
      }
      await c.query('rollback to savepoint lock_probe')
      if (!refused) throw new Error('a signed-in tutor could change a stage')
      console.log('lock: a signed-in tutor is refused (42501)')
    }
    const pub = (await c.query(`select count(*)::int n from job_applied_counts((select array_agg(distinct job_id) from applications))`)).rows[0]
    console.log(`job_applied_counts returns ${pub.n} tuitions`)

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
