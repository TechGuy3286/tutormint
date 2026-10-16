/**
 * scripts/report-my-signups-facts.ts — READ ONLY (owner, 16 Oct 2026).
 * Facts for the "My sign-ups" page and the 16 Oct added-areas review:
 *   staff accounts + join links + credits + claims + target list; the 16 Oct
 *   run's audit rows (area_add / alias / not_area) and their detail shape.
 *   npx tsx --env-file=.env.local scripts/report-my-signups-facts.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const staff = await c.query(
      `select p.id, p.full_name, p.admin_role, p.is_suspended, l.slug, l.code,
              (select count(*) from staff_signup_credits s where s.staff_id = p.id) credits,
              (select count(*) from staff_signup_claims s where s.staff_id = p.id) claims,
              coalesce((select on_list from staff_target_list t where t.staff_id = p.id), false) on_list
         from profiles p left join staff_join_links l on l.staff_id = p.id
        where p.role = 'admin' order by p.admin_role, p.full_name`,
    )
    for (const r of staff.rows) console.log(`${r.admin_role}\t${r.full_name}\t${r.id}\tpaused=${!!r.is_suspended}\tslug=${r.slug}\tcredits=${r.credits}\tclaims=${r.claims}\tlist=${r.on_list}`)
    const credits = await c.query(`select source, member_role, count(*) n from staff_signup_credits group by 1,2`)
    console.log('credits', credits.rows)
    const claims = await c.query(`select status, count(*) n from staff_signup_claims group by 1`)
    console.log('claims', claims.rows)
    const cols = await c.query(
      `select table_name, column_name from information_schema.columns where table_schema='public' and table_name in ('staff_signup_credits','staff_signup_claims','staff_join_links','staff_referral_visits','location_areas','location_area_aliases','location_ignored') order by table_name, ordinal_position`,
    )
    const byT = new Map<string, string[]>()
    for (const r of cols.rows) byT.set(r.table_name, [...(byT.get(r.table_name) ?? []), r.column_name])
    for (const [t, cs] of byT) console.log(t, cs.join(','))
    const pol = await c.query(
      `select tablename, policyname, cmd, qual from pg_policies where tablename in ('staff_signup_credits','staff_signup_claims','staff_join_links','staff_referral_visits')`,
    )
    for (const r of pol.rows) console.log('policy', r.tablename, r.policyname, r.cmd, r.qual)
    const audit = await c.query(
      `select action, count(*) n, min(created_at) a, max(created_at) b from admin_audit_log
        where action like 'location.%' and created_at between '2026-10-16T08:50:00Z' and '2026-10-16T09:05:00Z' group by 1`,
    )
    console.log('16 Oct run', audit.rows)
    const sample = await c.query(
      `select action, target_type, target_id, detail from admin_audit_log
        where action like 'location.%' and created_at between '2026-10-16T08:50:00Z' and '2026-10-16T09:05:00Z' order by created_at limit 6`,
    )
    for (const r of sample.rows) console.log(JSON.stringify(r))
    const actlog = await c.query(`select action, count(*) n from admin_audit_log where action like 'staff.%' group by 1`)
    console.log('staff.* audit', actlog.rows)
    const notif = await c.query(`select kind, count(*) n from notifications where kind like 'staff%' group by 1`)
    console.log('notif', notif.rows)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
