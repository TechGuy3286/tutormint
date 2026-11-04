/** Read-only (4 Nov 2026): stored member-facing wording that still says "Settings". Keys only. */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const t = await c.query(`select key from admin_message_templates where body ilike '%settings%' or coalesce(subject,'') ilike '%settings%'`)
    console.log('templates:', t.rows.map((r: { key: string }) => r.key))
    const e = await c.query(`select variant from email_wordings where body ilike '%settings%' or subject ilike '%settings%'`)
    console.log('email wordings:', e.rows.map((r: { variant: string }) => r.variant))
    const g = await c.query(`select has_column_privilege('authenticated','public.profiles','avatar_pending_url','SELECT') sel, has_column_privilege('authenticated','public.profiles','avatar_pending_url','UPDATE') upd`)
    console.log('authenticated on avatar_pending_url:', g.rows[0])
  } finally { await c.end() }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
