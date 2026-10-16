/**
 * scripts/report-my-signups-templates.ts — READ ONLY (owner, 16 Oct 2026).
 * The follow-up message templates "My sign-ups" may reuse, and what the 16 Oct
 * Locations run wrote (ignored rows, alias rows) inside its window.
 *   npx tsx --env-file=.env.local scripts/report-my-signups-templates.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const t = await c.query(`select key, title, body from admin_message_templates order by key`)
    for (const r of t.rows) console.log(`--- ${r.key} | ${r.title}\n${r.body}`)
    const ig = await c.query(
      `select count(*) n, count(*) filter (where removed_at is null) live from location_ignored where created_at between '2026-10-16T08:50:00Z' and '2026-10-16T09:05:00Z'`,
    )
    console.log('ignored in window', ig.rows)
    const al = await c.query(
      `select count(*) n, count(*) filter (where removed_at is null) live from location_area_aliases where created_at between '2026-10-16T08:50:00Z' and '2026-10-16T09:05:00Z'`,
    )
    console.log('aliases in window', al.rows)
    const ar = await c.query(
      `select count(*) n, count(*) filter (where removed_at is null) live, count(*) filter (where created_by is null) noby
         from location_areas where id in (select target_id::int from admin_audit_log where action='location.area_add'
          and created_at between '2026-10-16T08:50:00Z' and '2026-10-16T09:05:00Z')`,
    )
    console.log('run areas', ar.rows)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
