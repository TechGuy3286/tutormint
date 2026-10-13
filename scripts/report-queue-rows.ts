/**
 * scripts/report-queue-rows.ts — read-only: content_suggestions by card, status
 * and source, with the newest rows. Nothing is written.
 *   npx tsx --env-file=.env.local scripts/report-queue-rows.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const a = await c.query(`select card, status, source, count(*)::int as n from content_suggestions group by 1, 2, 3 order by 1, 2, 3`)
  for (const r of a.rows) console.log(JSON.stringify(r))
  const b = await c.query(`select card, status, left(fingerprint, 40) as fp, left(title, 70) as title, first_seen_at from content_suggestions where first_seen_at > now() - interval '3 hours' order by first_seen_at desc, title limit 70`)
  for (const r of b.rows) console.log(`${r.card}\t${r.status}\t${r.fp}\t${r.title}`)
  await c.end()
}

void main()
