// lib/staffAreaCore.ts
//
// What the staff "Post a tuition" form says about the area being typed (owner,
// 13 Oct 2026). PURE — no I/O (scripts/test-staff-areas.ts).
//
// Staff may type any area. When it is not a curated area or one of its accepted
// spellings, the form offers two things and blocks nothing:
//
//   "Did you mean <closest>?"         a close match in the SAME city, if any
//   "Add '<cleaned name>' as new area" saves it to the curated list at once
//
// The cleaned name is the typed text in proper case with extra spaces removed.
// A typo is corrected ONLY when a near-identical curated name exists — and then
// there is nothing to add: the form offers that name alone.

import { cleanAreaName, editDistance, similarity } from '@/lib/locationCleanCore'
import { areaKey, resolveAreaHub, type CityAliases } from '@/lib/areaHubCore'

/** At or above this the curated name is worth offering as "Did you mean". */
export const CLOSE_MATCH = 0.7

/** Two adjacent letters swapped ("Gulbreg" / "Gulberg"). */
function isTransposition(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const diff: number[] = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i)
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]
}

/** The typed text is the curated name with a slip of the finger: one letter
 *  wrong, missing or extra, or two neighbouring letters swapped. Names of four
 *  letters or fewer are never "corrected" (too easy to be a different place). */
export function nearIdentical(typed: string, curated: string): boolean {
  if (curated.length <= 4 || typed === curated) return false
  return editDistance(typed, curated) <= 1 || isTransposition(typed, curated)
}

export type StaffAreaAdvice =
  | { kind: 'empty' }
  /** A curated area, or a spelling that already counts as one. */
  | { kind: 'listed'; area: string; exact: boolean }
  | {
      kind: 'new'
      /** The closest curated area in this city, when one is close. */
      didYouMean: string | null
      /** What "Add as new area" would save — null when the typed text is a
       *  near-identical curated name (use that name; nothing to add). */
      addName: string | null
    }

const low = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

export function staffAreaAdvice(
  city: string | null | undefined,
  typed: string | null | undefined,
  curated: string[],
  aliases?: CityAliases | null,
): StaffAreaAdvice {
  const raw = (typed ?? '').trim()
  if (!raw) return { kind: 'empty' }

  const exact = curated.find((a) => low(a) === low(raw))
  if (exact) return { kind: 'listed', area: exact, exact: true }
  const hit = resolveAreaHub(city, raw, curated, aliases)
  if (hit && (hit.how === 'exact' || hit.how === 'alias')) return { kind: 'listed', area: hit.area, exact: false }

  const cleaned = cleanAreaName(raw).slice(0, 80)
  let best: { name: string; score: number } | null = null
  for (const a of curated) {
    const score = similarity(low(a), low(cleaned))
    if (!best || score > best.score) best = { name: a, score }
  }
  // A longer text that names a curated area ("DHA Phase 5" → DHA) is offered too.
  const contains = hit ? hit.area : null

  const slip = curated.find((a) => nearIdentical(low(cleaned), low(a)))
  if (slip) return { kind: 'new', didYouMean: slip, addName: null }
  const didYouMean = best && best.score >= CLOSE_MATCH ? best.name : contains
  return { kind: 'new', didYouMean, addName: cleaned.length >= 2 ? cleaned : null }
}

/** "Added by Aqsa Mughal, 13 Oct 2026" — the line Admin → Locations shows. */
export function addedByLine(name: string | null | undefined, dateText: string | null | undefined): string {
  return `Added by ${(name ?? '').trim() || 'staff'}${dateText ? `, ${dateText}` : ''}`
}

// ---------------------------------------------------------------------------
// Area + Block / landmark (owner, 16 Oct 2026).
//
// Staff often type an area with a block, sector or landmark around it —
// "Block 1 Clifton", "Federal B Area Block 16", "Saddar Near Taj Complex",
// "Near Chowk Gul Muhammad Lyari". When the text NAMES one curated area of the
// city (the same rule as the area hubs, lib/areaHubCore resolveAreaHub), the
// form takes that area and moves the rest into "Block / landmark", shown as
// "Clifton (Block 1)". "Add as new area" is offered only when there is no
// curated match. Pure; tested in scripts/test-area-landmark.ts.

export type AreaSplit = { area: string; landmark: string }

const normWords = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[’'`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w && w !== 'e')

/**
 * The curated area the typed text names, and what is left over as the block /
 * landmark — or null when the text is exactly a curated area (nothing to split)
 * or names none.
 */
export function splitAreaLandmark(
  city: string | null | undefined,
  typed: string | null | undefined,
  curated: string[],
  aliases?: CityAliases | null,
): AreaSplit | null {
  const raw = (typed ?? '').trim()
  if (!raw) return null
  const hit = resolveAreaHub(city, raw, curated, aliases)
  if (!hit || hit.how !== 'contains') return null
  // The curated area's words, without the city ("DHA Lahore" in Lahore → dha).
  const target = areaKey(hit.area, city).split(' ').filter(Boolean)
  if (target.length === 0) return null
  // Pieces of the typed text, each with its normalised words.
  const pieces = raw.split(/[\s,]+/).filter(Boolean)
  const flat: { piece: number; word: string }[] = []
  pieces.forEach((p, i) => normWords(p).forEach((w) => flat.push({ piece: i, word: w })))
  let start = -1
  for (let i = 0; i + target.length <= flat.length; i++) {
    if (target.every((w, j) => flat[i + j].word === w)) {
      start = i
      break
    }
  }
  if (start < 0) return null
  const used = new Set(flat.slice(start, start + target.length).map((f) => f.piece))
  // A trailing city name ("Clifton Block 1 Karachi") is not a landmark.
  const cityWords = new Set(normWords(city ?? ''))
  const rest = pieces
    .filter((_, i) => !used.has(i))
    .filter((p, i, arr) => !(i === arr.length - 1 && normWords(p).length > 0 && normWords(p).every((w) => cityWords.has(w))))
    .join(' ')
    .replace(/\s+-\s*/g, '-')
    .replace(/^[\s,.\-–—:;]+|[\s,.\-–—:;]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!rest) return null
  return { area: hit.area, landmark: rest.slice(0, 120) }
}

/** "Clifton (Block 1)" — the area with its block / landmark, for display. */
export function areaWithLandmark(area: string | null | undefined, landmark: string | null | undefined): string {
  const a = (area ?? '').trim()
  const l = (landmark ?? '').trim()
  if (!a) return l
  return l ? `${a} (${l})` : a
}

/**
 * The curated city a typed or stored value names — case, spaces and
 * punctuation ignored ("Peshawar," → Peshawar, "LAHORE" → Lahore) — or null.
 * Staff tuitions accept only these (owner, 16 Oct 2026). A misspelling
 * ("faislabad") is NOT matched here: staff pick from the list, and existing
 * rows were corrected by a reviewed data step.
 */
export function matchCuratedCity(cities: string[], raw: string | null | undefined): string | null {
  const k = (raw ?? '').toLowerCase().replace(/[^a-z]+/g, '')
  if (!k) return null
  return cities.find((c) => c.toLowerCase().replace(/[^a-z]+/g, '') === k) ?? null
}
