/**
 * scripts/report-pr170-facts.ts — READ ONLY (owner, 13 Oct 2026).
 * Facts for the blog-banner / switched-tutor email / Partner-rights PR.
 * No names, emails or numbers of members are printed.
 *   npx tsx --env-file=.env.local scripts/report-pr170-facts.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const posts = await c.query(
      `select slug, status, cluster, audience, city, subject, cover_path, cover_alt, related_landing_pages, created_at::date as created
       from posts order by created_at`,
    )
    console.log('POSTS', posts.rows.length)
    for (const p of posts.rows) console.log(JSON.stringify(p))

    const pol = await c.query(
      `select tablename, policyname, cmd from pg_policies
       where schemaname = 'public' and cmd <> 'SELECT'
         and (coalesce(qual,'') || coalesce(with_check,'')) like '%is_admin_writer()%'
       order by tablename, policyname`,
    )
    console.log('WRITE POLICIES via is_admin_writer:', pol.rows.length)
    console.log(pol.rows.map((r: { tablename: string; cmd: string }) => `${r.tablename}:${r.cmd}`).join(' '))
    const st = await c.query(
      `select tablename, policyname, cmd, coalesce(qual,'') || ' / ' || coalesce(with_check,'') as expr from pg_policies
       where schemaname = 'storage' and cmd <> 'SELECT' and (coalesce(qual,'') || coalesce(with_check,'')) like '%admin%'`,
    )
    console.log('STORAGE admin write policies:')
    for (const r of st.rows) console.log(JSON.stringify(r))

    const staff = await c.query(`select admin_role, count(*)::int as n from profiles where role = 'admin' and admin_role is not null group by 1`)
    console.log('STAFF', JSON.stringify(staff.rows))

    const pending = await c.query(
      `select count(*)::int as pending,
              count(*) filter (where phone_verified_at is not null)::int as mobile_verified,
              count(*) filter (where is_suspended or is_banned or paused_by_user_at is not null)::int as paused,
              count(*) filter (where is_seed or is_test_name or role <> 'tutor')::int as test_or_not_tutor
       from profiles where email_pending_confirm`,
    )
    console.log('EMAIL PENDING', JSON.stringify(pending.rows[0]))
    const audit = await c.query(`select count(*)::int as n, min(created_at) as first, max(created_at) as last from admin_audit_log where action = 'member.email_unblock'`)
    console.log('email_unblock audit rows', JSON.stringify(audit.rows[0]))

    const cols = await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name='tutor_profiles' and column_name in ('selfie_status','hidden_from_public')`)
    console.log('tutor_profiles cols', cols.rows.map((r: { column_name: string }) => r.column_name).join(','))
    const dir = await c.query(`select count(*)::int as listed, count(*) filter (where verified_fee_paid_at is not null)::int as fee_paid from tutor_directory d join tutor_profiles tp on tp.id = d.id`)
    console.log('DIRECTORY', JSON.stringify(dir.rows[0]))
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
