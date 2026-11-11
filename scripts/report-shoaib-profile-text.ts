/**
 * scripts/report-shoaib-profile-text.ts — READ-ONLY (owner, 11 Nov 2026).
 * Whether the stored headline / bio of the account named "Shoaib Hassan"
 * contains any banned term (yes/no only — never prints the text), and the
 * suspend / unsuspend history. Counts and dates only.
 *   npx tsx --env-file=.env.local scripts/report-shoaib-profile-text.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { detectAbuse } from '../lib/abuse/filter'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(`select p.id, tp.headline, tp.bio, p.full_name from profiles p left join tutor_profiles tp on tp.id = p.id where lower(trim(coalesce(p.full_name,''))) = 'shoaib hassan'`)
  for (const r of rows) {
    console.log(`stored headline flagged: ${detectAbuse(r.headline ?? '').length > 0}; stored bio flagged: ${detectAbuse(r.bio ?? '').length > 0}; name flagged: ${detectAbuse(r.full_name ?? '').length > 0}`)
    const ev = await c.query(`select event, created_at from user_activity_log where user_id = $1 and event in ('suspended','unsuspended','reinstated','profile_updated') order by created_at`, [r.id])
    console.log(ev.rows.map((e: { event: string; created_at: string }) => `${e.event} ${new Date(e.created_at).toISOString()}`).join('\n'))
    const au = await c.query(`select action, created_at from admin_audit_log where target_id = $1 order by created_at`, [r.id])
    console.log('audit:', au.rows.map((e: { action: string; created_at: string }) => `${e.action} ${new Date(e.created_at).toISOString()}`).join('; '))
  }
  await c.end()
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
