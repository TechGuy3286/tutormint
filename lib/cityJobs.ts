// lib/cityJobs.ts
//
// The "Tuition jobs in [City]" pages (owner, 6 Oct 2026, item 6): which cities,
// variants and areas have a page, read LIVE from the open tuitions so a page
// appears by itself at 3 open tuitions and goes noindex below that.
//
// Server-only. Anon may read open jobs, so the public client is enough.

import { memoize } from '@/lib/memoCache'
import 'server-only'

import { createPublicClient } from '@/lib/supabase/public'
import { LANDING_TAG } from '@/lib/landing'
import { citySegment, cityFromSegment } from '@/lib/slugs'
import { slugify } from '@/lib/slugs'
import { pageAll } from '@/lib/pageAll'
import { ONLINE_JOB_TITLE } from '@/lib/jobTitlesCore'
import { areaHubSlug, areaHubsFor, resolveAreaHub, schoolFromAreaValue } from '@/lib/areaHubCore'
import { loadAreaAliases } from '@/lib/areaAliases'
import { isFemaleJob } from '@/lib/femaleJobsCore'
import { knownCityForSegment } from '@/lib/crawlLinksCore'

/** A city VARIANT (female / online / area) is indexable (and in the sitemap) from this many open tuitions. */
export const CITY_PAGE_THRESHOLD = 3

/** The main city page is indexable (and in the sitemap) from ONE open tuition
 *  (owner, 16 Nov 2026 — "noindex until it has tuitions"); with none it is
 *  200 + noindex, "No tuitions here yet". */
export const CITY_MAIN_THRESHOLD = 1

// An AREA variant is built only from an area in the curated Locations list
// (owner, 13 Oct 2026 — lib/areaHubCore). `areas` is every saved spelling that
// belongs to the hub ("DHA", "DHA Lahore", "DHA Phase 5"): the list filter
// reads it, and no tuition's own saved text is changed.
export type CityVariant = { kind: 'female' | 'online' | 'area'; slug: string; label: string; count: number; area?: string; areas?: string[]; newestMs?: number }

/** newestMs = the newest real change of any open tuition on the page (posted,
 *  resumed, refreshed, moved to the top) — the sitemap's lastmod (16 Nov 2026). */
export type CityPage = { city: string; citySlug: string; count: number; variants: CityVariant[]; newestMs?: number }

type OpenRow = {
  city: string | null
  area: string | null
  gender_preference: string | null
  teaching_mode: string | null
  title: string | null
  description: string | null
  created_at?: string | null
  resumed_at?: string | null
  refreshed_at?: string | null
  bumped_at?: string | null
}

/** The newest real change of a set of open tuitions, as ms (0 when none). */
function newestChange(rows: OpenRow[]): number {
  let max = 0
  for (const r of rows) {
    for (const t of [r.created_at, r.resumed_at, r.refreshed_at, r.bumped_at]) {
      const ms = t ? new Date(t).getTime() : NaN
      if (Number.isFinite(ms) && ms > max) max = ms
    }
  }
  return max
}

