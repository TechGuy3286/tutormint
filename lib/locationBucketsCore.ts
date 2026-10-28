// lib/locationBucketsCore.ts
//
// PURE. The Locations clean-up (owner, 28 Oct 2026): every free-text location
// — an area staff added while posting, an area a tutor or parent typed, a city
// typed that is not in the list — goes into ONE of four buckets:
//
//   auto      the same place, surely: identical once normalised ("Liyari" =
//             Lyari, "Gulshan e Iqbal" = Gulshan-e-Iqbal, "krachi" = Karachi),
//             or one letter away on a long name, in the SAME city, with a
//             single best candidate. Applied by the clean-up script, each one
//             logged with an Undo.
//   suggest   probably the same place — shown pre-filled for one-click Approve.
//   new_area  reads as a real place with no match ("Valencia Town") —
//             suggested "Add as new area".
//   not_area  a phone number, an email, a street address, a school, "online",
//             nonsense — suggested "Not an area".
//
// Nothing here writes. The text on tuitions and profiles is never rewritten;
// an approval only records what that text MEANS (an alias, a retired staff
// area, an ignored value). Tested in scripts/test-location-buckets.ts.

import { areaKey, resolveAreaHub, type CityAliases } from './areaHubCore'
import { cleanAreaName, editDistance, looseKey, notAreaReason, similarity, type NotAreaReason, type Suggestion } from './locationCleanCore'
import { areaWithoutCity } from './place'

export type Bucket = 'auto' | 'suggest' | 'new_area' | 'not_area'

export type BucketResult = {
  bucket: Bucket
  /** auto / suggest: the existing area (or city) it is. new_area: the cleaned
   *  name to add. not_area: absent. */
  target?: string
  /** 0..1 — how sure. */
  confidence: number
  reason: string
  /** not_area only: what kind of thing it is. */
  notAreaReason?: NotAreaReason
}

export const BUCKET_LABEL: Record<Bucket, string> = {
  auto: 'Applied automatically',
  suggest: 'Suggested match',
  new_area: 'New area',
  not_area: 'Not an area',
}

/** The date written on every automatic merge. */
export const AUTO_CLEANUP_NOTE = 'automatic clean-up 28 Oct 2026'

// ---------------------------------------------------------------------------
// Normalising

/**
 * One word folded to how it SOUNDS in the common Roman-Urdu spellings, so two
 * spellings of one name meet: "liyari" → "lyari", "saddar" → "sadar",
 * "sheesh" → "shish", "noor" → "nur", "iqbal" → "ikbal".
 */
export function foldWord(w: string): string {
  let s = w.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (/\d/.test(s)) return s
  s = s
    .replace(/ck/g, 'k')
    .replace(/q/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/([bcdfghjklmnprstvwxz])iy(?=[aeiou])/g, '$1y')
    .replace(/(.)\1+/g, '$1')
  return s
}

/** A value's comparison key inside its city: areaKey (case, punctuation, a
 *  joining "-e-" and a trailing city set aside), each word folded. */
export function foldedKey(value: string | null | undefined, city: string | null | undefined): string {
  return areaKey(value, city)
    .split(' ')
    .filter(Boolean)
    .map(foldWord)
    .join(' ')
}

const tokensWithDigits = (key: string) => key.split(' ').filter((t) => /\d/.test(t)).sort().join(' ')
const singleLetters = (key: string) => key.split(' ').filter((t) => /^[a-z]$/.test(t)).sort().join(' ')

/** Two keys may only be called "one letter apart" when every block / sector
 *  number and single letter is the same — "F-10" is not "F-11", "Block A" is
 *  not "Block B". */
function sameMarkers(a: string, b: string): boolean {
  return tokensWithDigits(a) === tokensWithDigits(b) && singleLetters(a) === singleLetters(b)
}

// ---------------------------------------------------------------------------
// Not a place

/** Zero-width and direction marks pasted in from phones ("​Pakha"). */
export function stripInvisible(s: string | null | undefined): string {
  return (s ?? '').replace(/[​-‏⁠﻿]/g, '')
}

