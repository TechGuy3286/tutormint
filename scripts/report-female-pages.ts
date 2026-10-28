/**
 * scripts/report-female-pages.ts — read only. Per city: open tuitions, open
 * tuitions on /tuition-jobs/<city>/female (lib/femaleJobsCore rule), and
 * whether that page is indexable (3+). Counts only.
 *
 *   npx tsx --env-file=.env.local scripts/report-female-pages.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { isFemaleJob, femalePageIndexable } from '../lib/femaleJobsCore'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    await c.query('begin read only')
    const { rows } = await c.query(`select city, gender_preference, title, description from jobs where status = 'open'`)
    const by = new Map<string, { city: string; open: number; female: number; byField: number; byWord: number }>()
    for (const r of rows as { city: string | null; gender_preference: string | null; title: string | null; description: string | null }[]) {
      const city = (r.city ?? '').trim()
      if (!city) continue
      const k = city.toLowerCase()
      const cur = by.get(k) ?? { city, open: 0, female: 0, byField: 0, byWord: 0 }
      cur.open++
      if (isFemaleJob(r)) {
        cur.female++
        if (r.gender_preference === 'female') cur.byField++
        else cur.byWord++
      }
      by.set(k, cur)
    }
    const list = [...by.values()].filter((x) => x.female > 0).sort((a, b) => b.female - a.female)
    console.log('city | open | female | by field | by word | female page')
    for (const x of list) console.log(`${x.city} | ${x.open} | ${x.female} | ${x.byField} | ${x.byWord} | ${femalePageIndexable(x.female) ? 'indexable' : 'noindex'}`)
    const cityOpen = [...by.values()].sort((a, b) => b.open - a.open).slice(0, 8).map((x) => `${x.city} ${x.open}`)
    console.log('busiest cities (open):', cityOpen.join(', '))
    await c.query('rollback')
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
