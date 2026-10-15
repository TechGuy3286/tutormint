/**
 * scripts/report-sms-silence.ts — READ-ONLY. Where did new signups stop since a
 * given time, and did any verification code go out? Counts only — never a
 * number or a code.
 *   npx tsx --env-file=.env.local scripts/report-sms-silence.ts [sinceIso]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const SINCE = process.argv[2] ?? '2026-10-13T12:00:00Z' // 13 Oct 17:00 PKT

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = async (label: string, sql: string, params: unknown[] = [SINCE]) => {
    const r = await c.query(sql, params)
    console.log(`\n== ${label}`)
    console.table(r.rows)
  }

  await q(
    'new accounts by PKT day, role, signup channel',
    `select to_char(p.created_at at time zone 'Asia/Karachi','YYYY-MM-DD') as day, p.role,
            case when u.email like '%@users.tutormint.org' then 'mobile' else 'email' end as channel,
            count(*) as n,
            count(p.phone_verified_at) as mobile_verified,
            count(*) filter (where p.phone_verified_via = 'otp') as via_otp,
            count(*) filter (where p.phone_verified_via = 'bridge') as via_bridge,
            count(tp.onboarded_at) as onboarded
       from profiles p join auth.users u on u.id = p.id
       left join tutor_profiles tp on tp.id = p.id
      where p.created_at >= $1 and p.role in ('tutor','parent')
      group by 1,2,3 order by 1,2,3`,
  )

  await q(
    'phone_otps rows since (by PKT day, purpose)',
    `select to_char(created_at at time zone 'Asia/Karachi','YYYY-MM-DD') as day, purpose,
            count(*) as rows, count(consumed_at) as consumed, count(*) filter (where user_id is null) as no_user,
            count(*) filter (where attempts >= 5) as locked
       from phone_otps where created_at >= $1 group by 1,2 order by 1,2`,
  )

  await q('pending_signups live rows since', `select count(*) as rows, max(created_at) as newest from pending_signups where created_at >= $1`)

  await q(
    'newest phone verifications (time only)',
    `select phone_verified_at, phone_verified_via, role from profiles where phone_verified_at is not null order by phone_verified_at desc limit 8`,
    [],
  )

  await q(
    'phone_otps by PKT day, last 10 days (baseline)',
    `select to_char(created_at at time zone 'Asia/Karachi','YYYY-MM-DD') as day, count(*) as rows, count(consumed_at) as consumed
       from phone_otps where created_at >= now() - interval '10 days' group by 1 order by 1`,
    [],
  )

  await q(
    'mobile verifications by PKT day, last 10 days (baseline)',
    `select to_char(phone_verified_at at time zone 'Asia/Karachi','YYYY-MM-DD') as day, phone_verified_via as via, count(*)
       from profiles where phone_verified_at >= now() - interval '10 days' group by 1,2 order by 1,2`,
    [],
  )

  await q(
    'rate limit rows for SMS buckets in the last 2 days',
    `select bucket, count(*) as keys, max(count) as max_count from rate_limits
      where bucket in ('otp_send','otp_verify','register','register_bridge') and window_start >= now() - interval '2 days'
      group by 1 order by 1`,
    [],
  ).catch((e) => console.log('rate_limits query failed:', (e as Error).message))

  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
