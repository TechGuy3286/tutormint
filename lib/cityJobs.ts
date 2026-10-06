// lib/cityJobs.ts
//
// The "Tuition jobs in [City]" pages (owner, 6 Oct 2026, item 6): which cities,
// variants and areas have a page, read LIVE from the open tuitions so a page
// appears by itself at 3 open tuitions and goes noindex below that.
//
// Server-only. Anon may read open jobs, so the public client is enough.

import 'server-only'

import { createPublicClient } from '@/lib/supabase/public'
import { citySegment, cityFromSegment } from '@/lib/slugs'
import { slugify } from '@/lib/slugs'
import { ONLINE_JOB_TITLE } from '@/lib/jobTitlesCore'

/** A city page or variant is indexable (and in the sitemap) from this many open tuitions. */
export const CITY_PAGE_THRESHOLD = 3

export type CityVariant = { kind: 'female' | 'online' | 'area'; slug: string; label: string; count: number; area?: string }

export type CityPage = { city: string; citySlug: string; count: number; variants: CityVariant[] }

type OpenRow = { city: string | null; area: string | null; gender_preference: string | null; teaching_mode: string | null }

async function openRows(): Promise<OpenRow[]> {
  const db = createPublicClient()
  const out: OpenRow[] = []
  // Page past the PostgREST max-rows cap.
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from('jobs')
      .select('city, area, gender_preference, teaching_mode')
      .eq('status', 'open')
      .range(from, from + 999)
    const rows = (data ?? []) as OpenRow[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

const cityName = (c: string) => c.trim().replace(/\s+/g, ' ')

/** Every city with at least one open tuition, with its variants. Sorted by count. */
export async function cityPages(): Promise<CityPage[]> {
  const rows = await openRows()
  const byCity = new Map<string, OpenRow[]>()
  for (const r of rows) {
    const c = r.city?.trim()
    if (!c) continue
    const key = c.toLowerCase()
    ;(byCity.get(key) ?? byCity.set(key, []).get(key)!).push(r)
  }
  const pages: CityPage[] = []
  for (const list of byCity.values()) {
    // The most common spelling wins the display name ("Lahore" over "lahore").
    const spell = new Map<string, number>()
    for (const r of list) spell.set(cityName(r.city!), (spell.get(cityName(r.city!)) ?? 0) + 1)
    const city = [...spell.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
    const variants: CityVariant[] = []
    const female = list.filter((r) => r.gender_preference === 'female').length
    if (female > 0) variants.push({ kind: 'female', slug: 'female', label: `Female tutor required`, count: female })
    const online = list.filter((r) => r.teaching_mode === ONLINE_JOB_TITLE).length
    if (online > 0) variants.push({ kind: 'online', slug: 'online', label: `Online tuitions`, count: online })
    const areas = new Map<string, { area: string; n: number }>()
    for (const r of list) {
      const a = r.area?.trim()
      if (!a) continue
      const k = slugify(a)
      if (!k || k === 'female' || k === 'online') continue
      const cur = areas.get(k) ?? { area: a, n: 0 }
      cur.n++
      areas.set(k, cur)
    }
    for (const [slug, v] of [...areas.entries()].sort((a, b) => b[1].n - a[1].n || a[1].area.localeCompare(b[1].area))) {
      variants.push({ kind: 'area', slug, label: v.area, count: v.n, area: v.area })
    }
    pages.push({ city, citySlug: citySegment(city), count: list.length, variants })
  }
  return pages.sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))
}

/** The city pages that clear the threshold — the sitemap and the link strips. */
export async function indexableCityPages(): Promise<CityPage[]> {
  return (await cityPages()).filter((p) => p.count >= CITY_PAGE_THRESHOLD)
}

/** One city by its URL segment, or null when it has no open tuition at all. */
export async function cityPageBySlug(citySlug: string): Promise<CityPage | null> {
  const pages = await cityPages()
  return pages.find((p) => p.citySlug === citySlug) ?? null
}

/** The display name for a city segment, even when no page exists ("lahore" → "Lahore"). */
export function cityLabel(citySlug: string): string {
  return cityFromSegment(citySlug) ?? 'Pakistan'
}

export function cityPagePath(citySlug: string, variant?: string | null): string {
  return variant ? `/tuition-jobs/${citySlug}/${variant}` : `/tuition-jobs/${citySlug}`
}
