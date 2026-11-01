/**
 * scripts/apply-migration-216.ts — applies supabase/migrations/216_number_first_social_links.sql.
 * One transaction; without --apply it rolls back. Runs the file twice (it is
 * re-runnable), then checks: the new job_contacts column exists and is empty,
 * job_contacts' other data is unchanged, exactly one social_links template
 * exists and no other template changed. Prints counts only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-216.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/216_number_first_social_links.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  try {
    const tpl = `select count(*)::int n, md5(string_agg(key || coalesce(body,''), '|' order by key)) h from admin_message_templates where key <> 'social_links'`
    const jc = `select count(*)::int n, md5(string_agg(job_id::text || coalesce(contact_phone,'') || coalesce(contact_whatsapp,''), '|' order by job_id)) h from job_contacts`
    const [t0, j0] = [(await c.query(tpl)).rows[0], (await c.query(jc)).rows[0]]
    await c.query(sql)
    await c.query(sql)
    const [t1, j1] = [(await c.query(tpl)).rows[0], (await c.query(jc)).rows[0]]
    const linked = (await c.query(`select count(*)::int n from job_contacts where parent_account_id is not null`)).rows[0].n
    const n = (await c.query(`select count(*)::int n from admin_message_templates where key = 'social_links'`)).rows[0].n
    console.log('social_links rows:', n, '· other templates unchanged:', t0.h === t1.h, `(${t1.n})`)
    console.log('job_contacts unchanged:', j0.h === j1.h, `(${j1.n}) · linked rows:`, linked)
    if (n !== 1) throw new Error('expected exactly one social_links template')
    if (t0.h !== t1.h || j0.h !== j1.h) throw new Error('existing rows changed')
    if (linked !== 0) throw new Error('expected no linked rows yet')
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
