/**
 * scripts/report-slow-queries.ts — READ ONLY (owner, 28 Oct 2026).
 * The statements that cost the database the most time (pg_stat_statements), and
 * tables read mostly by sequential scans. Prints the first 160 characters of
 * each statement's normalised text (values are already $n placeholders).
 *   npx tsx --env-file=.env.local scripts/report-slow-queries.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const top = await c.query(`select calls, round(total_exec_time)::int total_ms, round(mean_exec_time::numeric,1) mean_ms, rows, left(regexp_replace(query, '\s+', ' ', 'g'), 160) q
    from pg_stat_statements where query not ilike '%pg_stat%' order by total_exec_time desc limit 25`)
  for (const r of top.rows) console.log(`${String(r.total_ms).padStart(9)} ms total  ${String(r.mean_ms).padStart(7)} mean  ${String(r.calls).padStart(7)} calls  ${r.q}`)
  const seq = await c.query(`select relname, seq_scan, seq_tup_read, idx_scan, n_live_tup from pg_stat_user_tables where seq_scan > 1000 and n_live_tup > 500 order by seq_tup_read desc limit 15`)
  console.log('\nseq scans:')
  for (const r of seq.rows) console.log(`  ${r.relname.padEnd(28)} seq ${r.seq_scan} read ${r.seq_tup_read} idx ${r.idx_scan} rows ${r.n_live_tup}`)
  await c.end()
}
void main()
