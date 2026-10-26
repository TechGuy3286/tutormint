/**
 * scripts/report-subject-cap.ts — READ-ONLY. Tutors over the 15-subject limit,
 * counted with the limit's OWN rule (distinct display subjects —
 * lib/subjectLimitCore subjectKeysOfIds, with lib/subjectDisplay merges).
 * Prints ids and counts only.
 *   npx tsx --env-file=.env.local scripts/report-subject-cap.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { SUBJECT_LIMIT, subjectKeysOfIds } from '../lib/subjectLimitCore'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  const rows = (
    await c.query(`
      select ts.tutor_id, ts.master_id, s.name
        from tutor_subjects ts
        join taxonomy_master tm on tm.id = ts.master_id
        left join taxonomy_subjects s on s.slug = tm.subject_slug
        join profiles p on p.id = ts.tutor_id
       where p.role = 'tutor'`)
  ).rows as { tutor_id: string; master_id: number; name: string | null }[]
  await c.end()
  const byTutor = new Map<string, { ids: number[]; names: Map<number, string> }>()
  for (const r of rows) {
    const t = byTutor.get(r.tutor_id) ?? { ids: [] as number[], names: new Map<number, string>() }
    t.ids.push(r.master_id)
    if (r.name) t.names.set(r.master_id, r.name)
    byTutor.set(r.tutor_id, t)
  }
  const over = [...byTutor.entries()]
    .map(([id, t]) => ({ id, subjects: subjectKeysOfIds(t.ids, (m) => t.names.get(m)).size }))
    .filter((r) => r.subjects > SUBJECT_LIMIT)
    .sort((a, b) => b.subjects - a.subjects)
    .map((r) => ({ ...r, over_by: r.subjects - SUBJECT_LIMIT }))
  console.log(`tutors over the limit: ${over.length}`)
  console.table(over)
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
