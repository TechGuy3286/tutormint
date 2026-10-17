/** Read-only unless --kill: list sessions idle in a transaction for over a minute (state, age, first 60 chars of the query). With --kill, ends those that ran a migration statement (ALTER TABLE document_unlocks). */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 15000 })
  await c.connect()
  try {
    const r = await c.query(`select pid, state, now() - xact_start as age, left(query, 60) q from pg_stat_activity where state like 'idle in transaction%' and xact_start < now() - interval '1 minute'`)
    for (const x of r.rows) console.log(x.pid, x.state, x.age, x.q)
    if (process.argv.includes('--kill')) {
      for (const x of r.rows) if (/document_unlocks|lock_|tm_photo|profile_pic|tutor_profiles/i.test(x.q)) console.log('terminated', x.pid, (await c.query('select pg_terminate_backend($1) t', [x.pid])).rows[0].t)
    }
  } finally { await c.end() }
}
main().catch((e) => { console.error(e); process.exit(1) })
