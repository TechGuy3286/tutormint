/**
 * scripts/report-unmet-week.ts — read-only (owner, 28 Oct 2026).
 * Unmet searches of the last 7 days, and every search_unmet / anon_search_events
 * row around 24 Oct 14:03 PKT (09:03 UTC) whose text says "english".
 * Nothing is written. Prints query text and surface only (queries are masked
 * before they are stored).
 *   npx tsx --env-file=.env.local scripts/report-unmet-week.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const week = await c.query(
    `select u.query, u.surface, u.city, u.subject, u.level, u.role, u.is_test, u.created_at,
            (select max(d.done_at) from search_unmet_done d where lower(d.query) = lower(u.query)) as done_at
       from search_unmet u where u.created_at > now() - interval '7 days' order by u.created_at desc`,
  )
  console.log(`unmet last 7 days: ${week.rows.length}`)
  for (const r of week.rows) console.log(`  ${r.created_at.toISOString()}  [${r.surface}] role=${r.role ?? 'guest'} test=${r.is_test} done=${r.done_at ? 'y' : 'n'}  "${r.query}"  city=${r.city ?? ''} subj=${r.subject ?? ''} lvl=${r.level ?? ''}`)
  const eng = await c.query(
    `select query, surface, city, subject, level, role, created_at from search_unmet
      where created_at between '2026-10-24 08:00Z' and '2026-10-24 10:30Z' order by created_at`,
  )
  console.log(`\nunmet rows 24 Oct 08:00–10:30 UTC: ${eng.rows.length}`)
  for (const r of eng.rows) console.log(`  ${r.created_at.toISOString()} [${r.surface}] "${r.query}" city=${r.city ?? ''} subj=${r.subject ?? ''} lvl=${r.level ?? ''} role=${r.role ?? 'guest'}`)
  const cols = await c.query(`select column_name from information_schema.columns where table_name='anon_search_events' order by ordinal_position`)
  console.log('\nanon_search_events cols:', cols.rows.map((r: { column_name: string }) => r.column_name).join(', '))
  const anon = await c.query(
    `select * from anon_search_events where created_at between '2026-10-24 08:50Z' and '2026-10-24 09:20Z' order by created_at`,
  )
  console.log(`anon search rows 24 Oct 08:50–09:20 UTC: ${anon.rows.length}`)
  for (const r of anon.rows) {
    const { anon_id: _a, session_id: _s, ...rest } = r
    console.log('  ', JSON.stringify(rest))
  }
  await c.end()
}

void main()
