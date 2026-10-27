/**
 * scripts/apply-migration-209.ts — applies supabase/migrations/209_hide_numbers_off.sql.
 * One transaction; without --apply it rolls back. Prints the switch value and
 * counts only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-209.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/209_hide_numbers_off.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  const audits = async () =>
    (await c.query(`select count(*)::int n from admin_audit_log where action = 'settings.hide_unconsented_numbers' and detail->>'via' = 'migration 209'`)).rows[0].n
  const value = async () => (await c.query(`select value from app_settings where key = 'privacy.hide_unconsented_numbers'`)).rows[0]?.value
  try {
    console.log(`before: switch ${await value()} · migration-209 audit rows ${await audits()}`)
    await c.query(sql)
    await c.query(sql)
    const v = await value()
    const a = await audits()
    console.log(`after (ran twice): switch ${v} · migration-209 audit rows ${a}`)
    if (v !== 'false') throw new Error('switch is not off')
    if (a !== 1) throw new Error('expected exactly one audit row')
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
