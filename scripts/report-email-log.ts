// scripts/report-email-log.ts — READ ONLY. Counts in the email log (migration
// 183) since a time, by job and status, and the newest bulk runs. No addresses.
//   npx tsx --env-file=.env.local scripts/report-email-log.ts [ISO time]

// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const since = process.argv[2] ?? new Date(Date.now() - 86_400_000).toISOString()
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const s = await c.query(
      `select mode, job, status, count(*)::int n, max(attempts)::int max_attempts, min(created_at) first, max(created_at) last
         from email_sends where created_at >= $1 group by 1, 2, 3 order by 1, 2, 3`,
      [since],
    )
    console.log(`email_sends since ${since}:`)
    console.table(s.rows)
    const r = await c.query(`select job, started_at, attempted, delivered, failed, skipped, requests from email_runs order by started_at desc limit 10`)
    console.log('newest bulk runs:')
    console.table(r.rows)
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
