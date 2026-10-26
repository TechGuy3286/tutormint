/** Read-only database health report (hotfix, 26 Oct 2026).
 *
 *   npx tsx --env-file=.env.local scripts/report-db-health.ts [--top=25] [--reset-note]
 *
 * Prints: sessions by state, any session idle in a transaction or running for
 * over 30 s, lock waits, the slowest statements in pg_stat_statements (mean and
 * total time, calls — query text cut to 160 chars, literals already replaced by
 * pg_stat_statements with $n), and the stats reset time. Never writes. Never
 * prints a value from a member row. */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const top = Number(process.argv.find((a) => a.startsWith('--top='))?.slice(6) ?? 25)

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 20000 })
  await c.connect()
  try {
    const q = async (title: string, sql: string) => {
      console.log(`\n== ${title}`)
      try {
        const r = await c.query(sql)
        for (const row of r.rows) console.log(Object.values(row).map((v) => (v instanceof Date ? v.toISOString() : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))).join(' | '))
        if (!r.rows.length) console.log('(none)')
      } catch (e) {
        console.log('failed:', (e as Error).message)
      }
    }
    await q('sessions by state', `select usename, state, count(*) from pg_stat_activity where datname = current_database() group by 1,2 order by 3 desc`)
    await q('max connections', `select setting from pg_settings where name = 'max_connections'`)
    await q(
      'long or idle-in-transaction sessions (>30s)',
      `select pid, usename, state, now() - coalesce(xact_start, query_start) as age, wait_event_type, wait_event, left(regexp_replace(query, '\\s+', ' ', 'g'), 120) q
         from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid()
          and ((state like 'idle in transaction%' and xact_start < now() - interval '30 seconds')
            or (state = 'active' and query_start < now() - interval '30 seconds'))
        order by age desc`,
    )
    await q(
      'lock waits',
      `select w.pid waiting_pid, left(w.query, 80) waiting_q, b.pid blocking_pid, b.state blocking_state, left(b.query, 80) blocking_q
         from pg_stat_activity w join lateral unnest(pg_blocking_pids(w.pid)) bp(pid) on true join pg_stat_activity b on b.pid = bp.pid`,
    )
    await q('pg_stat_statements reset', `select stats_reset from pg_stat_statements_info`)
    await q(
      `top ${top} by total time`,
      `select calls, round(total_exec_time::numeric) total_ms, round(mean_exec_time::numeric, 1) mean_ms, round(max_exec_time::numeric) max_ms, rows,
              left(regexp_replace(query, '\\s+', ' ', 'g'), 160) q
         from pg_stat_statements order by total_exec_time desc limit ${top}`,
    )
    await q(
      `top ${top} by mean time (calls >= 5)`,
      `select calls, round(mean_exec_time::numeric, 1) mean_ms, round(max_exec_time::numeric) max_ms,
              left(regexp_replace(query, '\\s+', ' ', 'g'), 160) q
         from pg_stat_statements where calls >= 5 order by mean_exec_time desc limit ${top}`,
    )
    await q(
      'statements mentioning is_view_as_session / merged_into',
      `select calls, round(mean_exec_time::numeric, 2) mean_ms, round(total_exec_time::numeric) total_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 160) q
         from pg_stat_statements where query ilike '%is_view_as_session%' or query ilike '%merged_into%' or query ilike '%view_as_sessions%' order by total_exec_time desc limit 15`,
    )
    await q(
      'tables with most sequential scans',
      `select relname, seq_scan, seq_tup_read, idx_scan, n_live_tup from pg_stat_user_tables order by seq_tup_read desc limit 15`,
    )
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
