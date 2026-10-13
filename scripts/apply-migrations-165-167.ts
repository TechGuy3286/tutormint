/**
 * scripts/apply-migrations-165-167.ts — applies, in ONE transaction:
 *   165_partner_full_rights.sql               (a Partner may write again)
 *   166_location_aliases.sql                  (area aliases, "not an area", rank_tutors area match, curated areas)
 *   167_search_synonyms_alerts_title_names.sql (search words, Notify me, blog title names)
 *
 * Without --apply it runs everything and ROLLS BACK, printing what would change.
 * No tuition, profile or member row is changed by any of the three.
 *   npx tsx --env-file=.env.local scripts/apply-migrations-165-167.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const FILES = ['165_partner_full_rights.sql', '166_location_aliases.sql', '167_search_synonyms_alerts_title_names.sql']

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const one = async (sql: string) => (await c.query(sql)).rows[0]
  const fp = async () =>
    one(`select
      (select count(*)::int from jobs) as jobs,
      (select md5(coalesce(string_agg(id::text || coalesce(area,'') || coalesce(city,'') || status, ',' order by id), '')) from jobs) as jobs_fp,
      (select count(*)::int from profiles) as profiles,
      (select md5(coalesce(string_agg(tutor_id::text || coalesce(area,'') || coalesce(city,''), ',' order by id), '')) from tutor_areas) as tutor_areas_fp,
      (select count(*)::int from taxonomy_master) as master,
      (select count(*)::int from taxonomy_subjects) as subjects`)
  const before = await fp()
  const areasBefore = (await one(`select count(*)::int as n from location_areas`)).n as number
  const wordsBefore = (await one(`select count(*)::int as n from taxonomy_aliases`)).n as number
  const ranked = async () => (await c.query(`select id from rank_tutors(p_city => 'Lahore', p_area => 'DHA Lahore', p_limit => 200)`)).rows.map((r: { id: string }) => r.id).join(',')
  const rankedBefore = await ranked()
  console.log('before:', JSON.stringify(before), '· curated areas', areasBefore, '· search words', wordsBefore)

  await c.query('begin')
  try {
    for (const f of FILES) {
      await c.query(readFileSync(`supabase/migrations/${f}`, 'utf8'))
      console.log('ran', f)
    }
    const after = await fp()
    const same = JSON.stringify(before) === JSON.stringify(after)
    console.log('tuitions, profiles, tutor areas, taxonomy rows unchanged:', same)
    if (!same) throw new Error('existing data changed — rolling back')

    const areasAfter = (await one(`select count(*)::int as n from location_areas`)).n as number
    console.log(`curated areas: ${areasBefore} → ${areasAfter} (${areasAfter - areasBefore} seeded; ${52 - (areasAfter - areasBefore)} of the 52 listed already existed)`)
    const seeded = await c.query(`select c.name as city, count(*)::int as n from location_areas a join location_cities c on c.id = a.city_id where a.id > (select coalesce(max(id), 0) from location_areas) - $1 group by 1 order by 1`, [areasAfter - areasBefore])
    console.log('seeded by city:', JSON.stringify(seeded.rows))
    const wordsAfter = (await one(`select count(*)::int as n from taxonomy_aliases`)).n as number
    console.log(`search words: ${wordsBefore} → ${wordsAfter}`)
    console.log('is_admin_writer excludes partner:', (await one(`select position('partner' in pg_get_functiondef('public.is_admin_writer()'::regprocedure)) > 0 as x`)).x)
    console.log('storage write policies still excluding the Partner:', (await one(`select count(*)::int as n from pg_policies where schemaname = 'storage' and (coalesce(qual,'') || coalesce(with_check,'')) like '%partner%'`)).n)
    console.log('storage policies in all:', (await one(`select count(*)::int as n from pg_policies where schemaname = 'storage'`)).n)
    console.log('rank_tutors uses area_same:', (await one(`select bool_and(position('area_same(' in pg_get_functiondef(p.oid)) > 0) as x from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'rank_tutors'`)).x)
    console.log('rank_tutors result for Lahore / DHA Lahore unchanged:', (await ranked()) === rankedBefore)
    console.log('rank_tutors grants:', JSON.stringify((await c.query(`select grantee, privilege_type from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'rank_tutors' order by 1`)).rows))
    console.log('area_same("Karachi","Liaqatabad","liaqatabad"):', (await one(`select public.area_same('Karachi', 'Liaqatabad', 'liaqatabad') as x`)).x)
    console.log('new tables:', JSON.stringify((await c.query(`select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('location_area_aliases', 'location_ignored', 'tutor_search_alerts') order by 1`)).rows))
    console.log('title_name columns:', (await one(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and column_name = 'title_name' and table_name in ('taxonomy_levels', 'taxonomy_subjects')`)).n)

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
