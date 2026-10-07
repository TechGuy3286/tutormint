/**
 * scripts/dataop-backfill-grade-subjects.ts — fill jobs.grade_subjects for
 * existing tuitions (owner, 7 Oct 2026). One-time, re-runnable.
 *
 * Each tuition's CURRENT job_subjects ids are grouped by each id's own grade
 * (taxonomy_master → taxonomy_levels.name), in the tuition's class_levels order
 * (lib/gradeSubjects groupIdsByGrade). So each grade keeps the tuition's current
 * subject list, and the union is exactly job_subjects — which this never
 * touches. Only grade_subjects is written, and only where it is NULL: no title,
 * URL, status or date changes (jobs has no update trigger).
 *
 *   npx tsx --env-file=.env.local scripts/dataop-backfill-grade-subjects.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/dataop-backfill-grade-subjects.ts --apply   # write
 */

// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { groupIdsByGrade, unionMasterIds } from '../lib/gradeSubjects'

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()

  const { rows: jobs } = await c.query(
    `select j.id, j.ref_id, j.public_slug, j.city, j.class_levels, j.class_level,
            coalesce((select array_agg(s.master_id order by s.master_id) from job_subjects s where s.job_id = j.id), '{}') as masters
       from jobs j
      where j.grade_subjects is null`,
  )
  const { rows: grades } = await c.query(
    `select m.id, l.name as grade from taxonomy_master m join taxonomy_levels l on l.slug = m.level_slug`,
  )
  const gradeOf = new Map<number, string>(grades.map((g: { id: number; grade: string }) => [Number(g.id), g.grade]))

  type Plan = { id: string; ref: string; slug: string; groups: ReturnType<typeof groupIdsByGrade> }
  const plan: Plan[] = []
  let skipped = 0
  for (const j of jobs) {
    const ids = (j.masters as number[]).map(Number)
    if (ids.length === 0) {
      skipped++
      continue
    }
    const order = (j.class_levels as string[] | null)?.length ? (j.class_levels as string[]) : j.class_level ? [j.class_level as string] : []
    const groups = groupIdsByGrade(ids, gradeOf, order)
    const union = unionMasterIds(groups)
    if (union.join(',') !== [...ids].sort((a, b) => a - b).join(',')) throw new Error(`union mismatch on ${j.ref_id}`)
    plan.push({ id: j.id, ref: j.ref_id, slug: `/tuitions/${String(j.city ?? '').toLowerCase().replace(/\s+/g, '-')}/${j.public_slug}`, groups })
  }

  console.log(`To backfill: ${plan.length} · without subjects (left NULL): ${skipped}`)
  const sample = plan.filter((p) => p.groups.length > 1).slice(0, 3).concat(plan.filter((p) => p.groups.length === 1).slice(0, 2))
  for (const p of sample) console.log(`  ${p.ref} ${p.slug} → ${p.groups.map((g) => `${g.grade}:[${g.masterIds.join(',')}]`).join(' ')}`)

  if (apply) {
    await c.query('begin')
    for (const p of plan) {
      await c.query(`update jobs set grade_subjects = $1::jsonb where id = $2 and grade_subjects is null`, [JSON.stringify(p.groups), p.id])
    }
    await c.query('commit')
    const { rows: after } = await c.query(`select count(*)::int n from jobs where grade_subjects is not null`)
    console.log(`Applied. Tuitions with per-grade subjects now: ${after[0].n}`)
  } else {
    console.log('Dry run — nothing written. Re-run with --apply.')
  }
  await c.end()
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