const PHONE = /(\+?92|0)?\s*3\d{2}[\s-]*\d{7}\b|\d[\d\s-]{8,}\d/
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i
const HOUSE = /\b(house|h\s*#|h\s*no|plot|flat|apartment|street|st\s*#|st\s*no|lane|gali|road\s*no|near|opposite|opp|behind|beside)\b|#/i

/** Why a value cannot be a place, or null. Phone numbers, emails, digit runs,
 *  house/street addresses, schools, "online" and nonsense. */
export function notPlace(raw: string, cities: string[] = []): { reason: NotAreaReason; why: string } | null {
  const v = stripInvisible(raw).trim().replace(/\s+/g, ' ')
  if (EMAIL.test(v)) return { reason: 'junk', why: 'An email address, not a place' }
  if (PHONE.test(v)) return { reason: 'junk', why: 'A phone number, not a place' }
  const digits = (v.match(/\d/g) ?? []).length
  const letters = (v.match(/[a-z]/gi) ?? []).length
  // A sector code ("E-11/1", "G-9", "F-10 Markaz") is a place, numbers and all.
  const sector = /^[a-z]\s*-?\s*\d{1,2}(\s*\/\s*\d{1,2})?(\s+[a-z ]+)?$/i.test(v)
  if (sector) return null
  if (digits > 0 && digits >= letters) return { reason: 'junk', why: 'Mostly numbers, not a place' }
  // A word with no vowel and 5+ letters ("xxxxx", "sdfgh") is typing, not a name.
  if (/\b[b-df-hj-np-tv-xz]{5,}\b/i.test(v)) return { reason: 'junk', why: 'Not a place name' }
  if (/(.)\1{3,}/i.test(v)) return { reason: 'junk', why: 'Not a place name' }
  if (HOUSE.test(v) && /\d/.test(v)) return { reason: 'address', why: 'Reads as a street address' }
  return notAreaReason(v, cities)
}

const PLACE_WORDS = /\b(town|colony|society|scheme|block|phase|sector|garden|gardens|city|park|abad|pura|nagar|chowk|bazar|bazaar|market|cantt|cantonment|village|goth|housing|enclave|estate|valley|heights|view|avenue|road|mohalla)\b/i

/** Looks like a place name: letters, one to four words. */
export function looksLikePlace(raw: string): boolean {
  const v = stripInvisible(raw).trim().replace(/\s+/g, ' ').replace(/[\s,.]+$/, '')
  if (!/^[a-z][a-z0-9 ,.'’\/\-()]*$/i.test(v)) return false
  const words = v.split(/[\s,\-]+/).filter(Boolean)
  // One to four words; up to seven when one of them is a place word
  // ("PIA Housing Society, Block D").
  if (words.length < 1 || words.length > (PLACE_WORDS.test(v) ? 7 : 4)) return false
  if (v.replace(/[^a-z]/gi, '').length < 3) return false
  return words.every((w) => /[aeiouy]/i.test(w) || /\d/.test(w) || w.length <= 3) || PLACE_WORDS.test(v)
}

// ---------------------------------------------------------------------------
// Areas

export type AreaBucketInput = {
  value: string
  city: string | null | undefined
  /** The live areas of the value's own city (not the value itself). */
  areas: string[]
  /** The city's approved spellings (areaKey(raw) → area name). */
  aliases?: CityAliases | null
  /** Every curated city name. */
  cities?: string[]
  /** False when the city is not in the list: nothing can be saved under it. */
  cityListed?: boolean
}

/** The bucket for one typed area. */
export function bucketArea(input: AreaBucketInput): BucketResult {
  const value = stripInvisible(input.value).trim()
  const city = input.city ?? ''
  const areas = input.areas ?? []
  const cities = input.cities ?? []

  const np = notPlace(value, cities)
  if (np && np.reason === 'junk') return { bucket: 'not_area', confidence: 0.95, reason: np.why, notAreaReason: np.reason }

  // 1. Identical once normalised (or an approved spelling).
  const hit = resolveAreaHub(city, value, areas, input.aliases ?? null)
  if (hit && (hit.how === 'exact' || hit.how === 'alias')) {
    return { bucket: 'auto', target: hit.area, confidence: 1, reason: hit.how === 'alias' ? 'An approved spelling of this area' : 'The same name, written differently' }
  }

  // 2. Identical once spelling variants are folded ("Liyari" = Lyari), or one
  //    letter away on a long name — with ONE best candidate.
  const fk = foldedKey(value, city)
  const cands = areas.map((a) => ({ area: a, fk: foldedKey(a, city) })).filter((c) => c.fk)
  if (fk) {
    const same = [...new Set(cands.filter((c) => c.fk === fk).map((c) => c.area))]
    if (same.length === 1) return { bucket: 'auto', target: same[0], confidence: 0.97, reason: 'The same name in another spelling' }
    if (same.length > 1) return { bucket: 'suggest', target: same[0], confidence: 0.7, reason: `Spelt like ${same.length} areas — check which` }
    const letters = fk.replace(/ /g, '')
    if (letters.length >= 6) {
      const near = cands.map((c) => ({ ...c, d: editDistance(fk, c.fk) })).sort((a, b) => a.d - b.d)
      const best = near[0]
      const rival = near.find((c) => c.area !== best?.area && c.d <= 2)
      if (best && best.d === 1 && !rival && sameMarkers(fk, best.fk)) {
        return { bucket: 'auto', target: best.area, confidence: 0.92, reason: 'One letter away from this area' }
      }
    }
  }

  // 3. Addresses, schools and "online" are not areas (checked before the looser
  //    matches, so "House 5 DHA Phase 5" is an address, not DHA).
  //    An address with no number that names an area ("Johar Town near Expo")
  //    is left to the suggestion below.
  if (np && !(np.reason === 'address' && hit && hit.how === 'contains' && !/\d/.test(value))) {
    return { bucket: 'not_area', confidence: 0.85, reason: np.why, notAreaReason: np.reason }
  }

  // 4. A longer value that names one area, or the same area once block /
  //    phase / "town" is set aside, or a close spelling: a suggestion.
  if (hit && hit.how === 'contains') return { bucket: 'suggest', target: hit.area, confidence: 0.8, reason: `Names ${areaWithoutCity(hit.area, city) || hit.area}` }
  const loose = looseKey(value, city)
  if (loose) {
    const same = [...new Set(areas.filter((a) => looseKey(a, city) === loose))]
    if (same.length === 1) return { bucket: 'suggest', target: same[0], confidence: 0.8, reason: 'The same area once block, phase or "town" is set aside' }
  }
  if (fk && fk.replace(/ /g, '').length >= 4) {
    const scored = cands.map((c) => ({ area: c.area, s: Math.max(similarity(fk, c.fk), similarity(areaKey(value, city), areaKey(c.area, city))) })).sort((a, b) => b.s - a.s)
    const best = scored[0]
    const second = scored.find((c) => c.area !== best?.area)?.s ?? 0
    if (best && best.s >= 0.74 && best.s - second >= 0.04) {
      return { bucket: 'suggest', target: best.area, confidence: Math.round(best.s * 100) / 100, reason: 'May be a spelling of this area — check' }
    }
  }

  // 5. A real-looking place with no match: a new area.
  if (looksLikePlace(areaWithoutCity(value, city) || value)) {
    const name = cleanAreaName(areaWithoutCity(value, city) || value)
    return {
      bucket: 'new_area',
      target: name,
      confidence: input.cityListed === false ? 0.4 : 0.6,
      reason: input.cityListed === false ? 'Not in the list — and its city is not in the list either' : 'Not in the list yet',
    }
  }
  return { bucket: 'not_area', confidence: 0.6, reason: 'Does not read as a place name', notAreaReason: 'junk' }
}

// ---------------------------------------------------------------------------
// Cities

/** Short forms people type for the big cities. */
export const CITY_SHORT: Record<string, string> = {
  lhr: 'Lahore',
  khi: 'Karachi',
  isb: 'Islamabad',
  isl: 'Islamabad',
  rwp: 'Rawalpindi',
  pindi: 'Rawalpindi',
  fsd: 'Faisalabad',
  lyp: 'Faisalabad',
  mux: 'Multan',
  psh: 'Peshawar',
  pew: 'Peshawar',
  grw: 'Gujranwala',
  skt: 'Sialkot',
  hyd: 'Hyderabad',
  qta: 'Quetta',
}

/** The bucket for one typed CITY that is not in the list. */
export function bucketCity(raw: string, cities: string[]): BucketResult {
  const value = (raw ?? '').trim()
  const np = notPlace(value)
  if (np && np.reason !== 'school') return { bucket: 'not_area', confidence: 0.9, reason: np.why.replace('area', 'city'), notAreaReason: np.reason }
  const k = foldedKey(value, null)
  const short = CITY_SHORT[k.replace(/ /g, '')]
  if (short && cities.some((c) => c.toLowerCase() === short.toLowerCase())) return { bucket: 'auto', target: short, confidence: 0.95, reason: 'A short form of this city' }
  const cands = cities.map((c) => ({ city: c, fk: foldedKey(c, null) }))
  const same = cands.filter((c) => c.fk === k)
  if (k && same.length === 1) return { bucket: 'auto', target: same[0].city, confidence: 0.97, reason: 'The same city in another spelling' }
  const letters = k.replace(/ /g, '')
  if (letters.length >= 5) {
    const near = cands.map((c) => ({ ...c, d: editDistance(k, c.fk) })).sort((a, b) => a.d - b.d)
    const best = near[0]
    const rival = near.find((c) => c.city !== best?.city && c.d <= 2)
    if (best && best.d === 1 && !rival) return { bucket: 'auto', target: best.city, confidence: 0.92, reason: 'One letter away from this city' }
    const sims = cands.map((c) => ({ city: c.city, s: similarity(k, c.fk) })).sort((a, b) => b.s - a.s)
    if (sims[0] && sims[0].s >= 0.75 && sims[0].s - (sims[1]?.s ?? 0) >= 0.04) {
      return { bucket: 'suggest', target: sims[0].city, confidence: Math.round(sims[0].s * 100) / 100, reason: 'May be a spelling of this city — check' }
    }
  }
  // "Lahore Cantt", "DHA Karachi": names one city.
  const words = ` ${k} `
  const named = cands.filter((c) => c.fk && words.includes(` ${c.fk} `))
  if (named.length === 1) return { bucket: 'suggest', target: named[0].city, confidence: 0.75, reason: `Names ${named[0].city}` }
  if (looksLikePlace(value)) return { bucket: 'new_area', target: cleanAreaName(value), confidence: 0.5, reason: 'A place not in the city list' }
  return { bucket: 'not_area', confidence: 0.6, reason: 'Does not read as a city name', notAreaReason: 'junk' }
}

// ---------------------------------------------------------------------------
// Automatic merges and their Undo

/**
 * What one automatic merge changed, stored on its Audit row so it can be undone
 * exactly:
 *   typed       a typed value now counts as an area: ONE new spelling row.
 *   staff_area  an area staff added is the same as another: a new spelling row
 *               (its name → the other area), the spellings that pointed at it
 *               moved over, and the added area RETIRED (removed_at).
 */
export type AutoMergeRecord = {
  kind: 'typed' | 'staff_area'
  city: string
  cityId: number
  value: string
  intoAreaId: number
  intoName: string
  confidence: number
  reason: string
  /** The spelling row the merge created. */
  aliasId: number
  /** staff_area: the added area that was retired. */
  retiredAreaId?: number
  /** staff_area: spelling rows that pointed at the retired area and were moved. */
  movedAliasIds?: number[]
  note: string
}

export type UndoStep =
  | { op: 'take_back_alias'; aliasId: number }
  | { op: 'move_aliases'; aliasIds: number[]; toAreaId: number }
  | { op: 'restore_area'; areaId: number }

/** The steps that put back exactly what one automatic merge changed. Pure. */
export function undoPlan(r: AutoMergeRecord): UndoStep[] {
  const steps: UndoStep[] = [{ op: 'take_back_alias', aliasId: r.aliasId }]
  if (r.kind === 'staff_area' && r.retiredAreaId) {
    if (r.movedAliasIds && r.movedAliasIds.length > 0) steps.push({ op: 'move_aliases', aliasIds: r.movedAliasIds, toAreaId: r.retiredAreaId })
    steps.push({ op: 'restore_area', areaId: r.retiredAreaId })
  }
  return steps
}

/** A tiny model of the Locations tables, to prove an Undo restores the state
 *  before the merge (scripts/test-location-buckets.ts). */
export type LocState = {
  areas: { id: number; name: string; removed: boolean }[]
  aliases: { id: number; raw: string; areaId: number; removed: boolean }[]
}

/** Apply a merge to the model, returning the new state and its record. */
export function modelMerge(
  s: LocState,
  m: { kind: 'typed' | 'staff_area'; value: string; intoAreaId: number; fromAreaId?: number },
  newAliasId: number,
): { state: LocState; record: AutoMergeRecord } {
  const state: LocState = { areas: s.areas.map((a) => ({ ...a })), aliases: s.aliases.map((a) => ({ ...a })) }
  state.aliases.push({ id: newAliasId, raw: m.value, areaId: m.intoAreaId, removed: false })
  const moved: number[] = []
  if (m.kind === 'staff_area' && m.fromAreaId != null) {
    for (const a of state.aliases) {
      if (a.id !== newAliasId && !a.removed && a.areaId === m.fromAreaId) {
        a.areaId = m.intoAreaId
        moved.push(a.id)
      }
    }
    const from = state.areas.find((a) => a.id === m.fromAreaId)
    if (from) from.removed = true
  }
  const into = state.areas.find((a) => a.id === m.intoAreaId)
  return {
    state,
    record: {
      kind: m.kind,
      city: '',
      cityId: 0,
      value: m.value,
      intoAreaId: m.intoAreaId,
      intoName: into?.name ?? '',
      confidence: 1,
      reason: '',
      aliasId: newAliasId,
      retiredAreaId: m.kind === 'staff_area' ? m.fromAreaId : undefined,
      movedAliasIds: moved,
      note: AUTO_CLEANUP_NOTE,
    },
  }
}

/** Apply an Undo plan to the model. A taken-back spelling row is stamped, not
 *  deleted — so the model keeps it, marked removed. */
export function modelUndo(s: LocState, steps: UndoStep[]): LocState {
  const state: LocState = { areas: s.areas.map((a) => ({ ...a })), aliases: s.aliases.map((a) => ({ ...a })) }
  for (const st of steps) {
    if (st.op === 'take_back_alias') {
      const a = state.aliases.find((x) => x.id === st.aliasId)
      if (a) a.removed = true
    } else if (st.op === 'move_aliases') {
      for (const a of state.aliases) if (st.aliasIds.includes(a.id)) a.areaId = st.toAreaId
    } else {
      const a = state.areas.find((x) => x.id === st.areaId)
      if (a) a.removed = false
    }
  }
  return state
}

/** The LIVE part of a model state — what readers see. */
export function liveView(s: LocState) {
  return {
    areas: s.areas.filter((a) => !a.removed).map((a) => `${a.id}:${a.name}`).sort(),
    aliases: s.aliases.filter((a) => !a.removed).map((a) => `${a.raw.toLowerCase()}→${a.areaId}`).sort(),
  }
}

/** One plain line for an automatic merge, for the report and the screen. */
export function autoMergeLine(r: Pick<AutoMergeRecord, 'kind' | 'value' | 'city' | 'intoName' | 'confidence'>): string {
  const what = r.kind === 'staff_area' ? 'Area added by staff' : 'Typed'
  return `${what} “${r.value}” (${r.city || 'no city'}) → ${r.intoName} · ${Math.round(r.confidence * 100)}% sure`
}

/**
 * A bucket as the review screen's suggestion: auto / suggest → "Same as <area>"
 * (pre-selected), new_area → "Add as new area" with the cleaned name, not_area
 * → "Not an area" with its kind. The screen's buttons and "Approve all" read
 * this.
 */
export function bucketSuggestion(r: BucketResult, value: string, city: string | null | undefined): Suggestion {
  if ((r.bucket === 'auto' || r.bucket === 'suggest') && r.target) {
    return { action: 'same', area: r.target, confidence: r.bucket === 'auto' ? 'high' : 'medium', why: r.reason }
  }
  if (r.bucket === 'not_area') return { action: 'not_area', reason: r.notAreaReason ?? 'junk', confidence: r.confidence >= 0.85 ? 'high' : 'medium', why: r.reason }
  return { action: 'add', name: r.target || cleanAreaName(areaWithoutCity(value, city) || value), confidence: 'low', why: r.reason }
}