async function openRows(): Promise<OpenRow[]> {
  const db = createPublicClient()
  const out: OpenRow[] = []
  // Page past the PostgREST max-rows cap.
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from('jobs')
      .select('city, area, gender_preference, teaching_mode, title, description, created_at, resumed_at, refreshed_at, bumped_at')
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
const curatedCached = memoize(
  async (): Promise<[string, string[]][]> => [...(await curatedAreasByCity()).entries()],
  ['curated-areas-by-city'],
  { revalidate: 120, tags: [LANDING_TAG] },
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
  // Every curated area name, all cities: a merged short name never matches
  // inside a longer area name (lib/areaHubCore, owner 17 Oct 2026).
  const known = [...curated.values()].flat()
  const pages: CityPage[] = []
  for (const list of byCity.values()) {
    // The most common spelling wins the display name ("Lahore" over "lahore").
    const spell = new Map<string, number>()
    for (const r of list) spell.set(cityName(r.city!), (spell.get(cityName(r.city!)) ?? 0) + 1)
    const city = [...spell.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
    const variants: CityVariant[] = []
    // lib/femaleJobsCore: the field, or the whole word "female" when no preference is set.
    const femaleRows = list.filter((r) => isFemaleJob(r))
    if (femaleRows.length > 0) variants.push({ kind: 'female', slug: 'female', label: `Female teaching jobs`, count: femaleRows.length, newestMs: newestChange(femaleRows) })
    const onlineRows = list.filter((r) => r.teaching_mode === ONLINE_JOB_TITLE)
    if (onlineRows.length > 0) variants.push({ kind: 'online', slug: 'online', label: `Online tuitions`, count: onlineRows.length, newestMs: newestChange(onlineRows) })
    // Area hubs: curated areas only, every saved spelling of one area in one hub.
    for (const hub of areaHubsFor(city, list.map((r) => r.area), curated.get(city.toLowerCase()) ?? [], aliases[city.toLowerCase()], known)) {
      const spellings = new Set((hub.areas ?? [hub.label]).map((a) => a.trim().toLowerCase()))
      const rows = list.filter((r) => spellings.has((r.area ?? '').trim().toLowerCase()))
      variants.push({ kind: 'area', slug: hub.slug, label: hub.label, count: hub.count, area: hub.label, areas: hub.areas, newestMs: newestChange(rows) })
    }
    pages.push({ city, citySlug: citySegment(city), count: list.length, variants, newestMs: newestChange(list) })
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
export const indexableCityPagesCached = memoize(
  async (): Promise<CityPage[]> => indexableCityPages(),
  ['city-job-hubs'],
  { revalidate: 120, tags: [LANDING_TAG] },
)

/** Every city page with its variants, cached ten minutes and cleared with the
 *  landing cache (a merge clears it at once). For search filters only — a
 *  page's own index/noindex and the sitemap read the live list. */
const cityPagesCached = memoize(async (): Promise<CityPage[]> => cityPages(), ['city-job-pages-all'], {
  revalidate: 120,
  tags: [LANDING_TAG],
})

/** Every city with at least one open tuition, cached — for LINK blocks that
 *  should reach every city page (owner, 16 Nov 2026: homepage, Browse, nearby). */
export async function cityPagesCachedForLinks(): Promise<CityPage[]> {
  return cityPagesCached()
}

/**
 * Every saved area spelling an AREA FILTER on a city should match (owner, 16 Oct
 * 2026): the spellings of the hub the area belongs to — areas merged into it,
 * longer values that name it, landmark splits — so a search filter counts the
 * same tuitions as the hub page. [] when the area has no hub.
 */
export async function areaFilterSpellings(city: string | null | undefined, area: string | null | undefined): Promise<string[]> {
  if (!city || !area) return []
  const cityKey = city.trim().toLowerCase()
  const cm = await curatedMap()
  const hit = resolveAreaHub(city, area, cm.get(cityKey) ?? [], (await loadAreaAliases())[cityKey], [...cm.values()].flat())
  if (!hit) return []
  const slug = areaHubSlug(hit.area, city)
  const page = (await cityPagesCached()).find((p) => p.citySlug === citySegment(city))
  return page?.variants.find((v) => v.kind === 'area' && v.slug === slug)?.areas ?? [hit.area]
}

/** The area hub for a tuition's own area, when that hub exists (3+ open posts). */
export async function areaHubFor(city: string | null, area: string | null): Promise<{ href: string; label: string } | null> {
  if (!city || !area) return null
  const cityKey = city.trim().toLowerCase()
  const cm = await curatedMap()
  const hit = resolveAreaHub(city, area, cm.get(cityKey) ?? [], (await loadAreaAliases())[cityKey], [...cm.values()].flat())
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

/**
 * Every KNOWN city (owner, 16 Nov 2026): the Locations list plus every city a
 * tuition was ever saved with, in any status. A known city's page never 404s —
 * with no open tuition it says "No tuitions here yet" (noindex).
 */
export async function knownCities(): Promise<string[]> {
  const db = createPublicClient()
  const [{ data: cities }, jobs] = await Promise.all([
    db.from('location_cities').select('name'),
    pageAll((from, to) => db.from('jobs').select('id, city').not('city', 'is', null).order('id').range(from, to)) as Promise<{ city: string | null }[]>,
  ])
  const out = new Map<string, string>()
  // A tuition's own spelling first, then Locations (which wins on a clash).
  for (const j of jobs) {
    const c = cityName(j.city ?? '')
    if (c) out.set(citySegment(c), c)
  }
  for (const c of cities ?? []) {
    const n = cityName(String(c.name ?? ''))
    if (n) out.set(citySegment(n), n)
  }
  return [...out.values()]
}

const knownCitiesCached = memoize(async (): Promise<string[]> => knownCities(), ['known-cities'], { revalidate: 300, tags: [LANDING_TAG] })

/** The known city for a URL segment, or null (a real 404). */
export async function knownCityBySlug(citySlug: string): Promise<string | null> {
  return knownCityForSegment(citySlug, await knownCitiesCached(), citySegment)
}

/** The city page — with no open tuition, an EMPTY page for a known city
 *  (count 0, no variants); null only for a city nobody ever used. */
export async function cityPageOrEmpty(citySlug: string): Promise<CityPage | null> {
  const page = await cityPageBySlug(citySlug)
  if (page) return page
  const city = await knownCityBySlug(citySlug)
  return city ? { city, citySlug: citySegment(city), count: 0, variants: [], newestMs: 0 } : null
}

/** The display name for a city segment, even when no page exists ("lahore" → "Lahore"). */
export function cityLabel(citySlug: string): string {
  return cityFromSegment(citySlug) ?? 'Pakistan'
}

export function cityPagePath(citySlug: string, variant?: string | null): string {
  return variant ? `/tuition-jobs/${citySlug}/${variant}` : `/tuition-jobs/${citySlug}`
}
