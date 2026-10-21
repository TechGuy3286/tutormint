/**
 * scripts/report-subject-limit.ts (owner, 21 Oct 2026) — READ ONLY.
 *
 * How many tutors have more than 15 distinct subjects (a subject counts once
 * however many levels it is taught at — lib/subjectLimitCore). Counts only: no
 * names, numbers or emails are printed.
 *
 *   npx tsx --env-file=.env.local scripts/report-subject-limit.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { SUBJECT_LIMIT, subjectKeysOfIds } from '../lib/subjectLimitCore'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const rows = (
      await c.query(`
        select ts.tutor_id, ts.master_id, s.name
          from tutor_subjects ts
          join profiles p on p.id = ts.tutor_id and p.role = 'tutor'
          left join taxonomy_master m on m.id = ts.master_id
          left join taxonomy_subjects s on s.slug = m.subject_slug`)
    ).rows as { tutor_id: string; master_id: number; name: string | null }[]
    const byTutor = new Map<string, { ids: number[]; names: Map<number, string | null> }>()
    for (const r of rows) {
      const t = byTutor.get(r.tutor_id) ?? { ids: [] as number[], names: new Map<number, string | null>() }
      t.ids.push(r.master_id)
      t.names.set(r.master_id, r.name)
      byTutor.set(r.tutor_id, t)
    }
    const sizes = [...byTutor.values()].map((t) => subjectKeysOfIds(t.ids, (id) => t.names.get(id)).size)
    const over = sizes.filter((n) => n > SUBJECT_LIMIT)
    console.log(`tutors with subjects: ${sizes.length}`)
    console.log(`over ${SUBJECT_LIMIT} subjects: ${over.length}`)
    console.log(`exactly ${SUBJECT_LIMIT}: ${sizes.filter((n) => n === SUBJECT_LIMIT).length}`)
    if (over.length) console.log(`largest: ${Math.max(...over)} subjects; median of those over: ${over.sort((a, b) => a - b)[Math.floor(over.length / 2)]}`)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
