/** Read-only (hotfix, 26 Oct 2026): the indexes on the tables with the most
 *  sequential scans, the statements that touch them most, and EXPLAIN plans of
 *  the hot shapes (no ANALYZE on writes — nothing is executed but SELECTs).
 *
 *   npx tsx --env-file=.env.local scripts/report-db-indexes.ts */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 20000 })
  await c.connect()
  try {
    for (const t of ['job_subjects', 'jobs', 'profiles', 'tutor_areas', 'view_as_sessions', 'settlement_links', 'bank_transfers', 'payments']) {
      const r = await c.query(`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = $1`, [t])
      console.log(`\n== ${t}`)
      for (const x of r.rows) console.log('  ', x.indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON public\.\S+ USING /, '$1'))
    }
    console.log('\n== statements on job_subjects (by calls)')
    const s = await c.query(
      `select calls, round(mean_exec_time::numeric,2) mean_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 400) q from pg_stat_statements where query ilike '%job_subjects%' order by calls desc limit 6`,
    )
    for (const x of s.rows) console.log(x.calls, x.mean_ms, x.q, '\n')
    console.log('\n== statements on profiles that scan (by calls, mean > 1 ms)')
    const p = await c.query(
      `select calls, round(mean_exec_time::numeric,2) mean_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 300) q from pg_stat_statements where query ilike '%"public"."profiles"%' and mean_exec_time > 1 order by calls desc limit 6`,
    )
    for (const x of p.rows) console.log(x.calls, x.mean_ms, x.q, '\n')
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
