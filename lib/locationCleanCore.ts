// lib/locationCleanCore.ts
//
// PURE rules for the Locations clean-up screen (owner, 13 Oct 2026): what to
// SUGGEST for each area a member typed that is not in the curated list.
//
//   same      it is a curated area of the same city, written differently
//             ("Liaqatbad" → Liaqatabad, "DHA Phase 5" → DHA, "Block 13
//             Gulshan-e-Iqbal" → Gulshan-e-Iqbal)
//   not_area  a school's name, a street address, "online", or junk
//   add       none of the above — a new area, with a cleaned-up name
//
// A suggestion is only ever a suggestion: nothing is saved until staff approve
// it on the screen.

import { areaKey, resolveAreaHub, schoolFromAreaValue } from './areaHubCore'
import { areaWithoutCity } from './place'

export type NotAreaReason = 'school' | 'address' | 'online' | 'junk'
export type Confidence = 'high' | 'medium' | 'low'

export type Suggestion =
  | { action: 'same'; area: string; confidence: Confidence; why: string }
  | { action: 'not_area'; reason: NotAreaReason; confidence: Confidence; why: string }
  | { action: 'add'; name: string; confidence: Confidence; why: string }

export const NOT_AREA_REASONS: { id: NotAreaReason; label: string }[] = [
  { id: 'school', label: 'School or academy name' },
  { id: 'address', label: 'Street address' },
  { id: 'online', label: 'Online' },
  { id: 'junk', label: 'Not a place' },
]

const SMALL = new Set(['e', 'of', 'and', 'the'])
const UPPER = new Set(['dha', 'pechs', 'kaechs', 'pib', 'pia', 'wapda', 'ii', 'iii', 'iv', 'gor', 'nfc', 'eme', 'lda', 'cda', 'pwd', 'gt', 'uet', 'kda', 'smchs', 'dohs'])

/** "harbnspura " → "Harbnspura"; "dha phase 5" → "DHA Phase 5"; "gulshan-e-iqbal" → "Gulshan-e-Iqbal". */
export function cleanAreaName(raw: string | null | undefined): string {
  const v = (raw ?? '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/^[\s,.\-]+|[\s,.\-]+$/g, '')
  if (!v) return ''
  return v
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((part, i) => {
          const low = part.toLowerCase()
          if (!low) return part
          if (UPPER.has(low)) return low.toUpperCase()
          if (i > 0 && SMALL.has(low)) return low
          // "e-11", "g-9", "f8": a sector code stays upper-case.
          if (/^[a-z]\d{0,2}$/.test(low) && (i > 0 || /\d/.test(low) || word.includes('-'))) return low.toUpperCase()
          return low.charAt(0).toUpperCase() + low.slice(1)
        })
        .join('-'),
    )
    .join(' ')
}

/** Edit distance (Levenshtein), small strings only. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** 1 = the same letters; 0 = nothing in common. */
export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  return max === 0 ? 1 : 1 - editDistance(a, b) / max
}

const UNIT = /\b(block|blk|phase|ph|sector|sec|street|st|lane|gali|road no|house|plot|flat|floor|scheme)\s*(no\.?\s*)?#?\s*[a-z]?\d*[a-z]?\b/g
const KIND = /\b(town|colony|society|housing society|housing scheme|scheme|cooperative|co operative|chs|block|phase|sector|extension|ext)\b/g

/** The area's words with block / phase / sector parts and "town / colony /
 *  society" dropped, letters only — what two spellings of one area share. */
