// lib/areaHubCore.ts
//
// Which area hub a tuition appears in (owner, 13 Oct 2026). PURE — no database,
// no server-only import — so the proxy, the hub pages, the posting form's hint,
// the report and the tests share one rule (scripts/test-area-hubs.ts).
//
// An area hub (/tuition-jobs/<city>/<area>) exists ONLY for an area in the
// curated Locations list (location_areas). jobs.area stays the plain text the
// poster saved and is never rewritten; this file only decides which hub that
// text belongs to:
//
//   1. the same area, however it was written — case, punctuation, a trailing
//      city ("DHA" = "DHA Lahore" in Lahore), a joining "-e-" ("Gulshan Iqbal" =
//      "Gulshan-e-Iqbal");
//   1b. a value staff said is the same as a curated area (Locations → "Same
//      as existing area", location_area_aliases): "Liaqatbad" = Liaqatabad;
//   2. a longer, descriptive value that clearly NAMES one curated area ("DHA
//      Phase 5", "Johar Town near Expo") → that area;
//   3. anything else — a school's name, a street address, an area not in
//      Locations yet — has NO area hub. Its tuitions are in the city hub, and
//      the address its old hub had sends visitors on (lib/areaHubRedirect).

import { areaWithoutCity } from './place'
import { slugify } from './slugs'

/** Every word, the joining "e" of "Gulshan-e-Iqbal" KEPT (positions matter
 *  for the whole-name rule below). */
