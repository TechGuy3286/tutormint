/**
 * scripts/report-target-staff.ts — READ ONLY. Lists every staff account (name,
 * role, paused) and how many paid sign-ups each is credited with, so the
 * monthly-target seed (migration 177) can be checked against real names.
 *   npx tsx --env-file=.env.local scripts/report-target-staff.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const staff = await c.query(
      `select p.id, p.full_name, p.admin_role, p.is_suspended,
              (select count(*) from staff_signup_credits s where s.staff_id = p.id) as credits
         from profiles p where p.role = 'admin' order by p.admin_role, p.full_name`,
    )
    for (const r of staff.rows) console.log(`${r.admin_role}\t${r.full_name}\tpaused=${!!r.is_suspended}\tcredits=${r.credits}`)
    const plans = await c.query(
      `select plan_code, status, count(*) n from payments group by 1,2 order by 1,2`,
    )
    for (const r of plans.rows) console.log(`payments ${r.plan_code} ${r.status} ${r.n}`)
    const prov = await c.query(`select provider, count(*) n from payments group by 1 order by 1`)
    for (const r of prov.rows) console.log(`provider ${r.provider} ${r.n}`)
    const exists = await c.query(`select to_regclass('public.staff_monthly_targets') t, to_regclass('public.staff_target_list') l`)
    console.log('tables', exists.rows[0])
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
