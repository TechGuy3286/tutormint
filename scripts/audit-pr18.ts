/**
 * scripts/audit-pr18.ts — READ-ONLY facts for PR-18 (counts / yes-no only; no
 * name, phone, email or CNIC printed). The rank refresh timing runs inside a
 * transaction that is rolled back.
 *   npx tsx --env-file=.env.local scripts/audit-pr18.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  const q = async (label: string, sql: string, params: unknown[] = []) => {
    try {
      const r = await c.query(sql, params)
      console.log(label, JSON.stringify(r.rows))
    } catch (e) {
      console.log(label, 'ERROR', e instanceof Error ? e.message : e)
    }
  }
  await q('extensions', `select name, installed_version from pg_available_extensions where name in ('pg_cron','pg_net')`)
  await q('cron jobs', `select count(*)::int n from pg_extension where extname='pg_cron'`)
  await q('email sent today (UTC day)', `select count(*)::int n from email_sends where status='sent' and created_at >= date_trunc('day', now())`)
  await q('email sent per day last 7', `select (created_at at time zone 'Asia/Karachi')::date d, count(*)::int n from email_sends where status='sent' and created_at > now() - interval '7 days' group by 1 order by 1`)
  await q('otp verified per day last 7', `select (phone_verified_at at time zone 'Asia/Karachi')::date d, count(*)::int n from profiles where phone_verified_at > now() - interval '7 days' group by 1 order by 1`)
  await q('stuck email tutors (no verified mobile, real email)', `select count(*)::int n from profiles where role='tutor' and phone_verified_at is null and email is not null and email not ilike '%@users.tutormint.org' and created_at < '2026-11-23'`)
  await q('stuck: with any number on file', `select count(*) filter (where p.phone_number is not null)::int phone, count(*) filter (where p.whatsapp is not null or tp.whatsapp_number is not null)::int wa, count(*) filter (where p.phone_number is null and p.whatsapp is null and tp.whatsapp_number is null)::int none from profiles p left join tutor_profiles tp on tp.id=p.id where p.role='tutor' and p.phone_verified_at is null and p.email is not null and p.email not ilike '%@users.tutormint.org' and p.created_at < '2026-11-23'`)
  await q('grants', `select key, length(value) len from app_settings where key in ('staff.all_rows','staff.insights','email.daily_limit')`)
  await q('tuition_owners cols', `select column_name from information_schema.columns where table_schema='public' and table_name='tuition_owners'`)
  await q('member_follow_ups cols', `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='member_follow_ups'`)
  await q('consume_rate_limit', `select pg_get_function_identity_arguments(p.oid) args from pg_proc p where proname='consume_rate_limit'`)
  await q('rank state', `select * from tutor_rank_cache_state`)
  await q('pg_cron runs (last 15 min)', `select j.jobname, d.status, count(*)::int n, max(d.end_time) last from cron.job_run_details d join cron.job j using (jobid) where d.start_time > now() - interval '15 minutes' group by 1, 2`)
  await q('otp_alerts rows', `select status, count(*)::int n from otp_alerts group by 1`)
  await c.query('begin')
  try {
    const t0 = Date.now()
    const r = await c.query(`select refresh_tutor_rank_cache(null) n`)
    console.log('refresh full (rolled back) ms', Date.now() - t0, 'changed', r.rows[0].n)
    const t1 = Date.now()
    const r2 = await c.query(`select refresh_tutor_rank_cache(null) n`)
    console.log('refresh again ms', Date.now() - t1, 'changed', r2.rows[0].n)
  } catch (e) {
    console.log('refresh ERROR', e instanceof Error ? e.message : e)
  } finally {
    await c.query('rollback')
  }
  await c.end()
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
