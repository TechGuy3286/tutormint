/**
 * scripts/report-application-tracking.ts — READ ONLY. Application tracking
 * (owner, 22 Oct 2026): applications by stage, owners per staff member,
 * unassigned tuitions (by TM reference only), and overdue counts per owner —
 * counted exactly as the board counts (withdrawn applications and staff / seed
 * / team / test-named / hidden tutors left out; overdue = Applied > 1 day,
 * Forwarded / Contacted / Demo > 3 days). No phone, CNIC or email is printed.
 *   npx tsx --env-file=.env.local scripts/report-application-tracking.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const COUNTED = `
  a.withdrawn_at is null
  and coalesce(p.role::text, '') <> 'admin'
  and not coalesce(p.is_seed, false) and not coalesce(p.is_team_account, false)
  and not coalesce(p.is_test_name, false) and not coalesce(p.hidden_from_public, false)`

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const all = (await c.query(`select stage, count(*)::int n from applications group by stage order by stage`)).rows
    console.log('every application row, by stage:', all)
    const counted = (await c.query(`select a.stage, count(*)::int n from applications a join profiles p on p.id = a.tutor_id where ${COUNTED} group by 1 order by 1`)).rows
    console.log('counted on the board, by stage:', counted)

    const owners = (await c.query(`
      select coalesce(s.full_name, '(unassigned)') owner, s.admin_role,
             count(distinct j.id)::int tuitions,
             count(distinct a.job_id) filter (where a.id is not null)::int tuitions_with_applications,
             count(a.id)::int applications
        from jobs j
        left join tuition_owners o on o.job_id = j.id
        left join profiles s on s.id = o.staff_id
        left join (applications a join profiles p on p.id = a.tutor_id and ${COUNTED.replace(/\n/g, ' ')}) on a.job_id = j.id
       group by 1, 2 order by 3 desc`)).rows
    console.log('owners (all tuitions):', owners)

    const un = (await c.query(`select j.ref_id from jobs j where not exists (select 1 from tuition_owners o where o.job_id = j.id and o.staff_id is not null) order by j.ref_id`)).rows
    console.log(`unassigned tuitions: ${un.length}`)
    console.log(un.map((r: { ref_id: string }) => r.ref_id).join(', '))
    const unApps = (await c.query(`select distinct j.ref_id from applications a join jobs j on j.id = a.job_id join profiles p on p.id = a.tutor_id
       where ${COUNTED} and not exists (select 1 from tuition_owners o where o.job_id = j.id and o.staff_id is not null) order by 1`)).rows
    console.log(`unassigned tuitions with counted applications: ${unApps.length}`, unApps.map((r: { ref_id: string }) => r.ref_id).join(', '))

    const od = (await c.query(`
      select coalesce(s.full_name, '(unassigned)') owner,
             count(*) filter (where a.stage = 'applied' and a.stage_changed_at < now() - interval '1 day')::int forward_overdue,
             count(*) filter (where a.stage in ('forwarded','contacted','demo') and a.stage_changed_at < now() - interval '3 days')::int check_in
        from applications a
        join profiles p on p.id = a.tutor_id
        join jobs j on j.id = a.job_id
        left join tuition_owners o on o.job_id = j.id
        left join profiles s on s.id = o.staff_id
       where ${COUNTED}
       group by 1 order by 1`)).rows
    console.log('overdue per owner:', od)
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
