/**
 * scripts/report-search-counts.ts — read-only: the row counts of every search
 * log and of the cards built from them. Run before and after a crawl to see
 * that it added nothing. Nothing is written.
 *   npx tsx --env-file=.env.local scripts/report-search-counts.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(`select
    (select count(*)::int from anon_search_events) as anon_rows,
    (select count(*)::int from anon_search_events where excluded is null) as anon_counted,
    (select max(created_at) from anon_search_events) as anon_newest,
    (select count(*)::int from user_activity_log where event = 'search_performed') as member_rows,
    (select count(*)::int from search_unmet) as unmet_rows,
    (select count(*)::int from content_suggestions where card = 'recruitment') as recruitment_rows,
    (select count(*)::int from content_suggestions where card = 'recruitment' and status = 'suggested') as recruitment_open,
    (select count(*)::int from content_suggestions where card = 'content' and status = 'suggested') as blog_open,
    (select count(*)::int from content_suggestions) as suggestion_rows`)
  console.log(JSON.stringify(rows[0]))
  await c.end()
}

void main()