export function looseKey(area: string | null | undefined, city: string | null | undefined): string {
  const base = areaKey(area, city)
  return base
    .replace(UNIT, ' ')
    .replace(KIND, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const ADDRESS = /\b(house|plot|flat|apartment|apartments|floor|street|st\.?|lane|gali|near|opposite|opp\.?|behind|beside|adjacent|main road|road no|chowk no)\b|#|\d{2,}[\s,/-]+\d|\d+\s*[-/]\s*[a-z]\b/i
const ONLINE = /\b(online|zoom|skype|remote|whatsapp|google meet)\b/i
const JUNK = /^(n\/?a|none|nil|any|anywhere|all|all areas|any area|no|not sure|yes|same|city|area|home|test|other|others|-+|\.+)$/i

/** Does the value read as something that is not an area at all? */
export function notAreaReason(raw: string | null | undefined, cities: string[] = []): { reason: NotAreaReason; why: string } | null {
  const v = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!v || v.length < 3 || !/[a-z]/i.test(v) || JUNK.test(v)) return { reason: 'junk', why: 'Not a place name' }
  if (ONLINE.test(v)) return { reason: 'online', why: 'Says online' }
  if (schoolFromAreaValue(v)) return { reason: 'school', why: 'Reads as a school or academy name' }
  if (cities.some((c) => c.trim().toLowerCase() === v.toLowerCase())) return { reason: 'junk', why: 'A city name, not an area' }
  if (v.length > 45 || ADDRESS.test(v)) return { reason: 'address', why: 'Reads as a street address' }
  return null
}

/**
 * The suggestion for one typed value. `curated` is the curated areas of the
 * value's own city; an unknown city passes [] and can only be "not an area" or
 * a new area.
 */
export function suggestFor(raw: string, city: string | null | undefined, curated: string[], cities: string[] = []): Suggestion {
  // 1. The same area, written differently — the hub rule already knows these.
  const hit = resolveAreaHub(city, raw, curated)
  if (hit) {
    return {
      action: 'same',
      area: hit.area,
      confidence: 'high',
      why: hit.how === 'exact' ? 'The same name, written differently' : `Names ${areaWithoutCity(hit.area, city) || hit.area}`,
    }
  }

  // 2. Block / phase / sector and "town / colony / society" set aside.
  const loose = looseKey(raw, city)
  const list = curated.map((area) => ({ area, key: areaKey(area, city), loose: looseKey(area, city) })).filter((c) => c.key)
  if (loose) {
    const same = list.filter((c) => c.loose && c.loose === loose)
    if (new Set(same.map((c) => c.area)).size === 1) {
      return { action: 'same', area: same[0].area, confidence: 'high', why: 'The same area once block, phase or "town" is set aside' }
    }
  }

  // 3. Not an area at all. Checked before the spelling match, so a school named
  //    after an area is not folded into it.
  const not = notAreaReason(raw, cities)
  if (not && not.reason !== 'address') return { action: 'not_area', reason: not.reason, confidence: 'high', why: not.why }

  // 4. A spelling variant: "Liaqatbad" / Liaqatabad, "Azmir town" / Izmir Town.
  const key = areaKey(raw, city)
  let best: { area: string; score: number } | null = null
  let second = 0
  for (const c of list) {
    const score = Math.max(similarity(key, c.key), loose && c.loose ? similarity(loose, c.loose) : 0)
    if (!best || score > best.score) {
      second = best?.score ?? 0
      best = { area: c.area, score }
    } else if (score > second) second = score
  }
  if (best && key.length >= 4) {
    // Two curated areas equally close is not a clear match.
    const clear = best.score - second >= 0.04
    if (best.score >= 0.84 && clear) return { action: 'same', area: best.area, confidence: 'high', why: 'Looks like a spelling of this area' }
    if (best.score >= 0.74 && clear && !not) return { action: 'same', area: best.area, confidence: 'medium', why: 'May be a spelling of this area — check' }
  }

  if (not) return { action: 'not_area', reason: not.reason, confidence: 'medium', why: not.why }

  // 5. A new area.
  return { action: 'add', name: cleanAreaName(areaWithoutCity(raw, city) || raw), confidence: 'low', why: 'Not in the list yet' }
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'Sure', medium: 'Likely', low: 'Check' }

/** The suggestion in one plain line, for the review row. */
export function suggestionLine(s: Suggestion): string {
  if (s.action === 'same') return `Same as ${s.area}`
  if (s.action === 'not_area') return `Not an area — ${NOT_AREA_REASONS.find((r) => r.id === s.reason)?.label.toLowerCase() ?? s.reason}`
  return `Add as new area “${s.name}”`
}
