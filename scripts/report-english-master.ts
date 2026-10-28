/**
 * scripts/report-english-master.ts — read-only (owner, 28 Oct 2026).
 * What taxonomy_master 4208 is, and how many open tuitions / listed tutors carry
 * each English master id. Nothing is written.
 *   npx tsx --env-file=.env.local scripts/report-english-master.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const m = await c.query(`select m.id, m.level_slug, m.subject_slug, l.name as level, l.legacy, m.is_core from taxonomy_master m join taxonomy_levels l on l.slug=m.level_slug where m.id=4208`)
  console.log('4208:', JSON.stringify(m.rows[0]))
  const e = await c.query(`select m.id, l.name as level, l.legacy,
     (select count(*) from job_subjects js join jobs j on j.id=js.job_id where js.master_id=m.id and j.status='open') as open_jobs,
     (select count(*) from tutor_subjects ts join tutor_directory d on d.id=ts.tutor_id where ts.master_id=m.id) as tutors
     from taxonomy_master m join taxonomy_levels l on l.slug=m.level_slug where m.subject_slug='english' order by l.legacy, m.id`)
  for (const r of e.rows) console.log(`  ${r.id} ${r.level} legacy=${r.legacy} open=${r.open_jobs} tutors=${r.tutors}`)
  const fn = await c.query(`select pg_get_functiondef('public.search_suggest'::regproc) as d`)
  const d = fn.rows[0].d as string
  const i = d.indexOf('tax_best')
  console.log(d.slice(Math.max(0, i - 200), i + 2500))
  await c.end()
}
void main()
