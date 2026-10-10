/**
 * scripts/report-avatar-defaults.ts — READ-ONLY.
 * Counts for the gender-based default avatar (lib/defaultAvatar) and the
 * job-type chip on Browse tutors:
 *   - listed tutors (tutor_directory) with a photo / male / female / neutral default
 *   - distinct gender values stored on tutor_profiles
 *   - listed tutors whose job_types / teaching_mode hold a value that is not in job_titles
 *   npx tsx --env-file=.env.local scripts/report-avatar-defaults.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { defaultAvatarKind } from '../lib/defaultAvatar'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()

  const { rows: cols } = await c.query(
    `select table_name from information_schema.columns where table_schema='public' and column_name='gender' order by 1`,
  )
  console.log('tables with a gender column:', cols.map((r: { table_name: string }) => r.table_name).join(', '))

  const { rows: genders } = await c.query(
    `select coalesce(gender,'(null)') as gender, count(*)::int as n from tutor_profiles group by 1 order by 2 desc`,
  )
  console.log('tutor_profiles.gender values:', JSON.stringify(genders))

  const { rows: listed } = await c.query(`select id, full_name, avatar_url, gender, teaching_mode, job_types from tutor_directory`)
  const counts = { photo: 0, male: 0, female: 0, neutral: 0 }
  for (const r of listed) {
    if (r.avatar_url) counts.photo++
    else counts[defaultAvatarKind(r.gender)]++
  }
  console.log(`listed tutors: ${listed.length}`, JSON.stringify(counts))

  const { rows: titles } = await c.query(`select name from job_titles`)
  const known = new Set(titles.map((t: { name: string }) => t.name))
  const odd = listed.filter((r: { teaching_mode: string | null; job_types: string[] | null }) => {
    const all = [...(r.job_types ?? []), ...(r.teaching_mode ? [r.teaching_mode] : [])]
    return all.some((v) => !known.has(v))
  })
  console.log(`listed tutors with a job-type value outside job_titles: ${odd.length}`)
  for (const r of odd) console.log('  ', r.full_name, '| teaching_mode =', JSON.stringify(r.teaching_mode), '| job_types =', JSON.stringify(r.job_types))

  const { rows: allOdd } = await c.query(
    `select p.full_name, tp.teaching_mode, tp.job_types
       from tutor_profiles tp join profiles p on p.id = tp.id
      where exists (select 1 from unnest(coalesce(tp.job_types,'{}') || case when tp.teaching_mode is null then '{}'::text[] else array[tp.teaching_mode] end) v
                     where v not in (select name from job_titles))`,
  )
  console.log(`ALL tutor_profiles rows with such a value: ${allOdd.length}`)
  for (const r of allOdd) console.log('  ', r.full_name, '|', JSON.stringify(r.teaching_mode), '|', JSON.stringify(r.job_types))

  const { rows: samia } = await c.query(
    `select p.id, p.full_name, p.role, p.admin_role, tp.teaching_mode, tp.job_types, tp.gender, p.avatar_url is not null as has_photo
       from profiles p left join tutor_profiles tp on tp.id = p.id where p.full_name ilike 'samia khan%'`,
  )
  console.log('Samia Khan:', JSON.stringify(samia))
  await c.end()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
