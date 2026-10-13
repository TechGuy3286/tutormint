// lib/cityJobs.ts
//
// The "Tuition jobs in [City]" pages (owner, 6 Oct 2026, item 6): which cities,
// variants and areas have a page, read LIVE from the open tuitions so a page
// appears by itself at 3 open tuitions and goes noindex below that.
//
// Server-only. Anon may read open jobs, so the public client is enough.

import 'server-only'

import { unstable_cache } from 'next/cache'
import { createPublicClient } from '@/lib/supabase/public'
import { LANDING_TAG } from '@/lib/landing'
import { citySegment, cityFromSegment } from '@/lib/slugs'
import { slugify } from '@/lib/slugs'
import { pageAll } from '@/lib/pageAll'
import { ONLINE_JOB_TITLE } from '@/lib/jobTitlesCore'
import { areaHubSlug, areaHubsFor, resolveAreaHub, schoolFromAreaValue } from '@/lib/areaHubCore'
import { loadAreaAliases } from '@/lib/areaAliases'

/** A city page or variant is indexable (and in the sitemap) from this many open tuitions. */
export const CITY_PAGE_THRESHOLD = 3

// An AREA variant is built only from an area in the curated Locations list
// (owner, 13 Oct 2026 — lib/areaHubCore). `areas` is every saved spelling that
// belongs to the hub ("DHA", "DHA Lahore", "DHA Phase 5"): the list filter
// reads it, and no tuition's own saved text is changed.
export type CityVariant = { kind: 'female' | 'online' | 'area'; slug: string; label: string; count: number; area?: string; areas?: string[] }

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

/** The curated areas of every city (Locations), keyed by the lower-case city name. */
export async function curatedAreasByCity(): Promise<Map<string, string[]>> {
  const db = createPublicClient()
  const [{ data: cities }, areas] = await Promise.all([
    db.from('location_cities').select('id, name'),
    pageAll((from, to) => db.from('location_areas').select('id, name, city_id').is('removed_at', null).order('id').range(from, to)) as Promise<
      { name: string; city_id: number | string }[]
    >,
  ])
  const nameById = new Map((cities ?? []).map((c) => [String(c.id), String(c.name).toLowerCase()]))
  const out = new Map<string, string[]>()
  for (const a of areas) {
    const city = nameById.get(String(a.city_id))
    if (city) (out.get(city) ?? out.set(city, []).get(city)!).push(a.name)
  }
  return out
}

// Locations changes rarely: ten minutes, cleared with the landing cache.
const curatedCached = unstable_cache(
  async (): Promise<[string, string[]][]> => [...(await curatedAreasByCity()).entries()],
  ['curated-areas-by-city'],
  { revalidate: 600, tags: [LANDING_TAG] },
)

async function curatedMap(): Promise<Map<string, string[]>> {
  return new Map(await curatedCached())
}

/** Every city with at least one open tuition, with its variants. Sorted by count. */
export async function cityPages(): Promise<CityPage[]> {
  // LIVE, never cached: approving an area or an alias re-evaluates its hub at once.
  const [rows, curated, aliases] = await Promise.all([openRows(), curatedAreasByCity(), loadAreaAliases({ fresh: true })])
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
    // Area hubs: curated areas only, every saved spelling of one area in one hub.
    for (const hub of areaHubsFor(city, list.map((r) => r.area), curated.get(city.toLowerCase()) ?? [], aliases[city.toLowerCase()])) {
      variants.push({ kind: 'area', slug: hub.slug, label: hub.label, count: hub.count, area: hub.label, areas: hub.areas })
    }
    pages.push({ city, citySlug: citySegment(city), count: list.length, variants })
  }
  return pages.sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))
}

/** The city pages that clear the threshold — the sitemap and the link strips. */
export async function indexableCityPages(): Promise<CityPage[]> {
  return (await cityPages()).filter((p) => p.count >= CITY_PAGE_THRESHOLD)
}

/**
 * The same list for LINK BLOCKS (the footer, the "other cities" strip, a tuition
 * page's link to its area hub): cached for ten minutes and cleared with the
 * landing cache when a tuition opens or closes. A page's own index/noindex and
 * the sitemap read the live list above, never this.
 */
export const indexableCityPagesCached = unstable_cache(
  async (): Promise<CityPage[]> => indexableCityPages(),
  ['city-job-hubs'],
  { revalidate: 600, tags: [LANDING_TAG] },
)

/** The area hub for a tuition's own area, when that hub exists (3+ open posts). */
export async function areaHubFor(city: string | null, area: string | null): Promise<{ href: string; label: string } | null> {
  if (!city || !area) return null
  const cityKey = city.trim().toLowerCase()
  const hit = resolveAreaHub(city, area, (await curatedMap()).get(cityKey) ?? [], (await loadAreaAliases())[cityKey])
  if (!hit) return null
  const slug = areaHubSlug(hit.area, city)
  const page = (await indexableCityPagesCached()).find((p) => p.citySlug === citySegment(city))
  const v = page?.variants.find((x) => x.kind === 'area' && x.slug === slug && x.count >= CITY_PAGE_THRESHOLD)
  return page && v ? { href: cityPagePath(page.citySlug, v.slug), label: v.label } : null
}

/**
 * An address under a city that is NOT one of its hubs (owner, 13 Oct 2026): the
 * value a tuition in this city once saved as its area — a school's name, a
 * street address, an area that is not in Locations. Returns that value, or null
 * when no tuition (in any status) ever made this address, which is a real 404.
 * The page sends it to the school hub when one exists, else to the city hub.
 */
export async function retiredAreaValue(city: string, segment: string): Promise<{ value: string; school: string | null } | null> {
  const db = createPublicClient()
  const rows = (await pageAll((from, to) =>
    db.from('jobs').select('id, area').ilike('city', city).not('area', 'is', null).order('id').range(from, to),
  )) as { area: string | null }[]
  const value = rows.map((r) => (r.area ?? '').trim()).find((a) => a && slugify(a) === segment)
  return value ? { value, school: schoolFromAreaValue(value) } : null
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
