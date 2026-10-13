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
import { resolveAreaHub, type CityAliases } from '@/lib/areaHubCore'

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
