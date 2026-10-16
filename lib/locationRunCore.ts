// lib/locationRunCore.ts
//
// PURE. "Review added areas" (owner, 16 Oct 2026): the rows the Owner's
// "Approve all suggestions" request wrote on 16 Oct at 13:56–13:57 PKT — the
// request timed out on screen but finished on the server, adding 120 areas,
// saving 142 typed spellings as "same as" an area and marking 44 values "Not
// an area". Some of the 120 are misspellings or not real areas, so each row is
// listed again with warnings and the Owner decides.
//
// The I/O half is lib/locationRunReview.ts; tests in
// scripts/test-location-run-review.ts.

import { areaKey } from './areaHubCore'
import { editDistance, notAreaReason, similarity } from './locationCleanCore'

/** The run's window (UTC). Every row it wrote is inside it. */
export const RUN_START = '2026-10-16T08:50:00Z'
export const RUN_END = '2026-10-16T09:05:00Z'
export const RUN_LABEL = '16 Oct 2026, 1:56 pm'

export type RunKind = 'area' | 'alias' | 'ignored'

export type AreaWarning = 'close_spelling' | 'city_in_name' | 'landmark_words' | 'too_short' | 'digits_only' | 'junk'

export const WARNING_LABEL: Record<AreaWarning, string> = {
  close_spelling: 'Close spelling to an existing area',
  city_in_name: 'Has a city name in it',
  landmark_words: 'Has block, street or landmark words',
  too_short: 'Under 3 letters',
  digits_only: 'Digits only',
  junk: 'Looks like junk or not a place',
}

const LANDMARK = /\b(block|blk|phase|ph|sector|sec|street|st|road|rd|lane|gali|near|opp|opposite|behind|chowk|stop|metro|station|market|bazar|bazaar|plaza|mall|park|masjid|mosque|hospital|school|college|house|plot|flat|floor|no|number|stage)\b/i

/** The other curated area whose spelling is close to this one, or null. The
 *  same name written twice ("Askari -2" / "Askari-2") is the closest of all:
 *  two rows in the list for one area. */
export function closeSpelling(name: string, city: string, others: string[]): string | null {
  const key = areaKey(name, city)
  if (key.length < 3) return null
  let best: { area: string; score: number } | null = null
  for (const o of others) {
    const k = areaKey(o, city)
    if (!k) continue
    const d = editDistance(key, k)
    const score = similarity(key, k)
    // A one-letter slip on a short name, or 80% the same letters on a longer one.
    const close = d === 0 || (Math.min(key.length, k.length) >= 4 && d <= 1) || (key.length >= 6 && score >= 0.8)
    if (close && (!best || score > best.score)) best = { area: o, score }
  }
  return best?.area ?? null
}

/** Every warning that applies to an area name, in a fixed order. */
export function areaWarnings(name: string, city: string, others: string[], cityNames: string[]): { warnings: AreaWarning[]; closeTo: string | null } {
  const v = (name ?? '').trim()
  const out: AreaWarning[] = []
  const closeTo = closeSpelling(v, city, others)
  if (closeTo) out.push('close_spelling')
  const low = ` ${v.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  if (cityNames.some((c) => c.trim() && low.includes(` ${c.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `))) out.push('city_in_name')
  if (LANDMARK.test(v)) out.push('landmark_words')
  const letters = v.replace(/[^a-z]/gi, '')
  if (/^[\d\s\-/#.,]+$/.test(v)) out.push('digits_only')
  else if (letters.length < 3) out.push('too_short')
  const not = notAreaReason(v, cityNames)
  if (not && (not.reason === 'junk' || not.reason === 'online' || not.reason === 'school') && !out.includes('digits_only') && !out.includes('too_short')) {
    out.push('junk')
  }
  return { warnings: out, closeTo }
}

// ------------------------------------------------------------- decisions

export type AreaDecision = 'keep' | 'merge' | 'split' | 'not_area'
export type AliasDecision = 'keep' | 'rematch'
export type IgnoredDecision = 'keep' | 'actually_area' | 'same_as'

export const DECISION_LABEL: Record<string, string> = {
  keep: 'Kept',
  merge: 'Merged',
  split: 'Split into area + landmark',
  not_area: 'Marked not an area',
  rematch: 'Match changed',
  actually_area: 'Made an area',
  same_as: 'Counted as an area',
}

export type RunAction =
  | { kind: 'area'; id: number; decision: 'keep' }
  | { kind: 'area'; id: number; decision: 'merge'; intoAreaId: number }
  | { kind: 'area'; id: number; decision: 'split'; intoAreaId: number; landmark: string }
  | { kind: 'area'; id: number; decision: 'not_area'; reason: 'school' | 'address' | 'online' | 'junk' }
  | { kind: 'alias'; id: number; decision: 'keep' }
  | { kind: 'alias'; id: number; decision: 'rematch'; areaId: number }
  | { kind: 'ignored'; id: number; decision: 'keep' }
  | { kind: 'ignored'; id: number; decision: 'actually_area'; name: string }
  | { kind: 'ignored'; id: number; decision: 'same_as'; areaId: number }

/** What is wrong with an action before it is sent, or null. */
export function runActionProblem(a: RunAction): string | null {
  if (a.kind === 'area' && (a.decision === 'merge' || a.decision === 'split')) {
    if (!a.intoAreaId) return 'Choose the area it is the same as.'
    if (a.intoAreaId === a.id) return 'Choose a different area.'
    if (a.decision === 'split' && !a.landmark.trim()) return 'Type the Block / landmark.'
    if (a.decision === 'split' && a.landmark.trim().length > 120) return 'Keep the Block / landmark under 120 characters.'
  }
  if (a.kind === 'alias' && a.decision === 'rematch' && !a.areaId) return 'Choose the area it is the same as.'
  if (a.kind === 'ignored' && a.decision === 'same_as' && !a.areaId) return 'Choose the area it is the same as.'
  if (a.kind === 'ignored' && a.decision === 'actually_area' && a.name.trim().length < 2) return 'Enter the area name.'
  return null
}

/** The confirm-box line: "Apply 12 changes?" */
export function confirmLine(n: number): string {
  return n === 1 ? 'Apply 1 change? Nothing is deleted, and the text on tuitions and profiles stays as it is.' : `Apply ${n} changes? Nothing is deleted, and the text on tuitions and profiles stays as it is.`
}

export const RUN_BATCH_MAX = 25
