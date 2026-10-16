/**
 * scripts/report-locations-followups.ts — READ ONLY (owner, 16 Oct 2026).
 * Hub counts for Gulistan-e-Johar, Gulshan-e-Iqbal and Askari-2, which saved
 * values resolve where, and the Karachi / Lahore areas whose hub name looks like
 * a short or partial name of a bigger area.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-locations-followups.ts
 */
import { createAdminClient } from '../lib/supabase/admin'
import { pageAll } from '../lib/pageAll'
import { cityPages, CITY_PAGE_THRESHOLD } from '../lib/cityJobs'
import { areaKey, resolveAreaHub } from '../lib/areaHubCore'
import { loadAreaAliases } from '../lib/areaAliases'
import { shortNameCandidates } from '../lib/areaMergeCore'

async function main() {
  const admin = createAdminClient()!
  const pages = await cityPages()
  for (const city of ['karachi', 'lahore']) {
    const p = pages.find((x) => x.citySlug === city)
    console.log(`\n== ${city} (${p?.count} open) hubs:`)
    for (const v of p?.variants ?? []) if (v.kind === 'area') console.log(`  ${v.slug}: ${v.count}${v.count >= CITY_PAGE_THRESHOLD ? '' : ' (below 3)'}  [${(v.areas ?? []).join(' | ')}]`)
  }
  const { data: cities } = await admin.from('location_cities').select('id, name')
  const cityName = new Map((cities ?? []).map((c) => [c.id as number, c.name as string]))
  const areas = (await pageAll((f, t) => admin.from('location_areas').select('id, name, city_id, removed_at, created_at').order('id').range(f, t))) as {
    id: number
    name: string
    city_id: number
    removed_at: string | null
    created_at: string | null
  }[]
  for (const n of ['gulshan', 'johar', 'gulshan-e-iqbal', 'gulistan-e-johar', 'askari']) {
    console.log(`\nareas like ${n}:`, areas.filter((a) => a.name.toLowerCase().includes(n.split('-')[0]) && /karachi|lahore/i.test(cityName.get(a.city_id) ?? '')).map((a) => `${a.id} ${a.name} (${cityName.get(a.city_id)}) ${a.removed_at ? 'RETIRED' : ''}`).join('; '))
  }
  const aliases = await loadAreaAliases({ fresh: true })
  console.log('\nkarachi aliases containing johar/gulshan/askari:', Object.entries(aliases['karachi'] ?? {}).filter(([k]) => /johar|gulshan|askari/.test(k)))

  const jobs = (await pageAll((f, t) => admin.from('jobs').select('job_tx_id, ref_id, city, area, status').eq('status', 'open').ilike('city', 'karachi').order('id').range(f, t))) as {
    ref_id: string
    area: string | null
  }[]
  const curated = areas.filter((a) => !a.removed_at && cityName.get(a.city_id) === 'Karachi').map((a) => a.name)
  for (const j of jobs) {
    const k = areaKey(j.area, 'Karachi')
    if (!/johar|gulshan|askari/.test(k)) continue
    console.log(`  ${j.ref_id}  "${j.area}" → ${resolveAreaHub('Karachi', j.area, curated, aliases['karachi'])?.area ?? 'NO HUB'}`)
  }

  console.log('\nshort-name candidates:')
  for (const city of ['Karachi', 'Lahore']) {
    const p = pages.find((x) => x.city.toLowerCase() === city.toLowerCase())
    const hubs = (p?.variants ?? []).filter((v) => v.kind === 'area').map((v) => ({ name: v.label, count: v.count }))
    const list = areas.filter((a) => !a.removed_at && cityName.get(a.city_id) === city).map((a) => a.name)
    for (const c of shortNameCandidates(city, hubs, list)) console.log(`  ${city}: ${c.short} (${c.shortCount} open) ~ ${c.longer} (${c.longerCount} open)`)
  }
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
