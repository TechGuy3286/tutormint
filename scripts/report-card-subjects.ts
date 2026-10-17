/**
 * scripts/report-card-subjects.ts — READ-ONLY.
 * Facts for the tidy-tutor-card PR (owner, 17 Oct 2026):
 *   - where a tutor's displayed subjects come from (--name="Abdul Ahad"), by category
 *   - taxonomy subject names that look like near-duplicates of each other
 *   - subject values on tutor profiles that are not master subjects (values only)
 *   npx tsx --env-file=.env.local scripts/report-card-subjects.ts [--name="Abdul Ahad"]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { subjectDisplayKey } from '../lib/subjectDisplay'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()

  const name = process.argv.find((a) => a.startsWith('--name='))?.slice(7)
  if (name) {
    const { rows } = await c.query(
      `select p.id, tp.job_types, s.name as subject, l.name as level, cat.name as category, cat.no_grade
         from profiles p join tutor_profiles tp on tp.id = p.id
         join tutor_subjects ts on ts.tutor_id = p.id
         join taxonomy_master m on m.id = ts.master_id
         join taxonomy_levels l on l.slug = m.level_slug
         left join taxonomy_categories cat on cat.slug = l.category_slug
         left join taxonomy_subjects s on s.slug = m.subject_slug
        where p.full_name ilike $1 order by cat.name, s.name`,
      [name],
    )
    console.log(`subjects of ${name}: ${rows.length} rows`)
    const by = new Map<string, Set<string>>()
    for (const r of rows) {
      const k = `${r.category}${r.no_grade ? ' [no_grade]' : ''}`
      by.set(k, (by.get(k) ?? new Set()).add(r.subject ?? `(level) ${r.level}`))
    }
    for (const [k, v] of by) console.log(`  ${k}: ${[...v].join(' | ')}`)
    if (rows[0]) console.log('  job_types:', rows[0].job_types)
    const { rows: cols } = await c.query(
      `select tp.specialty_subjects, tp.specialty_list, tp.degrees, tp.class_levels
         from profiles p join tutor_profiles tp on tp.id = p.id where p.full_name ilike $1`,
      [name],
    ).catch(() => ({ rows: [] }))
    console.log('  free-text columns:', JSON.stringify(cols))
  }

  // Near-duplicate subject names (live, non-legacy levels only).
  const { rows: subs } = await c.query(
    `select distinct s.slug, s.name from taxonomy_subjects s
       join taxonomy_master m on m.subject_slug = s.slug
       join taxonomy_levels l on l.slug = m.level_slug
      where not coalesce(l.legacy,false) order by s.name`,
  )
  const groups = new Map<string, string[]>()
  for (const s of subs) {
    const k = subjectDisplayKey(s.name)
    groups.set(k, [...(groups.get(k) ?? []), s.name])
  }
  console.log('\nsubjects merged for display by the rule:')
  for (const [k, v] of groups) if (v.length > 1) console.log(`  ${k}: ${v.join(' | ')}`)

  // Loose near-duplicates the rule does NOT merge, for the report.
  const norm = (n: string) =>
    n.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|of|and|holy|studies|language|lit|literature)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const loose = new Map<string, string[]>()
  for (const s of subs) {
    const k = norm(s.name)
    loose.set(k, [...(loose.get(k) ?? []), s.name])
  }
  console.log('\nloose near-duplicates (same words once brackets/filler removed):')
  for (const [k, v] of loose) if (v.length > 1) console.log(`  ${k}: ${v.join(' | ')}`)

  // Subject values on profiles that are not master subjects.
  const { rows: master } = await c.query(`select lower(trim(name)) n from taxonomy_subjects`)
  const known = new Set(master.map((r: { n: string }) => r.n))
  const { rows: tutorCols } = await c.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='tutor_profiles'
        and (column_name ilike '%subject%' or column_name ilike '%specialty%')`,
  )
  console.log('\ntutor_profiles subject-like columns:', tutorCols.map((r: { column_name: string }) => r.column_name).join(', '))
  const counts = new Map<string, number>()
  const tutors = new Set<string>()
  for (const { column_name } of tutorCols) {
    const { rows } = await c.query(`select id, "${column_name}" v from tutor_profiles where "${column_name}" is not null`)
    for (const r of rows) {
      const vals: string[] = Array.isArray(r.v) ? r.v : typeof r.v === 'string' ? r.v.split(/[,;\n]/) : []
      for (const raw of vals) {
        const v = (typeof raw === "object" && raw ? JSON.stringify(raw) : String(raw)).trim()
        if (!v || known.has(v.toLowerCase())) continue
        counts.set(v, (counts.get(v) ?? 0) + 1)
        tutors.add(r.id)
      }
    }
  }
  // Admission Test Prep (no-grade) "subjects" that are school names, chosen by tutors.
  const { rows: schools } = await c.query(
    `select s.name, count(distinct ts.tutor_id)::int n from tutor_subjects ts
       join taxonomy_master m on m.id = ts.master_id
       join taxonomy_levels l on l.slug = m.level_slug
       join taxonomy_categories cat on cat.slug = l.category_slug
       join taxonomy_subjects s on s.slug = m.subject_slug
      where cat.no_grade group by s.name order by n desc`,
  )
  console.log('admission-test-prep (school) entries held by tutors:', JSON.stringify(schools))
  console.log(`\ntutor profiles with a non-master subject value: ${tutors.size}`)
  console.log('top 10 values:')
  for (const [v, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${n}  ${v}`)
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
