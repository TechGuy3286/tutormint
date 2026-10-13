// lib/tutorFacetsCore.ts
//
// PURE rules for the tutor browse filters (owner, 13 Oct 2026):
//
//   facetsFor()     the dropdown options that currently have at least one
//                   visible tutor, with counts — "Computer Science (6)". Choosing
//                   a city narrows areas, levels and subjects to that city;
//                   choosing a subject narrows the cities and areas.
//   matchesAlert()  whether a tutor answers a "Notify me" request.
//
// No database, no server-only import — tested in scripts/test-tutor-search.ts.

import { canonAreaList, type AreaAliasIndex } from './areaAliasCore'

/** One visible tutor, reduced to what the filters match on. */
export type IndexedTutor = { id: string; slug?: string | null; cities: string[]; areas: string[]; masterIds: number[] }

/** A taxonomy row: the picker's category › level › subject for one master id. */
export type TaxRow = { id: number; category: string; level: string; subject: string | null }

export type Option = { name: string; count: number }

export type TutorFacets = {
  total: number
  cities: Option[]
  /** Areas of the chosen city (curated names; an approved alias counts as its area). */
  areas: Option[]
  categories: Option[]
  /** category → its levels with tutors. */
  levels: Record<string, Option[]>
  /** `${category}|${level}` → its subjects with tutors. */
  subjects: Record<string, Option[]>
}

const low = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

const inCity = (t: IndexedTutor, city: string) => !city || t.cities.some((c) => low(c) === low(city))

function count(names: Iterable<string>, into: Map<string, { name: string; n: number }>) {
  const seen = new Set<string>()
  for (const raw of names) {
    const name = raw.trim()
    const k = name.toLowerCase()
    if (!name || seen.has(k)) continue
    seen.add(k)
    const cur = into.get(k) ?? { name, n: 0 }
    cur.n++
    into.set(k, cur)
  }
}

const options = (m: Map<string, { name: string; n: number }>, byName = false): Option[] =>
  [...m.values()]
    .map((v) => ({ name: v.name, count: v.n }))
    .sort((a, b) => (byName ? 0 : b.count - a.count) || a.name.localeCompare(b.name, undefined, { numeric: true }))

/**
 * The options for every dropdown under the current filters. `masterIds` is the
 * chosen subject (one id from the dropdown, or the ids a typed search means).
 * Each dropdown is counted under the OTHER filters, so it shows what choosing
 * an option would find.
 */
export function facetsFor(
  tutors: IndexedTutor[],
  tax: TaxRow[],
  filters: { city?: string | null; area?: string | null; masterIds?: number[] | null },
  aliases?: AreaAliasIndex | null,
  taxOrder?: { categories?: string[]; levels?: Record<string, string[]> },
): TutorFacets {
  const city = (filters.city ?? '').trim()
  const wanted = new Set(filters.masterIds ?? [])
  const hasSubject = (t: IndexedTutor) => wanted.size === 0 || t.masterIds.some((id) => wanted.has(id))
  // An approved alias counts as its curated area; the same area is counted once.
  const areasOf = (t: IndexedTutor) => canonAreaList(aliases ?? null, city ? [city] : t.cities, t.areas)
  const inArea = (t: IndexedTutor) => {
    const a = low(filters.area)
    if (!a) return true
    return areasOf(t).some((x) => low(x) === a)
  }

  // Cities: under the chosen subject.
  const cityMap = new Map<string, { name: string; n: number }>()
  for (const t of tutors) if (hasSubject(t)) count(t.cities, cityMap)

  // Areas: of the chosen city, under the chosen subject.
  const areaMap = new Map<string, { name: string; n: number }>()
  if (city) for (const t of tutors) if (inCity(t, city) && hasSubject(t)) count(areasOf(t), areaMap)

  // Levels and subjects: under the chosen city (and area).
  const byId = new Map(tax.map((r) => [r.id, r]))
  const cat = new Map<string, { name: string; n: number }>()
  const lev = new Map<string, Map<string, { name: string; n: number }>>()
  const sub = new Map<string, Map<string, { name: string; n: number }>>()
  let total = 0
  for (const t of tutors) {
    if (!inCity(t, city) || !inArea(t)) continue
    if (hasSubject(t)) total++
    const rows = t.masterIds.map((id) => byId.get(id)).filter((r): r is TaxRow => !!r)
    count(rows.map((r) => r.category), cat)
    for (const c of new Set(rows.map((r) => r.category))) {
      const m = lev.get(c) ?? lev.set(c, new Map()).get(c)!
      count(rows.filter((r) => r.category === c).map((r) => r.level), m)
    }
    for (const key of new Set(rows.filter((r) => r.subject).map((r) => `${r.category}|${r.level}`))) {
      const m = sub.get(key) ?? sub.set(key, new Map()).get(key)!
      count(rows.filter((r) => `${r.category}|${r.level}` === key && r.subject).map((r) => r.subject as string), m)
    }
  }

  // Categories and levels keep the taxonomy's own order when it is given.
  const ordered = (list: Option[], order?: string[]) =>
    order ? [...list].sort((a, b) => (order.indexOf(a.name) + 1 || 1e6) - (order.indexOf(b.name) + 1 || 1e6)) : list
  const levels: Record<string, Option[]> = {}
  for (const [c, m] of lev) levels[c] = ordered(options(m, true), taxOrder?.levels?.[c])
  const subjects: Record<string, Option[]> = {}
  for (const [k, m] of sub) subjects[k] = options(m, true)

  return {
    total,
    cities: options(cityMap),
    areas: options(areaMap, true),
    categories: ordered(options(cat, true), taxOrder?.categories),
    levels,
    subjects,
  }
}

/** "Computer Science (6)". */
export function optionLabel(o: Option): string {
  return `${o.name} (${o.count})`
}

// ------------------------------------------------------------- notify me ---

export const ALERT_DAYS = 60

export type AlertWant = { city: string | null; masterIds: number[]; knownTutorIds: string[] }

/**
 * Does this tutor answer the request? Same city (when one was searched) and at
 * least one of the searched subjects (when any were) — and not a tutor who was
 * already listed for it when the request was made.
 */
export function matchesAlert(want: AlertWant, tutor: IndexedTutor): boolean {
  if (want.knownTutorIds.includes(tutor.id)) return false
  if (want.city && !inCity(tutor, want.city)) return false
  if (want.masterIds.length > 0 && !tutor.masterIds.some((id) => want.masterIds.includes(id))) return false
  return !!want.city || want.masterIds.length > 0
}

/** Still open: not closed, not yet sent, and inside its 60 days. */
export function alertOpen(a: { closed_at: string | null; notified_at: string | null; expires_at: string }, now = Date.now()): boolean {
  return !a.closed_at && !a.notified_at && new Date(a.expires_at).getTime() > now
}

export type AlertContact = { channel: 'sms'; contact: string } | { channel: 'email'; contact: string }

/** The search in words: "O Level Physics tutor in Lahore". */
export function alertLabel(parts: { level?: string | null; subject?: string | null; city?: string | null; area?: string | null }): string {
  const what = [parts.level, parts.subject].filter(Boolean).join(' ').trim()
  const where = [parts.area, parts.city].filter(Boolean).join(', ')
  return `${what ? `${what} tutor` : 'Tutor'}${where ? ` in ${where}` : ''}`
}

/** The ONE message. No marketing, no price, no promise. */
export function alertSms(label: string, url: string): string {
  return `TutorMint: a tutor matching your search (${label}) has joined. See the profile: ${url} This is the only message for this request.`
}
