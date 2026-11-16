/**
 * scripts/test-city-gaps-live.ts — READ ONLY (owner, 16 Nov 2026).
 *
 * Every city name ever used in a tuition (any status) must resolve on the live
 * site: /tuition-jobs/<city> and /tuition-jobs/<city>/female answer 200 or a
 * redirect (301/308), never 404. Writes nothing; prints no contact detail.
 *
 *   npm run test:citygaps:live                 (https://www.tutormint.org)
 *   CITY_GAPS_BASE_URL=http://localhost:3000 npm run test:citygaps:live
 */

// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { citySegment } from '../lib/slugs'

const BASE = (process.env.CITY_GAPS_BASE_URL ?? 'https://www.tutormint.org').replace(/\/$/, '')

async function status(path: string): Promise<number> {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(BASE + path, { redirect: 'manual', headers: { 'user-agent': 'TutorMint-link-check' }, signal: AbortSignal.timeout(20_000) })
      await r.body?.cancel()
      return r.status
    } catch {
      /* retry once */
    }
  }
  return 0
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  let cities: string[] = []
  try {
    const r = await c.query(`select distinct trim(city) city from jobs where city is not null and trim(city) <> ''`)
    cities = [...new Set(r.rows.map((x: { city: string }) => citySegment(x.city)).filter(Boolean))] as string[]
  } finally {
    await c.end()
  }
  const bad: string[] = []
  let ok = 0
  for (const seg of cities) {
    for (const path of [`/tuition-jobs/${seg}`, `/tuition-jobs/${seg}/female`]) {
      const s = await status(path)
      if (s === 200 || s === 301 || s === 308) ok++
      else bad.push(`${path} → ${s}`)
    }
  }
  console.log(`${cities.length} cities, ${ok} addresses resolved`)
  if (bad.length) {
    console.error('Not resolved:\n' + bad.join('\n'))
    process.exitCode = 1
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
