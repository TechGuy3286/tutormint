/**
 * scripts/report-oct27.ts — READ-ONLY. Facts for the erase / Manager / subject
 * cap PR (owner, 27 Oct 2026). Prints ids, roles and counts only — never a
 * phone, CNIC or email.
 *   npx tsx --env-file=.env.local scripts/report-oct27.ts [email-to-check]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase()
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  const q = async (label: string, sql: string, params: unknown[] = []) => {
    const r = await c.query(sql, params)
    console.log(`\n== ${label}`)
    console.table(r.rows)
    return r.rows
  }

  await q('accounts named like Fatima Bangash', `
    select p.id, p.role, p.created_at::date as joined,
           (p.email is not null and p.email not like '%@users.tutormint.org') as has_real_email
      from profiles p where p.full_name ilike '%fatima%' and p.full_name ilike '%bangash%'`)
  if (email) {
    await q('exact email match (profiles / auth.users)', `
      select p.id, p.role, 'profiles' as src from profiles p where lower(p.email) = $1
      union all select u.id, null, 'auth.users' from auth.users u where lower(u.email) = $1`, [email])
  }

  await q('Aqsa Mughal role', `
    select id, role, admin_role, former_staff_at is not null as former from profiles where full_name ilike 'aqsa mughal%'`)

  await q('tutors over the 15-subject cap (distinct subjects)', `
    select ts.tutor_id as id, count(distinct tm.subject_slug) as subjects, count(distinct tm.subject_slug) - 15 as over_by
      from tutor_subjects ts join taxonomy_master tm on tm.id = ts.master_id
      join profiles p on p.id = ts.tutor_id
     where p.role = 'tutor'
     group by ts.tutor_id having count(distinct tm.subject_slug) > 15 order by 2 desc`)

  await q('reviews table', `select status, count(*) from reviews group by 1`).catch(async () =>
    q('reviews table (no status column)', `select count(*) from reviews`))
  await q('reviews columns', `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='reviews' order by ordinal_position`)
  await c.end()
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
