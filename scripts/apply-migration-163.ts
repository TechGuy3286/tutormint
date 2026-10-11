/**
 * scripts/apply-migration-163.ts — applies supabase/migrations/163_photo_crop_unmet_actions.sql.
 * Additive and idempotent. Runs in a transaction; without --apply it rolls back
 * (dry run). Prints fingerprints of the touched tables before and after so
 * "nothing existing changed" is visible.
 *   npx tsx --env-file=.env.local scripts/apply-migration-163.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/apply-migration-163.ts --apply
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/163_photo_crop_unmet_actions.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (
      await c.query(
        `select (select count(*)::int from avatar_rotations) as rotations,
                (select md5(coalesce(string_agg(user_id::text || rotation::text || original_url || coalesce(rotated_url,''), ',' order by user_id), '')) from avatar_rotations) as rotations_fp,
                (select count(*)::int from search_unmet) as unmet,
                (select md5(coalesce(string_agg(id::text || query || surface || coalesce(role,''), ',' order by id), '')) from search_unmet) as unmet_fp,
                (select count(*)::int from taxonomy_aliases) as aliases,
                (select md5(coalesce(string_agg(kind || slug || alias, ',' order by id), '')) from taxonomy_aliases) as aliases_fp,
                (select count(*)::int from admin_message_templates where key <> 'city_hiring_post') as templates,
                (select md5(coalesce(string_agg(key || body, ',' order by key), '')) from admin_message_templates where key <> 'city_hiring_post') as templates_fp`,
      )
    ).rows[0]
  const before = await fp()
  console.log('before:', JSON.stringify(before))
  await c.query('begin')
  try {
    await c.query(sql)
    const after = await fp()
    const same = JSON.stringify(before) === JSON.stringify(after)
    console.log('existing data unchanged:', same)
    const { rows: t } = await c.query(
      `select c.relname as table, c.relrowsecurity as rls, (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'search_unmet_done'`,
    )
    console.log('new table:', JSON.stringify(t))
    const { rows: tpl } = await c.query(`select key, body from admin_message_templates where key = 'city_hiring_post'`)
    console.log('template:', JSON.stringify(tpl))
    const { rows: chk } = await c.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname in ('taxonomy_aliases_kind_check','avatar_rotations_source_check') order by conname`)
    console.log('checks:', JSON.stringify(chk))
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