const rawWords = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[’'`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

const words = (s: string): string[] =>
  rawWords(s)
    // "gulshan-e-iqbal" and "gulshan iqbal" are one area.
    .filter((w) => w !== 'e')

/** The comparison key of an area inside a city: its words, the trailing city dropped. */
export function areaKey(area: string | null | undefined, city: string | null | undefined): string {
  const a = (area ?? '').trim()
  if (!a) return ''
  return words(areaWithoutCity(a, city) || a).join(' ')
}

/** The hub address segment of a curated area: "DHA Lahore" in Lahore → "dha". */
export function areaHubSlug(curatedArea: string, city: string | null | undefined): string {
  return slugify(areaWithoutCity(curatedArea, city)) || slugify(curatedArea)
}

/** Address segments that are other pages of a city, never an area. */
export const RESERVED_HUB_SLUGS = new Set(['female', 'online'])

export type AreaHubHit = {
  /** The curated area, as written in Locations. */
  area: string
  /** exact = the same words; alias = staff said it is this area; contains = a
   *  longer value that names this area. */
  how: 'exact' | 'alias' | 'contains'
}

/** One city's approved aliases: areaKey(typed value) → the curated area's name. */
export type CityAliases = Record<string, string>

/**
 * The curated area this saved value belongs to, or null when it has no area
 * hub. `curated` is the city's own list — an unknown city passes [] and so
 * never has an area hub.
 */
export function resolveAreaHub(
  city: string | null | undefined,
  raw: string | null | undefined,
  curated: string[],
  aliases?: CityAliases | null,
  /** Every curated area name in EVERY city (owner, 17 Oct 2026): a merged
   *  short name never matches inside one of these longer names — "Johar"
   *  (Karachi) is not "Johar Town". Optional; without it only the
   *  "X-e-Y" rule applies. */
  knownAreas?: string[] | null,
): AreaHubHit | null {
  const key = areaKey(raw, city)
  if (!key) return null
  const text = valueText(raw ?? '', city)
  // An approved alias decides before anything else — but only for an area that
  // is still in the curated list.
  const aliased = aliases?.[key]
  if (aliased && curated.some((c) => c.toLowerCase() === aliased.toLowerCase())) return { area: aliased, how: 'alias' }
  const list = curated
    .map((area) => ({ area, key: areaKey(area, city) }))
    .filter((c) => c.key && !RESERVED_HUB_SLUGS.has(areaHubSlug(c.area, city)))
    // Two curated spellings of one area ("DHA", "DHA Lahore"): the shorter name stands.
    .sort((a, b) => a.area.length - b.area.length || a.area.localeCompare(b.area))

  const exact = list.find((c) => c.key === key)
  if (exact) return { area: exact.area, how: 'exact' }

  // A longer value that names a curated area as a whole run of words. The
  // longest name wins; two different areas of the same length is not a clear
  // match, unless one of them opens the value.
  const curatedHit = containsHit(text, list)
  if (curatedHit !== undefined) return curatedHit
  // Owner, 16 Oct 2026: a value that names a MERGED area counts as the area it
  // was merged into ("Lal Flats near Johar Morr" names Johar, merged into
  // Gulistan-e-Johar). A merge saves the retired name as an approved spelling,
  // so the approved spellings are searched the same way — but only after the
  // live curated names, which always decide first.
  if (!aliases) return null
  const live = new Map(curated.map((c) => [c.toLowerCase(), c]))
  const spelled = Object.entries(aliases)
    .map(([k, target]) => ({ area: live.get(target.toLowerCase()) ?? '', key: k }))
    .filter((c) => c.area && c.key)
  // A merged short name must also not sit inside a longer area name that this
  // city's list does not have (another city's "Johar Town").
  const longer = (knownAreas ?? []).map((n) => words(n)).filter((w) => w.length > 0)
  const listKeys = new Set(list.map((c) => c.key))
  return containsHit(text, spelled, longer.filter((w) => !listKeys.has(w.join(' ')))) ?? null
}

/** The value's words twice: with the joining "e" (`full`) and without it
 *  (`key`), and where each `key` word sits in `full`. */
type ValueText = { full: string[]; key: string[]; at: number[] }

function valueText(raw: string, city: string | null | undefined): ValueText {
  const a = raw.trim()
  const full = rawWords(areaWithoutCity(a, city) || a)
  const key: string[] = []
  const at: number[] = []
  full.forEach((w, i) => {
    if (w !== 'e') {
      key.push(w)
      at.push(i)
    }
  })
  return { full, key, at }
}

/** Every [start, end] (in `key` words) where `seq` appears as whole words. */
function occurrences(key: string[], seq: string[]): [number, number][] {
  const out: [number, number][] = []
  if (seq.length === 0) return out
  for (let i = 0; i + seq.length <= key.length; i++) {
    if (seq.every((w, k) => key[i + k] === w)) out.push([i, i + seq.length - 1])
  }
  return out
}

/**
 * Is this occurrence a WHOLE area name in the value (owner, 17 Oct 2026)?
 *   • not one half of an "X-e-Y" name: "Gulshan" in "Gulshan-e-Hadeed" or
 *     "Gulshan-e-Maymar Block 3", "Johar" in "Gulistan-e-Johar";
 *   • not inside a longer known area name (another city's "Johar Town").
 */
function wholeName(t: ValueText, [i, j]: [number, number], longer: string[][]): boolean {
  const pi = t.at[i]
  const pj = t.at[j]
  if (t.full[pj + 1] === 'e' && pj + 2 < t.full.length) return false
  if (t.full[pi - 1] === 'e' && pi - 2 >= 0) return false
  for (const l of longer) {
    if (l.length <= j - i + 1) continue
    if (occurrences(t.key, l).some(([a, b]) => a <= i && j <= b)) return false
  }
  return true
}

/** The longest name inside the value as a whole run of words. undefined = no
 *  name inside; null = names inside but no clear winner. */
function containsHit(t: ValueText, list: { area: string; key: string }[], longer: string[][] = []): AreaHubHit | null | undefined {
  const key = t.key.join(' ')
  // Whole words, and only where the name stands as a whole area name.
  const inside = list.filter((c) => occurrences(t.key, c.key.split(' ')).some((o) => wholeName(t, o, longer)))
  if (inside.length === 0) return undefined
  const longest = Math.max(...inside.map((c) => c.key.split(' ').length))
  const top = inside.filter((c) => c.key.split(' ').length === longest)
  // One name (two list rows of it: the shorter stands, as sorted) or two
  // spellings of ONE area are one answer.
  const one = (rows: typeof top) => new Set(rows.map((c) => c.key)).size === 1 || new Set(rows.map((c) => c.area.toLowerCase())).size === 1
  if (one(top)) return { area: top[0].area, how: 'contains' }
  const opening = top.filter((c) => key.startsWith(`${c.key} `))
  return opening.length > 0 && one(opening) ? { area: opening[0].area, how: 'contains' } : null
}

const SCHOOL_WORD = /\b(school|schools|college|academy|institute|university|lyceum|campus|montessori|educators|grammar|kindergarten|coaching|centre|center)\b/i

/** The value when it reads as a school or institute's name, not an area. */
export function schoolFromAreaValue(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().replace(/\s+/g, ' ')
  return v && SCHOOL_WORD.test(v) ? v : null
}

export type AreaStanding =
  | { kind: 'empty' }
  | { kind: 'listed'; area: string; how: AreaHubHit['how'] }
  /** Not in Locations: saved as typed, but no hub until an admin adds it. */
  | { kind: 'unlisted'; looksLikeSchool: boolean }

/** What the posting form tells staff about the area they typed. */
export function areaStanding(
  city: string | null | undefined,
  raw: string | null | undefined,
  curated: string[],
  aliases?: CityAliases | null,
): AreaStanding {
  if (!(raw ?? '').trim()) return { kind: 'empty' }
  const hit = resolveAreaHub(city, raw, curated, aliases)
  if (hit) return { kind: 'listed', area: hit.area, how: hit.how }
  return { kind: 'unlisted', looksLikeSchool: schoolFromAreaValue(raw) !== null }
}

export type AreaHub = { slug: string; label: string; count: number; areas: string[] }

/**
 * The area hubs of one city from its open tuitions' saved area values. `areas`
 * is every saved spelling in the hub (the list filter reads it); the label is
 * the curated name without the city. Busiest first.
 */
export function areaHubsFor(
  city: string,
  savedAreas: (string | null | undefined)[],
  curated: string[],
  aliases?: CityAliases | null,
  knownAreas?: string[] | null,
): AreaHub[] {
  const hubs = new Map<string, AreaHub>()
  const seen = new Map<string, AreaHubHit | null>()
  for (const saved of savedAreas) {
    if (!saved || !saved.trim()) continue
    if (!seen.has(saved)) seen.set(saved, resolveAreaHub(city, saved, curated, aliases, knownAreas))
    const hit = seen.get(saved)
    if (!hit) continue
    const slug = areaHubSlug(hit.area, city)
    if (!slug) continue
    const hub = hubs.get(slug) ?? { slug, label: areaWithoutCity(hit.area, city) || hit.area, count: 0, areas: [] }
    hub.count++
    if (!hub.areas.includes(saved)) hub.areas.push(saved)
    hubs.set(slug, hub)
  }
  return [...hubs.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/**
 * Where an address segment that is NOT a hub of this city leads, from the
 * segment alone: "dha-lahore" → "dha". Null when it names no curated area (the
 * page then looks the old value up — a school's name, a street address).
 */
export function hubSlugRedirect(city: string, segment: string, curated: string[], aliases?: CityAliases | null): string | null {
  if (RESERVED_HUB_SLUGS.has(segment)) return null
  const hit = resolveAreaHub(city, segment.replace(/-/g, ' '), curated, aliases)
  if (!hit) return null
  const slug = areaHubSlug(hit.area, city)
  return slug && slug !== segment ? slug : null
}
