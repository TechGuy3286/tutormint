/** Read-only (hotfix, 26 Oct 2026): which statements write temp files (sort /
 *  hash spills) and read most blocks from disk — the disk-IO load.
 *
 *   npx tsx --env-file=.env.local scripts/report-db-spill.ts */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 20000 })
  await c.connect()
  try {
    const show = (rows: Record<string, unknown>[]) => {
      for (const r of rows) console.log(Object.values(r).map(String).join(' | '))
      if (!rows.length) console.log('(none)')
    }
    console.log('== temp blocks written (8 kB each)')
    show((await c.query(`select calls, temp_blks_written, round(mean_exec_time::numeric,1) mean_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 220) q from pg_stat_statements where temp_blks_written > 0 order by temp_blks_written desc limit 12`)).rows)
    console.log('== shared blocks read from disk')
    show((await c.query(`select calls, shared_blks_read, shared_blks_hit, round(mean_exec_time::numeric,1) mean_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 220) q from pg_stat_statements order by shared_blks_read desc limit 12`)).rows)
    console.log('== cache hit ratio')
    show((await c.query(`select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) hit_pct from pg_stat_database`)).rows)
    console.log('== database size')
    show((await c.query(`select pg_size_pretty(pg_database_size(current_database())) size`)).rows)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
