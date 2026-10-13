/**
 * scripts/apply-migration-169.ts — applies
 * supabase/migrations/169_onboarding_email_staff_areas.sql (new columns and one
 * widened CHECK; no existing row changes). One transaction; without --apply it
 * rolls back.
 *   npx tsx --env-file=.env.local scripts/apply-migration-169.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/169_onboarding_email_staff_areas.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (
      await c.query(`select
        (select count(*)::int from profiles) as profiles,
        (select md5(coalesce(string_agg(id::text || coalesce(email,''), ',' order by id), '')) from profiles) as profiles_fp,
        (select count(*)::int from location_areas) as areas,
        (select md5(coalesce(string_agg(id::text || name || city_id::text, ',' order by id), '')) from location_areas) as areas_fp,
        (select count(*)::int from search_unmet_done) as done_rows`)
    ).rows[0]
  const before = await fp()
  console.log('before:', JSON.stringify(before))
  await c.query('begin')
  try {
    await c.query(sql)
    const after = await fp()
    const same = JSON.stringify(before) === JSON.stringify(after)
    console.log('existing data unchanged:', same)
    const { rows } = await c.query(`select
      (select count(*)::int from profiles where email_pending_confirm) as pending_true,
      (select count(*)::int from location_areas where created_by is not null or removed_at is not null) as areas_marked,
      (select pg_get_constraintdef(oid) from pg_constraint where conname = 'search_unmet_done_kind_check') as kind_check`)
    console.log('after:', JSON.stringify(rows[0]))
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
