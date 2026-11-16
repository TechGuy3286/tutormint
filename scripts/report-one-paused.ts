/** READ ONLY: one recently paused and one long-paused tuition address, for the smoke test (16 Nov 2026). */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { citySegment } from '../lib/slugs'
async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    for (const w of [`paused_at > now() - interval '60 days'`, `paused_at < now() - interval '60 days'`]) {
      const r = await c.query(`select city, public_slug from jobs where status='paused' and merged_into is null and public_slug is not null and ${w} order by paused_at desc limit 1`)
      for (const x of r.rows) console.log(`/tuitions/${citySegment(x.city)}/${x.public_slug}`)
    }
  } finally {
    await c.end()
  }
}
main()
