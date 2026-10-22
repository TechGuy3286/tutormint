/**
 * scripts/apply-migration-194.ts — applies supabase/migrations/194_application_follow_ups.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent), checks no applications or jobs row changed, and proves a
 * signed-in staff or member token cannot insert a follow-up row (no write policy).
 *   npx tsx --env-file=.env.local scripts/apply-migration-194.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/194_application_follow_ups.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const fp = `select (select md5(string_agg(id::text || stage || coalesce(worked_at::text,''), ',' order by id)) from applications) a,
                       (select md5(string_agg(id::text || status, ',' order by id)) from jobs) j`
    const before = (await c.query(fp)).rows[0]
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(fp)).rows[0]
    if (before.a !== after.a || before.j !== after.j) throw new Error('an applications or jobs row changed')
    const one = (await c.query(`select a.id, a.job_id, a.tutor_id from applications a limit 1`)).rows[0]
    const staff = (await c.query(`select id from profiles where role = 'admin' and admin_role = 'owner' limit 1`)).rows[0]
    for (const who of [one?.tutor_id, staff?.id].filter(Boolean)) {
      await c.query('savepoint probe')
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: 'authenticated' })])
      await c.query(`set local role authenticated`)
      let refused = false
      try {
        await c.query(`insert into application_follow_ups (application_id, job_id, tutor_id, stage, kind, recipient, message_key) values ($1, $2, $3, 'applied', 'follow_up', 'parent', 'share_profile')`, [one.id, one.job_id, one.tutor_id])
      } catch (e) {
        refused = (e as { code?: string }).code === '42501'
      }
      await c.query('rollback to savepoint probe')
      if (!refused) throw new Error('a signed-in token could insert a follow-up')
    }
    console.log('lock: signed-in member and staff tokens are refused (42501)')
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
