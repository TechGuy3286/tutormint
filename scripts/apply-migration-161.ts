/**
 * scripts/apply-migration-161.ts — applies supabase/migrations/161_applicant_forwards_avatar_rotation.sql.
 * Additive (three new staff-only tables + one message template), idempotent.
 * Runs in a transaction; without --apply it rolls back (dry run). Prints the
 * fingerprints of the existing data before and after so "nothing existing
 * changed" is visible.
 *   npx tsx --env-file=.env.local scripts/apply-migration-161.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/apply-migration-161.ts --apply
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/161_applicant_forwards_avatar_rotation.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (
      await c.query(
        `select (select count(*)::int from profiles) as profiles,
                (select md5(string_agg(id::text || coalesce(avatar_url,''), ',' order by id)) from profiles) as avatars,
                (select count(*)::int from jobs) as jobs,
                (select md5(string_agg(key || body, ',' order by key)) from admin_message_templates where key <> 'applicants_forward') as templates`,
      )
    ).rows[0]
  const before = await fp()
  await c.query('begin')
  try {
    await c.query(sql)
    const after = await fp()
    const { rows: tables } = await c.query(
      `select c.relname as table, c.relrowsecurity as rls,
              (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('applicant_forwards', 'applicant_forward_outcomes', 'avatar_rotations') order by 1`,
    )
    const { rows: tpl } = await c.query(`select key, title, length(body) as chars from admin_message_templates where key = 'applicants_forward'`)
    const same = JSON.stringify(before) === JSON.stringify(after)
    console.log('existing data unchanged:', same, JSON.stringify({ profiles: after.profiles, jobs: after.jobs }))
    console.log('new tables:', JSON.stringify(tables))
    console.log('template:', JSON.stringify(tpl))
    if (!same) throw new Error('existing data changed — rolling back')
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
