/**
 * scripts/report-landing-view-calls.ts — READ ONLY (owner, 28 Oct 2026).
 * How many times the landing_combinations view has been read (pg_stat_statements
 * running totals). Run twice a few minutes apart to see the rate.
 *   npx tsx --env-file=.env.local scripts/report-landing-view-calls.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const r = await c.query(`select coalesce(sum(calls),0)::bigint calls, round(coalesce(sum(total_exec_time),0))::bigint ms from pg_stat_statements where query ilike '%landing_combinations%'`)
  console.log(new Date().toISOString(), 'landing_combinations reads:', r.rows[0].calls, 'total ms:', r.rows[0].ms)
  await c.end()
}
void main()
