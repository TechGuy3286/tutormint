// lib/tutorAreaCities.ts
//
// The city behind each of a tutor's areas, for the ONE case the public views
// cannot answer (owner, 10 Oct 2026): the same area name saved under two
// different cities ("DHA" in Lahore and "DHA" in Karachi). tutor_directory and
// tutor_public_page return `areas` as plain names, and tutor_areas is readable
// only by its owner, so the cards could not tell the two apart.
//
// Read ONLY for a tutor whose area list repeats a name — nobody today — so a
// Browse window normally costs no extra query. Service role, city + area only.
// Tolerant like lib/memberGender: any failure returns the rows unchanged, and
// lib/place `distinctAreaLabels` then shows the name once.

type Row = { id: string; areas?: string[] | null; area_cities?: (string | null)[] | null }

const key = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** True when the list holds the same area name more than once. */
export function repeatsAreaName(areas: (string | null | undefined)[] | null | undefined): boolean {
  const names = (areas ?? []).map(key).filter(Boolean)
  return new Set(names).size < names.length
}

export async function withAreaCities<T extends Row>(rows: T[]): Promise<T[]> {
  const ids = rows.filter((r) => repeatsAreaName(r.areas)).map((r) => r.id)
  if (ids.length === 0) return rows
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient()
    if (!admin) return rows
    const { data, error } = await admin
      .from('tutor_areas')
      .select('tutor_id, city, area, created_at, id')
      .in('tutor_id', ids)
      .order('created_at')
      .order('id')
    if (error || !Array.isArray(data)) return rows
    const by = new Map<string, { area: string; city: string | null }[]>()
    for (const r of data as { tutor_id: string; city: string | null; area: string }[]) {
      const list = by.get(r.tutor_id) ?? []
      list.push({ area: r.area, city: r.city })
      by.set(r.tutor_id, list)
    }
    return rows.map((r) => {
      const pairs = by.get(r.id)
      if (!pairs || pairs.length === 0) return r
      return { ...r, areas: pairs.map((p) => p.area), area_cities: pairs.map((p) => p.city) }
    })
  } catch {
    return rows
  }
}
