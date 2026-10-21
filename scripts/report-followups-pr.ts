/**
 * scripts/report-followups-pr.ts — READ ONLY (owner, 21 Oct 2026).
 * Facts for the Follow-ups PR: the stored message templates that carry a link,
 * and the accounts named in Part D (Javeria Fiaz, Aqsa Mughal). Never prints a
 * mobile, email or CNIC number — only ids, flags, dates and counts.
 *   npx tsx --env-file=.env.local scripts/report-followups-pr.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const t = await c.query(
      `select key, body from admin_message_templates where body ~ '\\{[a-z_]*(link|url)\\}' or body ilike '%tutormint.org%' order by key`,
    )
    for (const r of t.rows) console.log(`--- ${r.key}\n${r.body}\n`)

    const people = await c.query(
      `select p.id, p.full_name, p.role, p.admin_role, p.created_at, p.is_test_name, p.hidden_from_public, p.is_seed,
              p.linked_account_id, p.is_suspended,
              right(regexp_replace(coalesce(p.phone_number,''),'\\D','','g'),10) = right(regexp_replace(coalesce(a.phone_number,''),'\\D','','g'),10) as same_mobile_as_first,
              tp.verified_fee_paid_at, tp.onboarded_at, p.profile_completion,
              (select count(*) from payments x where x.user_id = p.id) pays,
              (select count(*) from payments x where x.user_id = p.id and x.status='approved') pays_ok,
              (select max(reviewed_at) from payments x where x.user_id = p.id and x.status='approved' and x.plan_code='verified') fee_ok_at,
              (select count(*) from user_activity_log l where l.user_id = p.id) events,
              (select max(last_seen_at) from activity_sessions s where s.user_id = p.id) last_seen,
              (select count(*) from tutor_subjects s where s.tutor_id = p.id) subjects,
              (select count(*) from applications ap where ap.tutor_id = p.id) applications
         from profiles p
         left join tutor_profiles tp on tp.id = p.id
         left join lateral (select phone_number from profiles q where q.full_name ilike '%aqsa%mughal%' order by q.created_at limit 1) a on true
        where p.full_name ilike '%javeria%' or p.full_name ilike '%aqsa%'
        order by p.full_name, p.created_at`,
    )
    for (const r of people.rows) console.log(JSON.stringify(r))
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
