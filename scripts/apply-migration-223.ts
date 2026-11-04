/**
 * scripts/apply-migration-223.ts — applies supabase/migrations/223_edit_profile_wording.sql.
 * One transaction; without --apply it rolls back. Prints template keys and counts only.
 *   npx tsx --env-file=.env.local scripts/apply-migration-223.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/223_edit_profile_wording.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query(sql)
    const { rows } = await c.query(`select key from admin_message_templates where key in ('cnic_unclear','video_rerecord','no_whatsapp') and body ilike '%settings%'`)
    assert.equal(rows.length, 0, 'a template still says Settings')
    const { rows: ok } = await c.query(`select key from admin_message_templates where body like '%Edit Profile%'`)
    console.log('templates naming Edit Profile:', ok.map((r: { key: string }) => r.key))
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'COMMITTED' : 'ROLLED BACK (dry run)')
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
