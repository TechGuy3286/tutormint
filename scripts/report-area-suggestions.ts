/**
 * scripts/report-area-suggestions.ts — READ-ONLY. The suggestions Admin →
 * Locations shows for areas staff added while posting (owner, 16 Oct 2026):
 * "same as <curated area>" + the Block / landmark, and how many tuitions each
 * would give the landmark. The same rule as lib/staffAreas staffAreaSuggestions.
 *   npx tsx --env-file=.env.local scripts/report-area-suggestions.ts
 */
import { createClient } from '@supabase/supabase-js'
import { splitAreaLandmark } from '../lib/staffAreaCore'

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: all } = await db.from('location_areas').select('id, name, city_id, created_by, removed_at, location_cities(name)').is('removed_at', null)
  const rows = (all ?? []) as { id: number; name: string; city_id: number; created_by: string | null; location_cities: { name: string } | { name: string }[] }[]
  const cityOf = (r: (typeof rows)[number]) => (Array.isArray(r.location_cities) ? r.location_cities[0]?.name : r.location_cities?.name) ?? ''
  const added = rows.filter((r) => r.created_by)
  console.log(`Areas added by staff (live): ${added.length}`)
  let n = 0
  for (const a of added) {
    const curated = rows.filter((r) => !r.created_by && r.city_id === a.city_id).map((r) => r.name)
    const s = splitAreaLandmark(cityOf(a), a.name, curated)
    if (!s) {
      console.log(`  no suggestion: "${a.name}" (${cityOf(a)})`)
      continue
    }
    const { count } = await db.from('jobs').select('id', { count: 'exact', head: true }).ilike('city', cityOf(a)).ilike('area', a.name)
    n++
    console.log(`  SUGGEST "${a.name}" (${cityOf(a)}) → same as ${s.area}, landmark "${s.landmark}" · ${count ?? 0} tuitions`)
  }
  console.log(`Suggestions: ${n}`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
