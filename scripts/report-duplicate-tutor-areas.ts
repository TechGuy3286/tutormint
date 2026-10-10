/**
 * scripts/report-duplicate-tutor-areas.ts — READ-ONLY.
 * Tutor areas saved more than once (owner, 10 Oct 2026, "DHA, DHA +1 more").
 *   - tutors with an EXACT duplicate tutor_areas row (same city + same area, case/space-insensitive)
 *   - tutors with the same area NAME under two different cities
 *   - optionally one tutor's rows:  --name="Zuha Qasim"
 *   npx tsx --env-file=.env.local scripts/report-duplicate-tutor-areas.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { distinctAreaLabels } from '../lib/place'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()

  const name = process.argv.find((a) => a.startsWith('--name='))?.slice(7)
  if (name) {
    const { rows } = await c.query(
      `select p.full_name, tp.city as main_city, tp.area as main_area, ta.city, ta.area, ta.created_at
         from profiles p join tutor_profiles tp on tp.id = p.id
         left join tutor_areas ta on ta.tutor_id = p.id
        where p.full_name ilike $1 order by p.id, ta.created_at, ta.id`,
      [name],
    )
    console.log(`rows for ${name}:`)
    for (const r of rows) console.log('  ', JSON.stringify(r))
  }

  const { rows: exact } = await c.query(
    `select ta.tutor_id, p.full_name, lower(btrim(ta.city)) as city, lower(btrim(ta.area)) as area, count(*)::int as n
       from tutor_areas ta join profiles p on p.id = ta.tutor_id
      group by 1,2,3,4 having count(*) > 1 order by 2`,
  )
  const exactTutors = new Set(exact.map((r: { tutor_id: string }) => r.tutor_id))
  console.log(`tutors with an exact duplicate area entry (same city + area): ${exactTutors.size}`)
  for (const r of exact) console.log('  ', r.full_name, '|', r.city, '|', r.area, '×', r.n)

  const { rows: cross } = await c.query(
    `select ta.tutor_id, p.full_name, lower(btrim(ta.area)) as area,
            array_agg(distinct btrim(ta.city) order by btrim(ta.city)) as cities,
            bool_or(d.id is not null) as listed
       from tutor_areas ta join profiles p on p.id = ta.tutor_id
       left join tutor_directory d on d.id = ta.tutor_id
      group by 1,2,3 having count(distinct lower(btrim(ta.city))) > 1 order by 2`,
  )
  const crossTutors = new Set(cross.map((r: { tutor_id: string }) => r.tutor_id))
  console.log(`tutors with the same area name under different cities: ${crossTutors.size}`)
  for (const r of cross) console.log('  ', r.full_name, '|', r.area, '|', JSON.stringify(r.cities), r.listed ? '| listed' : '')

  // Different saved values that read as the same label once the city is taken
  // off ("DHA" + "DHA Lahore"): what the card showed twice.
  const { rows: all } = await c.query(
    `select ta.tutor_id, p.full_name, tp.city as main_city, (d.id is not null) as listed,
            array_agg(ta.area order by ta.created_at, ta.id) as areas,
            array_agg(ta.city order by ta.created_at, ta.id) as cities
       from tutor_areas ta join profiles p on p.id = ta.tutor_id
       join tutor_profiles tp on tp.id = ta.tutor_id
       left join tutor_directory d on d.id = ta.tutor_id
      group by 1,2,3,4 order by 2`,
  )
  const same = all.filter(
    (r: { areas: string[]; cities: string[]; main_city: string | null }) =>
      distinctAreaLabels(r.areas, r.main_city, { cities: r.cities, areaCities: r.cities }).length < r.areas.length,
  )
  console.log(`tutors with areas saved: ${all.length}; with two saved areas that read as the same label: ${same.length}`)
  for (const r of same) console.log('  ', r.full_name, '|', JSON.stringify(r.areas), r.listed ? '| listed' : '| not listed')

  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
