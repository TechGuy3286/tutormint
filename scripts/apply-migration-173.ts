/**
 * scripts/apply-migration-173.ts — applies
 * supabase/migrations/173_signup_funnel_templates_owner_name.sql (a counts-only
 * table + its server function, one widened CHECK, two message templates, and
 * the Owner's display name). One transaction; without --apply it rolls back.
 *   npx tsx --env-file=.env.local scripts/apply-migration-173.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/173_signup_funnel_templates_owner_name.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const policies = async () =>
    (
      await c.query(
        `select count(*)::int as n, md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) as fp
           from pg_policies where schemaname in ('public', 'storage') and tablename <> 'site_visit_counts'`,
      )
    ).rows[0] as { n: number; fp: string }
  const polBefore = await policies()
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query(sql) // idempotent: a second run must not fail
    const polAfter = await policies()
    console.log('other policies before/after:', polBefore.n, polAfter.n, '· unchanged:', polBefore.fp === polAfter.fp)
    if (polBefore.fp !== polAfter.fp) throw new Error('an existing policy changed')
    const t = await c.query(`select tablename, rowsecurity from pg_tables where schemaname='public' and tablename='site_visit_counts'`)
    const tpl = await c.query(`select key, title from admin_message_templates where key like 'documents_approved%' order by key`)
    const owner = await c.query(`select full_name from profiles where role='admin' and admin_role='owner'`)
    const grants = await c.query(
      `select grantee, privilege_type from information_schema.routine_privileges where routine_name='bump_site_visit' order by grantee`,
    )
    console.log('table:', JSON.stringify(t.rows))
    console.log('templates:', JSON.stringify(tpl.rows))
    console.log('owner name:', JSON.stringify(owner.rows))
    console.log('bump_site_visit grants:', JSON.stringify(grants.rows))
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'COMMITTED' : 'DRY RUN — rolled back')
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
