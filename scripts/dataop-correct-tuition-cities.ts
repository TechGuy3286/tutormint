/**
 * scripts/dataop-correct-tuition-cities.ts — one-time data correction (owner,
 * 16 Oct 2026): tuitions whose city is a misspelt or punctuated form of a
 * curated city ("faislabad", "Peshawar,") are set to the curated name.
 *
 * Without --apply it is a READ-ONLY dry run that lists every tuition whose city
 * is not exactly a curated city name and what it would become. With --apply it
 * updates jobs.city ONLY on rows with a clear correction, in one transaction,
 * with one admin_audit_log entry per tuition (actor "system: city correction",
 * before → after). A value with no clear curated match is listed and left as it
 * is. Nothing is deleted; no other column changes. The public slug never
 * changes; when the city's URL segment changes (a misspelling), the old address
 * 308-redirects to the new one (the tuition page's own rule) and Google is sent
 * one URL_UPDATED for the new address. Safe to run twice.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-correct-tuition-cities.ts [--apply]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { citySegment } from '../lib/slugs'
import { matchCuratedCity } from '../lib/staffAreaCore'
import { editDistance } from '../lib/locationCleanCore'

const SITE = 'https://www.tutormint.org'
const ACTOR = 'system: city correction'

/** The curated city a value names: punctuation/case first, then one clear
 *  near-spelling (edit distance ≤ 2, letters only, a unique closest city). */
function correction(cities: string[], raw: string): string | null {
  const exact = matchCuratedCity(cities, raw)
  if (exact) return exact
  const k = raw.toLowerCase().replace(/[^a-z]+/g, '')
  if (k.length < 5) return null
  const scored = cities
    .map((c) => ({ c, d: editDistance(k, c.toLowerCase().replace(/[^a-z]+/g, '')) }))
    .sort((a, b) => a.d - b.d)
  if (scored[0] && scored[0].d <= 2 && (!scored[1] || scored[1].d > scored[0].d)) return scored[0].c
  return null
}

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const cities = ((await c.query(`select name from location_cities order by name`)).rows as { name: string }[]).map((r) => r.name)
  const rows = (
    await c.query(
      `select id, ref_id, city, status, public_slug from jobs
        where city is not null and btrim(city) <> '' and city not in (select name from location_cities)
        order by created_at, id`,
    )
  ).rows as { id: string; ref_id: string | null; city: string; status: string; public_slug: string | null }[]

  const fix = rows.map((r) => ({ ...r, to: correction(cities, r.city) })).filter((r) => r.to && r.to !== r.city)
  const left = rows.filter((r) => !fix.some((f) => f.id === r.id))
  console.log(`Tuitions with a city not exactly in the list: ${rows.length}; with a clear correction: ${fix.length}; left as they are: ${left.length}`)
  for (const r of fix) {
    const moved = citySegment(r.city) !== citySegment(r.to)
    console.log(`  ${r.ref_id} [${r.status}] "${r.city}" → "${r.to}"${moved ? `  (URL segment ${citySegment(r.city)} → ${citySegment(r.to)}, old address redirects)` : '  (URL unchanged)'}`)
  }
  for (const r of left) console.log(`  left: ${r.ref_id} [${r.status}] "${r.city}"`)

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.')
    await c.end()
    return
  }
  await c.query('begin')
  try {
    for (const r of fix) {
      await c.query(`update jobs set city = $1 where id = $2 and city = $3`, [r.to, r.id, r.city])
      await c.query(
        `insert into admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail)
         values (null, $1, 'system', 'job.city_correct', 'job', $2, $3::jsonb)`,
        [ACTOR, r.id, JSON.stringify({ before: r.city, after: r.to, refId: r.ref_id, dataop: 'correct-tuition-cities' })],
      )
      if (r.public_slug && (r.status === 'open' || r.status === 'paused') && citySegment(r.city) !== citySegment(r.to)) {
        await c.query(`insert into indexing_queue (url, kind, priority) values ($1, 'URL_UPDATED', 1)`, [
          `${SITE}/tuitions/${citySegment(r.to)}/${r.public_slug}`,
        ])
      }
    }
    await c.query('commit')
    console.log(`\nAPPLIED: ${fix.length} tuitions corrected.`)
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
