/**
 * scripts/report-english-audit.ts — read-only (owner, 28 Oct 2026).
 * Search-word changes in the audit log, and taxonomy_subjects named like English.
 *   npx tsx --env-file=.env.local scripts/report-english-audit.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const a = await c.query(`select created_at, action, target_type, target_id, detail from admin_audit_log where action ilike '%search%' or action ilike 'taxonomy.%' order by created_at`)
  for (const r of a.rows) console.log(r.created_at.toISOString(), r.action, r.target_type, r.target_id, JSON.stringify(r.detail).slice(0, 200))
  const s = await c.query(`select slug, name from taxonomy_subjects where name ilike '%english%' or slug ilike '%ielts%'`)
  for (const r of s.rows) console.log('subject', r.slug, '|', r.name)
  await c.end()
}
void main()
