/**
 * scripts/apply-migration-208.ts — applies supabase/migrations/208_tuition_consent.sql.
 * One transaction; without --apply it rolls back.
 *
 * Checks (no real row is kept changed; the insert probe uses an invented job
 * inside a rolled-back savepoint):
 *   - the migration runs twice cleanly (re-runnable);
 *   - every tuition has exactly one consent row; parent posts are recorded
 *     (parent_posted), team posts are not recorded;
 *   - nothing is readable as anon or as a signed-in member token;
 *   - a new team job gets 'not_recorded', a new parent job 'recorded';
 *   - recorded without a method is refused;
 *   - job counts unchanged; no report names the team account on a job.
 * Prints counts and true/false only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-208.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/208_tuition_consent.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  const check = (label: string, ok: boolean) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
    if (!ok) throw new Error(`check failed: ${label}`)
  }
  try {
    const before = (await c.query(`select count(*)::int j from jobs`)).rows[0]
    await c.query(sql)
    await c.query(sql)
    console.log('migration ran twice cleanly')

    const counts = (await c.query(`
      select
        (select count(*)::int from jobs) jobs,
        (select count(*)::int from tuition_consents) rows,
        (select count(*)::int from tuition_consents tc join jobs j on j.id = tc.job_id join profiles p on p.id = j.parent_id where p.is_team_account and tc.status = 'not_recorded') team_nr,
        (select count(*)::int from jobs j join profiles p on p.id = j.parent_id where p.is_team_account) team,
        (select count(*)::int from tuition_consents tc join jobs j on j.id = tc.job_id join profiles p on p.id = j.parent_id where not coalesce(p.is_team_account,false) and tc.status = 'recorded' and tc.method = 'parent_posted') parent_rec,
        (select count(*)::int from jobs j join profiles p on p.id = j.parent_id where not coalesce(p.is_team_account,false)) parent
    `)).rows[0]
    console.log(`jobs ${counts.jobs} · consent rows ${counts.rows} · team ${counts.team} (not recorded ${counts.team_nr}) · parent ${counts.parent} (recorded ${counts.parent_rec})`)
    check('one consent row per tuition', counts.jobs === counts.rows)
    check('every team tuition not recorded', counts.team === counts.team_nr)
    check('every parent tuition recorded — parent posted it themselves', counts.parent === counts.parent_rec)

    for (const role of ['anon', 'authenticated']) {
      await c.query('savepoint r')
      let rows = -1
      try {
        await c.query(`set local role ${role}`)
        rows = (await c.query(`select count(*)::int n from public.tuition_consents`)).rows[0].n
      } catch {
        rows = 0
      }
      await c.query('rollback to savepoint r')
      check(`tuition_consents: nothing readable as ${role}`, rows === 0)
    }

    const team = (await c.query(`select id from profiles where is_team_account limit 1`)).rows[0]?.id
    const parent = (await c.query(`select j.parent_id id from jobs j join profiles p on p.id = j.parent_id where not coalesce(p.is_team_account,false) limit 1`)).rows[0]?.id
    await c.query('savepoint s')
    // The job insert probe runs with the triggers that would otherwise notify
    // or hide; nothing here is kept (rolled back).
    const ins = async (pid: string) =>
      (await c.query(`insert into jobs (job_tx_id, parent_id, title, city, area, teaching_mode, status, description, subject, grade, budget, timings)
        values ('PROBE-208-' || substr(md5(random()::text), 1, 8), $1, 'Probe tuition', 'Lahore', '', 'Home Tutor', 'open', 'probe', 'Tuition', '', '', '') returning id`, [pid])).rows[0].id
    if (team) {
      const id = await ins(team)
      const r = (await c.query(`select status, method from tuition_consents where job_id = $1`, [id])).rows[0]
      check('a new team tuition starts not recorded', r?.status === 'not_recorded' && r?.method === null)
      let refused = false
      try {
        await c.query('savepoint m')
        await c.query(`update tuition_consents set status = 'recorded' where job_id = $1`, [id])
      } catch {
        refused = true
        await c.query('rollback to savepoint m')
      }
      check('recorded without a method is refused', refused)
    }
    if (parent) {
      const id = await ins(parent)
      const r = (await c.query(`select status, method from tuition_consents where job_id = $1`, [id])).rows[0]
      check('a new parent tuition is recorded — parent posted it themselves', r?.status === 'recorded' && r?.method === 'parent_posted')
    }
    await c.query('rollback to savepoint s')

    const after = (await c.query(`select count(*)::int j from jobs`)).rows[0]
    check('job count unchanged', before.j === after.j)
    const rep = (await c.query(`select count(*)::int n from reports r join profiles p on p.id = r.reported_id where p.is_team_account and r.target_type = 'job'`)).rows[0]
    check('no job report names the team account', rep.n === 0)
    const setting = (await c.query(`select value from app_settings where key = 'privacy.hide_unconsented_numbers'`)).rows[0]
    check('the hide-numbers switch exists', !!setting)
    console.log(`hide switch: ${setting?.value}`)

    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('DRY RUN — rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
