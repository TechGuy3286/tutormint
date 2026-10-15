/**
 * scripts/report-pr173-facts.ts — READ-ONLY. Facts for the sign-up-leaks PR
 * (owner, 15 Oct 2026): tutor accounts per day for 21 days, the team and its
 * two-factor status, the owner's display name, the onboarding mode, and the
 * Notify-me requests on file. Counts and names only — never a number or a code.
 *   npx tsx --env-file=.env.local scripts/report-pr173-facts.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = async (label: string, sql: string, params: unknown[] = []) => {
    const r = await c.query(sql, params)
    console.log(`\n== ${label}`)
    console.table(r.rows)
  }

  await q(
    'tutor accounts created per PKT day, last 21 days (real accounts: not seed, not test-named, not staff)',
    `with days as (
       select generate_series((now() at time zone 'Asia/Karachi')::date - 20, (now() at time zone 'Asia/Karachi')::date, '1 day')::date as day)
     select to_char(d.day,'YYYY-MM-DD Dy') as day,
            count(p.id) as tutors,
            count(p.id) filter (where u.email like '%@users.tutormint.org') as via_mobile,
            count(p.id) filter (where u.email not like '%@users.tutormint.org') as via_email,
            count(p.phone_verified_at) as mobile_verified,
            count(tp.onboarded_at) as onboarded,
            count(tp.verified_fee_paid_at) as fee_paid
       from days d
       left join profiles p on (p.created_at at time zone 'Asia/Karachi')::date = d.day
            and p.role = 'tutor' and coalesce(p.is_seed,false) = false and coalesce(p.is_test_name,false) = false
            and p.admin_role is null
       left join auth.users u on u.id = p.id
       left join tutor_profiles tp on tp.id = p.id
      group by d.day order by d.day`,
  )

  await q(
    'parent accounts created per PKT day, last 21 days',
    `with days as (
       select generate_series((now() at time zone 'Asia/Karachi')::date - 20, (now() at time zone 'Asia/Karachi')::date, '1 day')::date as day)
     select to_char(d.day,'YYYY-MM-DD') as day, count(p.id) as parents
       from days d left join profiles p on (p.created_at at time zone 'Asia/Karachi')::date = d.day
            and p.role = 'parent' and coalesce(p.is_seed,false) = false and coalesce(p.is_test_name,false) = false
      group by d.day order by d.day`,
  )

  await q(
    'team: role, display name, two-factor',
    `select p.full_name, p.admin_role, p.is_suspended,
            (select count(*) from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified') as mfa_factors,
            to_char(u.last_sign_in_at at time zone 'Asia/Karachi','YYYY-MM-DD HH24:MI') as last_sign_in_pkt
       from profiles p join auth.users u on u.id = p.id
      where p.role = 'admin' and p.admin_role is not null
      order by p.admin_role, p.full_name`,
  )

  await q('onboarding mode setting', `select key, value from app_settings where key ilike '%onboarding%'`)
  await q(
    'tutor_search_alerts by channel / open',
    `select channel, count(*) as n, count(*) filter (where closed_at is null) as open from tutor_search_alerts group by channel`,
  )
  await q(
    'message templates (keys)',
    `select key, title from admin_message_templates order by key`,
  )

  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
