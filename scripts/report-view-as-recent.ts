/**
 * scripts/report-view-as-recent.ts — READ ONLY (owner, 26 Oct 2026).
 * The tutors opened with "View as tutor" in the last 3 days, and every tutor
 * whose name looks like "Samia". Names and ids only. Changes nothing.
 *   npx tsx --env-file=.env.local scripts/report-view-as-recent.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const v = await c.query(
      `select a.created_at, a.target_id, a.detail->>'name' as name from admin_audit_log a
        where a.action = 'view_as_tutor' and a.created_at > now() - interval '3 days' order by a.created_at`,
    )
    for (const r of v.rows) console.log('view_as', r.created_at.toISOString(), r.target_id, r.name)
    const n = await c.query(
      `select id, full_name, role, created_at from profiles
        where full_name ~* '(sami|samy|sumi|saami|samee)' order by created_at`,
    )
    for (const r of n.rows) console.log('name', r.id, r.full_name, r.role, r.created_at.toISOString())
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
