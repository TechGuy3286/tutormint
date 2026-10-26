/** Read-only (hotfix, 26 Oct 2026): when did the database and each service's
 *  connections start? A PostgREST / Auth restart shows as fresh backend_start
 *  times for the authenticator / supabase_auth_admin sessions. Also the
 *  database counters (deadlocks, temp files) and the busiest tables by writes.
 *
 *   npx tsx --env-file=.env.local scripts/report-db-restarts.ts */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 20000 })
  await c.connect()
  try {
    const show = (rows: Record<string, unknown>[]) => {
      for (const r of rows) console.log(Object.values(r).map((v) => (v instanceof Date ? v.toISOString() : typeof v === 'object' && v ? JSON.stringify(v) : String(v))).join(' | '))
      if (!rows.length) console.log('(none)')
    }
    console.log('== postmaster start'); show((await c.query('select pg_postmaster_start_time() t, now() now')).rows)
    console.log('== sessions (user, app, backend_start)')
    show((await c.query(`select usename, application_name, state, backend_start from pg_stat_activity where datname = current_database() order by backend_start`)).rows)
    console.log('== database counters')
    show((await c.query(`select numbackends, xact_commit, xact_rollback, deadlocks, temp_files, pg_size_pretty(temp_bytes) temp, conflicts, stats_reset from pg_stat_database where datname = current_database()`)).rows)
    console.log('== settings')
    show((await c.query(`select name, setting, unit from pg_settings where name in ('statement_timeout','idle_in_transaction_session_timeout','shared_buffers','work_mem','max_connections','lock_timeout')`)).rows)
    console.log('== role statement_timeout overrides')
    show((await c.query(`select r.rolname, s.setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole`)).rows)
    console.log('== pg_cron jobs and recent failures')
    try {
      show((await c.query(`select jobid, schedule, left(command, 80) cmd, active from cron.job`)).rows)
      show((await c.query(`select jobid, status, start_time, end_time, left(return_message, 100) msg from cron.job_run_details where start_time > now() - interval '12 hours' order by start_time desc limit 30`)).rows)
    } catch (e) {
      console.log('no pg_cron:', (e as Error).message)
    }
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
