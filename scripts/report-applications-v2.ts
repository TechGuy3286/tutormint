/**
 * scripts/report-applications-v2.ts — READ ONLY. Applications v2 (owner, 22 Oct
 * 2026): staff accounts (name + role, no contact details), the city-owner names
 * and whether each matches exactly one staff account, tuition owners by source,
 * how many tuitions have no staff poster, and past parent hires that have an
 * application not yet at Hired. No phone, CNIC or email is printed.
 *   npx tsx --env-file=.env.local scripts/report-applications-v2.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { CITY_OWNER_SEED, matchStaffName } from '../lib/cityOwnersCore'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const staff = (await c.query(`select id, full_name, admin_role, is_suspended from profiles where role = 'admin' and admin_role is not null order by full_name`)).rows
    console.log('staff:', staff.map((s: { full_name: string; admin_role: string; is_suspended: boolean }) => `${s.full_name} (${s.admin_role}${s.is_suspended ? ', paused' : ''})`))
    const live = staff.filter((s: { is_suspended: boolean }) => !s.is_suspended).map((s: { id: string; full_name: string }) => ({ id: s.id, name: s.full_name }))
    const cities = new Set((await c.query(`select name from location_cities`)).rows.map((r: { name: string }) => r.name))
    for (const row of CITY_OWNER_SEED) {
      const m = matchStaffName(row.name, live)
      console.log(`${row.name} → ${m ? 'matched' : 'NO MATCH'}; cities: ${row.cities.map((x) => (cities.has(x) ? x : `${x}(NOT A CITY)`)).join(', ')}`)
    }
    console.log('owners by source:', (await c.query(`select source, (staff_id is null) unassigned, count(*)::int n from tuition_owners group by 1,2 order by 1,2`)).rows)
    console.log('jobs total:', (await c.query(`select count(*)::int n from jobs`)).rows[0].n)
    console.log('jobs with no owner row:', (await c.query(`select count(*)::int n from jobs j where not exists (select 1 from tuition_owners o where o.job_id = j.id)`)).rows[0].n)
    console.log('job cities (top):', (await c.query(`select city, count(*)::int n from jobs group by 1 order by 2 desc limit 40`)).rows)
    const hires = (await c.query(`
      select count(*)::int n from applications a join jobs j on j.id = a.job_id
       where a.withdrawn_at is null and a.stage <> 'hired'
         and (a.status = 'hired' or (j.hired_tutor_id = a.tutor_id))`)).rows[0].n
    console.log('past parent hires with application not at Hired:', hires)
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
