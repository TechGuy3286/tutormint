/** PR-12 read-only: column shapes the Insights builder needs (no row values printed except event meta KEYS).
 *  npx tsx --env-file=.env.local scripts/report-pr12-events.ts */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  try {
    await c.query('begin read only')
    const cols = async (t: string) => (await c.query(`select string_agg(column_name, ', ' order by ordinal_position) s from information_schema.columns where table_schema='public' and table_name=$1`, [t])).rows[0].s
    for (const t of ['tutor_profiles', 'jobs', 'applications', 'profiles', 'messages', 'threads', 'tutor_documents', 'identity_documents', 'documents']) console.log(t, '::', await cols(t))
    const meta = await c.query(`select event, array_agg(distinct k) keys from (select event, jsonb_object_keys(meta) k from user_activity_log where event in ('search_performed','message_sent','demo_requested','document_uploaded','registered','job_posted','application_submitted') and created_at > now() - interval '7 days') x group by 1`)
    for (const r of meta.rows) console.log('meta', r.event, r.keys)
    const ev = await c.query(`select kind, count(*)::int n from activity_events where created_at > now() - interval '7 days' group by 1`)
    console.log('activity_events 7d', ev.rows)
    const pv = await c.query(`select split_part(path,'/',2) seg, count(*)::int n from activity_events where kind='page_view' and created_at > now() - interval '7 days' group by 1 order by 2 desc limit 15`)
    console.log('page_view first segment 7d', pv.rows)
    const sm = await c.query(`select array_agg(distinct k) keys from (select jsonb_object_keys(meta) k from activity_events where kind='search' and created_at > now() - interval '7 days') x`)
    console.log('activity search meta keys', sm.rows[0].keys)
    const an = await c.query(`select surface, count(*)::int n, count(*) filter (where excluded is null)::int counted from anon_search_events where created_at > now() - interval '7 days' group by 1`)
    console.log('anon searches 7d', an.rows)
    const vis = await c.query(`select kind, sum(count)::int n from site_visit_counts where day > current_date - 7 group by 1`)
    console.log('site visits 7d', vis.rows)
    const holds = await c.query(`select status, count(*)::int n from interest_holds group by 1`)
    console.log('interest_holds', holds.rows)
    await c.query('rollback')
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
