/**
 * scripts/report-sitemap-areas.ts — READ ONLY (owner, 16 Oct 2026). Fetches
 * the live /sitemap-pages.xml and checks that no area hub in it is a retired
 * (merged or "not an area") area or a value marked "Not an area"; prints a
 * merged area's old hub address, if one exists, for the redirect check.
 *   npx tsx --env-file=.env.local scripts/report-sitemap-areas.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { areaHubSlug } from '../lib/areaHubCore'
import { citySegment } from '../lib/slugs'

async function main() {
  const res = await fetch('https://www.tutormint.org/sitemap-pages.xml', { headers: { 'User-Agent': 'TutorMint-link-check' } })
  const xml = await res.text()
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)
  console.log(`status ${res.status}, ${locs.length} urls, well-formed end: ${xml.trim().endsWith('</urlset>')}`)
  const inMap = new Set(locs)
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const retired = (
      await c.query(`select a.name, c.name city from location_areas a join location_cities c on c.id = a.city_id where a.removed_at is not null`)
    ).rows as { name: string; city: string }[]
    const live = new Set(
      ((await c.query(`select a.name, c.name city from location_areas a join location_cities c on c.id = a.city_id where a.removed_at is null`)).rows as { name: string; city: string }[]).map(
        (r) => `/tuition-jobs/${citySegment(r.city)}/${areaHubSlug(r.name, r.city)}`,
      ),
    )
    const ignored = (await c.query(`select raw, city from location_ignored where removed_at is null`)).rows as { raw: string; city: string }[]
    const path = (city: string, name: string) => `/tuition-jobs/${citySegment(city)}/${areaHubSlug(name, city)}`
    const badRetired = retired.map((r) => path(r.city, r.name)).filter((p) => inMap.has(p) && !live.has(p))
    const badIgnored = ignored.map((r) => path(r.city, r.raw)).filter((p) => inMap.has(p) && !live.has(p))
    console.log(`retired areas ${retired.length}; in sitemap: ${badRetired.length}`, badRetired.slice(0, 5))
    console.log(`not-an-area values ${ignored.length}; in sitemap: ${badIgnored.length}`, badIgnored.slice(0, 5))
    const merged = retired.map((r) => path(r.city, r.name)).filter((p) => !live.has(p))
    console.log('merged/retired hub addresses (sample):', merged.slice(0, 5).join(' '))
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
