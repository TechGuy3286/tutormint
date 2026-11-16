/**
 * scripts/report-seo-crawl.ts — READ ONLY (owner, 16 Nov 2026).
 *
 * Tuition crawlability audit: open tuitions per city, the Mianwali rows, paused
 * counts, and the Indexing API queue state. Prints no phone, email or contact.
 *
 *   npx tsx --env-file=.env.local scripts/report-seo-crawl.ts
 */

// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const st = await c.query(`select status, count(*)::int n from jobs group by 1 order by 2 desc`)
    console.log('Jobs by status:', st.rows)
    const cities = await c.query(
      `select lower(trim(city)) city, count(*) filter (where status='open')::int open, count(*)::int total
         from jobs where city is not null group by 1 order by 2 desc`,
    )
    console.log('Cities with jobs:', cities.rows.length, 'with open:', cities.rows.filter((r: { open: number }) => r.open > 0).length)
    console.log('Open 1-2:', cities.rows.filter((r: { open: number }) => r.open > 0 && r.open < 3).map((r: { city: string }) => r.city).join(', '))
    console.log('Zero open:', cities.rows.filter((r: { open: number }) => r.open === 0).map((r: { city: string; total: number }) => `${r.city}(${r.total})`).join(', '))
    const mw = await c.query(
      `select ref_id, status, city, area, public_slug, created_at::date, paused_at::date, merged_into is not null merged, hidden_reason
         from jobs where city ilike '%mianwali%' order by created_at`,
    )
    console.log('Mianwali jobs:', mw.rows)
    const mc = await c.query(`select id, name from location_cities where name ilike '%mianwali%'`)
    console.log('Mianwali in location_cities:', mc.rows)
    const q = await c.query(
      `select kind, (sent_at is not null and sent_at > '2000-01-01') sent, skip_reason, count(*)::int n from indexing_queue group by 1,2,3 order by 4 desc`,
    )
    console.log('indexing_queue:', q.rows)
    const a = await c.query(
      `select ok, count(*)::int n from indexing_attempts where attempted_at > now() - interval '7 days' group by 1`,
    )
    console.log('indexing_attempts 7d:', a.rows)
    const it = await c.query(`select count(*)::int n from indexable_tuitions()`)
    console.log('indexable_tuitions():', it.rows)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
