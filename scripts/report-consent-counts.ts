/**
 * scripts/report-consent-counts.ts — read-only. Consent counts (Recorded / Not
 * recorded), per staff poster, and how many tuitions have their number hidden
 * now. Counts and staff names only.
 *
 *   npx tsx --env-file=.env.local scripts/report-consent-counts.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  try {
    const all = await c.query(`select status, coalesce(method,'—') method, count(*)::int n from tuition_consents group by 1,2 order by 1,2`)
    console.log('\n== all tuitions'); console.table(all.rows)
    const staff = await c.query(`
      select coalesce(sp.full_name, '(no staff poster)') staff,
             count(*) filter (where tc.status = 'recorded')::int recorded,
             count(*) filter (where tc.status = 'not_recorded')::int not_recorded
      from jobs j join profiles p on p.id = j.parent_id and p.is_team_account
      join tuition_consents tc on tc.job_id = j.id
      left join tuition_owners o on o.job_id = j.id left join profiles sp on sp.id = o.posted_by
      group by 1 order by 3 desc`)
    console.log('\n== staff-posted, by poster'); console.table(staff.rows)
    const sw = await c.query(`select value from app_settings where key = 'privacy.hide_unconsented_numbers'`)
    const hidden = await c.query(`
      select j.status, count(*)::int n from tuition_consents tc join jobs j on j.id = tc.job_id
      where tc.status = 'not_recorded' group by 1 order by 1`)
    console.log(`\n== switch: ${sw.rows[0]?.value}; not-recorded tuitions by status`); console.table(hidden.rows)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
