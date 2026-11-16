// Read-only: when Search Console was last read and how fresh the content queue is. Counts only.
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
const { Client } = pg
async function main() {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await c.connect()
  const q = async (sql: string) => (await c.query(sql)).rows
  console.log(await q(`select source, status, fetched_at, jsonb_array_length(coalesce(rows,'[]'::jsonb)) n from search_console_queries`))
  console.log(await q(`select status, source, card, count(*)::int n, min(first_seen_at) oldest_first_seen, max(first_seen_at) newest_first_seen, max(last_seen_at) last_seen from content_suggestions group by 1,2,3 order by 1,2,3`))
  console.log(await q(`select value, updated_at from app_settings where key like 'content%' or key like '%queue%'`))
  await c.end()
}
main().catch((e) => { console.error(e.message); process.exit(1) })
