/**
 * scripts/report-area-hubs.ts — READ-ONLY (owner, 13 Oct 2026).
 *
 * Area hubs (/tuition-jobs/<city>/<area>) are built only from areas in the
 * curated Locations list. This lists, for every area value saved on an OPEN
 * tuition: the hub it used to make, and where it goes under the rule in
 * lib/areaHubCore — merged into a curated area's hub, sent to a school hub, or
 * sent to the city hub. Nothing is written; no tuition's saved text changes.
 *
 *   npx tsx --env-file=.env.local scripts/report-area-hubs.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { areaHubSlug, resolveAreaHub } from '../lib/areaHubCore'
import { schoolFromAreaValue } from '../lib/areaHubCore'
import { slugify, citySegment } from '../lib/slugs'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows: curated } = await c.query(`select c.name as city, a.name as area from location_areas a join location_cities c on c.id = a.city_id`)
  const byCity = new Map<string, string[]>()
  for (const r of curated as { city: string; area: string }[]) (byCity.get(r.city.toLowerCase()) ?? byCity.set(r.city.toLowerCase(), []).get(r.city.toLowerCase())!).push(r.area)

  const { rows } = await c.query(
    `select btrim(city) as city, btrim(area) as area, count(*)::int as n
       from jobs where status = 'open' and coalesce(btrim(area), '') <> '' and coalesce(btrim(city), '') <> ''
      group by 1, 2 order by 1, 3 desc, 2`,
  )
  type R = { city: string; area: string; n: number }
  const merged: string[] = []
  const toSchool: string[] = []
  const toCity: string[] = []
  const hubCount = new Map<string, number>()
  let oldHubs = 0
  const oldSlugCount = new Map<string, number>()
  for (const r of rows as R[]) {
    const k = `${citySegment(r.city)}/${slugify(r.area)}`
    oldSlugCount.set(k, (oldSlugCount.get(k) ?? 0) + r.n)
  }
  for (const n of oldSlugCount.values()) if (n >= 3) oldHubs++

  for (const r of rows as R[]) {
    const oldSlug = slugify(r.area)
    const oldN = oldSlugCount.get(`${citySegment(r.city)}/${oldSlug}`) ?? 0
    const hit = resolveAreaHub(r.city, r.area, byCity.get(r.city.toLowerCase()) ?? [])
    const tag = `${r.city} | "${r.area}" ×${r.n}${oldN >= 3 ? ' [had a hub]' : ''}`
    if (hit) {
      const slug = areaHubSlug(hit.area, r.city)
      const key = `${citySegment(r.city)}/${slug}`
      hubCount.set(key, (hubCount.get(key) ?? 0) + r.n)
      if (slug !== oldSlug || hit.how !== 'exact') merged.push(`${tag} -> /${key} ("${hit.area}", ${hit.how})`)
    } else {
      const school = schoolFromAreaValue(r.area)
      if (school) toSchool.push(`${tag} -> school "${school}" (school hub if it exists, else the city hub)`)
      else toCity.push(`${tag} -> /tuition-jobs/${citySegment(r.city)}`)
    }
  }
  console.log(`distinct open area values: ${rows.length}; area hubs (3+ open) before: ${oldHubs}; after: ${[...hubCount.values()].filter((n) => n >= 3).length}`)
  console.log(`\nMERGED / MAPPED into a curated area's hub (${merged.length}):`)
  for (const m of merged) console.log('  ' + m)
  console.log(`\nSCHOOL or institute name saved as the area (${toSchool.length}):`)
  for (const m of toSchool) console.log('  ' + m)
  console.log(`\nNot in Locations — no hub, city hub only (${toCity.length}):`)
  for (const m of toCity) console.log('  ' + m)
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
