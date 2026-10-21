/**
 * scripts/apply-migration-191.ts — applies supabase/migrations/191_follow_up_not_interested.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent), checks no profiles row changed, and prints which templates
 * were rewritten (keys only).
 *   npx tsx --env-file=.env.local scripts/apply-migration-191.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/191_follow_up_not_interested.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const fp = `select count(*)::int n, md5(string_agg(id::text || coalesce(full_name,'') || coalesce(role::text,''), ',' order by id)) h from profiles`
    const tpl = `select key, md5(body) h from admin_message_templates order by key`
    const before = (await c.query(fp)).rows[0]
    const tBefore = new Map((await c.query(tpl)).rows.map((r: { key: string; h: string }) => [r.key, r.h]))
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(fp)).rows[0]
    if (before.n !== after.n || before.h !== after.h) throw new Error('a profiles row changed')
    const changed = (await c.query(tpl)).rows.filter((r: { key: string; h: string }) => tBefore.get(r.key) !== r.h).map((r: { key: string }) => r.key)
    const t = (await c.query(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name='follow_up_dismissals'`)).rows[0]
    if (t.n !== 1) throw new Error('table missing')
    const bodies = (await c.query(`select key, body from admin_message_templates where key = any($1)`, [changed])).rows
    for (const b of bodies as { key: string; body: string }[]) {
      const lines = b.body.split('\n')
      if (!/^\{[a-z_]+\}$/.test(lines[lines.length - 1].trim())) throw new Error(`${b.key}: link not on its own last line`)
    }
    console.log(`profiles ${after.n}, unchanged; follow_up_dismissals ready; templates rewritten: ${changed.join(', ') || 'none'}`)
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED' : 'dry run — rolled back')
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
