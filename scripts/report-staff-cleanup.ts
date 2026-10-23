/**
 * scripts/report-staff-cleanup.ts — READ-ONLY. Facts for the staff clean-up PR
 * (owner, 24 Oct 2026): why a given parent page 404s, every account with staff
 * or admin access anywhere (name and role only), and the tuitions of hidden or
 * test parents. Never prints a phone, CNIC or email.
 *   npx tsx --env-file=.env.local scripts/report-staff-cleanup.ts [parentId]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const parentId = process.argv[2] ?? '7b811c18-f25a-435c-bed0-b2421ca6391b'
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = async (label: string, sql: string, params: unknown[] = []) => {
    const r = await c.query(sql, params)
    console.log(`\n== ${label}`)
    console.table(r.rows)
    return r.rows
  }

  await q('the parent', `
    select p.id, p.full_name, p.role, p.admin_role, p.is_suspended, p.is_banned, p.hidden_from_public,
           p.is_test_name, p.is_seed, p.is_team_account, p.paused_by_user_at is not null as self_paused,
           p.created_at, (select count(*) from jobs j where j.parent_id = p.id) as jobs,
           (select count(*) from jobs j where j.parent_id = p.id and j.status='open') as open_jobs,
           (select count(*) from tutor_profiles tp where tp.id = p.id) as has_tutor_profile
      from profiles p where p.id = $1`, [parentId])

  await q('the parent: audit rows targeting them', `
    select action, actor_role, created_at from admin_audit_log where target_id = $1 order by created_at`, [parentId])

  await q('parents whose /parent/[id] would 404 but have open jobs', `
    select p.id, p.full_name, p.role, p.is_suspended, p.hidden_from_public, p.is_test_name, p.is_banned,
           count(j.id) filter (where j.status='open') as open_jobs, count(j.id) as jobs
      from profiles p join jobs j on j.parent_id = p.id
     where (p.role not in ('parent','academy') or p.is_suspended or p.hidden_from_public)
     group by p.id order by open_jobs desc`)

  await q('every account with role admin or an admin_role', `
    select p.id, p.full_name, p.role, p.admin_role, p.is_suspended, p.hidden_from_public
      from profiles p where p.role = 'admin' or p.admin_role is not null order by p.admin_role, p.full_name`)

  await q('staff join links (all)', `
    select l.staff_id, p.full_name, p.role, p.admin_role, l.slug, l.code
      from staff_join_links l left join profiles p on p.id = l.staff_id order by p.full_name`)

  await q('city owners', `
    select c.city, p.full_name, p.admin_role from city_owners c left join profiles p on p.id = c.staff_id order by c.city`)

  await q('tuition owners by staff', `
    select o.staff_id, p.full_name, p.admin_role, o.source, count(*) from tuition_owners o
      left join profiles p on p.id = o.staff_id group by 1,2,3,4 order by 2`)

  await q('target list', `
    select t.staff_id, p.full_name, t.on_list from staff_target_list t left join profiles p on p.id = t.staff_id`)

  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
