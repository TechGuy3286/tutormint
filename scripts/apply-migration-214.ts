/**
 * scripts/apply-migration-214.ts — applies supabase/migrations/214_profile_share_template.sql.
 * One transaction; without --apply it rolls back. Runs the file twice (it is
 * re-runnable), then checks that exactly one profile_share template exists and
 * nothing else in admin_message_templates changed. Prints counts only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-214.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/214_profile_share_template.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  try {
    const fp = `select count(*)::int n, md5(string_agg(key || coalesce(body,''), '|' order by key)) h from admin_message_templates where key <> 'profile_share'`
    const before = (await c.query(fp)).rows[0]
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(fp)).rows[0]
    const n = (await c.query(`select count(*)::int n from admin_message_templates where key = 'profile_share'`)).rows[0].n
    console.log('profile_share rows:', n, '· other templates unchanged:', before.h === after.h, `(${after.n})`)
    if (n !== 1) throw new Error('expected exactly one profile_share template')
    if (before.h !== after.h) throw new Error('other templates changed')
    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('DRY RUN — rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
