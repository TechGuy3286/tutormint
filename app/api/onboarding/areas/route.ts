import { NextResponse } from 'next/server'
import { pageAll } from '@/lib/pageAll'
import { createAdminClient } from '@/lib/supabase/admin'

// Demand-ordered areas for a city (PR106-G3c §9). Returns the city's areas with
// a demand score = (listed tutors with that area) + (open tuitions with that
// area), descending, name as the tiebreak — plus the full area list for the
// "More areas" search. Counts only; no personal data. Read via the service role
// so the counts are accurate regardless of RLS (areas/counts are public facts).

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const city = (new URL(request.url).searchParams.get('city') ?? '').trim()
  if (!city) return NextResponse.json({ areas: [], all: [] })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ areas: [], all: [] })

  const norm = (s: string) => s.trim().toLowerCase()

  // The curated areas for this city (the chip + search source).
  const { data: cityRow } = await admin.from('location_cities').select('id').ilike('name', city).maybeSingle()
  const { data: areaRows } = cityRow
    ? await admin.from('location_areas').select('name').eq('city_id', cityRow.id).order('name')
    : { data: [] as { name: string }[] }
  const all = (areaRows ?? []).map((r) => r.name as string)

  // Demand counts for this city.
  const [tutors, jobs] = await Promise.all([
    pageAll((from, to) => admin.from('tutor_profiles').select('id, area, city').ilike('city', city).not('area', 'is', null).order('id').range(from, to)),
    pageAll((from, to) => admin.from('jobs').select('id, area, city, status').ilike('city', city).eq('status', 'open').not('area', 'is', null).order('id').range(from, to)),
  ])
  const demand = new Map<string, number>()
  for (const row of [...(tutors ?? []), ...(jobs ?? [])]) {
    const a = norm((row.area as string) ?? '')
    if (a) demand.set(a, (demand.get(a) ?? 0) + 1)
  }

  const areas = all
    .map((name) => ({ name, demand: demand.get(norm(name)) ?? 0 }))
    .sort((x, y) => y.demand - x.demand || x.name.localeCompare(y.name))

  return NextResponse.json({ areas, all })
}
