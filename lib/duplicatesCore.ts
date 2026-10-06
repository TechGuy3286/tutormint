// lib/duplicatesCore.ts
//
// PURE rules for duplicate tuitions (owner, 6 Oct 2026). No database, no
// server-only import — shared by the post-time check, the tuition page's
// safety net, the admin Duplicates view, the merge data-op and the tests.
//
// Two tuitions are REPEATS of each other when they share
//   • the same full combination: city + area + level/grade set + subject set
//     + gender preference + budget band, or
//   • the same title (normalised: lower-case, collapsed spaces) — but ONLY when
//     the area (and city) also match (owner, 6 Oct 2026, item 17). A generic
//     title such as "Home Tutor Required | Grade 6" posted in two different
//     areas is two different tuitions, never a repeat.
// A pair matched only by the combination, where the titles describe DIFFERENT
// jobs (the first "|" segment — "Coordinator Required" vs "Primary Teacher
// Required"), is NOT merged; it is listed instead.

export type DuplicateFacts = {
  id: string
  title: string | null
  city: string | null
  area: string | null
  classLevels: string[] | null
  classLevel?: string | null
  masterIds: number[]
  genderPreference: string | null
  budgetPkr: number | null
  budgetMinPkr: number | null
  budgetMaxPkr: number | null
  createdAt: string
}

export const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

export function budgetBand(f: Pick<DuplicateFacts, 'budgetPkr' | 'budgetMinPkr' | 'budgetMaxPkr'>): string {
  if (f.budgetMinPkr != null || f.budgetMaxPkr != null) return `${f.budgetMinPkr ?? ''}-${f.budgetMaxPkr ?? ''}`
  return String(f.budgetPkr ?? '')
}

/** The full-combination key. Empty when there is nothing to compare on. */
export function comboKey(f: DuplicateFacts): string {
  const levels = (f.classLevels && f.classLevels.length > 0 ? f.classLevels : f.classLevel ? [f.classLevel] : []).map(norm).sort()
  const masters = [...f.masterIds].sort((a, b) => a - b)
  if (masters.length === 0 && levels.length === 0) return ''
  return [norm(f.city), norm(f.area), levels.join('|'), masters.join(','), norm(f.genderPreference) || 'any', budgetBand(f)].join('#')
}

/** Same city AND same area (normalised). Two empty areas in one city match. */
export function samePlace(a: Pick<DuplicateFacts, 'city' | 'area'>, b: Pick<DuplicateFacts, 'city' | 'area'>): boolean {
  return norm(a.city) === norm(b.city) && norm(a.area) === norm(b.area)
}

export function titleKey(f: Pick<DuplicateFacts, 'title'>): string {
  return norm(f.title)
}

/** "Coordinator Required | Karachi" → "coordinator required": the job the title describes. */
export function titleJobSegment(title: string | null | undefined): string {
  return norm((title ?? '').split('|')[0])
}

export type DuplicateReason = 'same title' | 'same combination'

/** How two tuitions repeat each other, or an empty list when they do not. */
export function duplicateReasons(a: DuplicateFacts, b: DuplicateFacts): DuplicateReason[] {
  const out: DuplicateReason[] = []
  if (titleKey(a) && titleKey(a) === titleKey(b) && samePlace(a, b)) out.push('same title')
  const ka = comboKey(a)
  if (ka && ka === comboKey(b)) out.push('same combination')
  return out
}

/**
 * The merge rule (item 15): merge when the titles match, or when the
 * combination matches AND the titles describe the same job. A combination-only
 * pair whose first title segment differs is skipped.
 */
export function shouldMerge(a: DuplicateFacts, b: DuplicateFacts): { merge: boolean; reasons: DuplicateReason[]; skipWhy: string | null } {
  const reasons = duplicateReasons(a, b)
  if (reasons.length === 0) return { merge: false, reasons, skipWhy: 'not a repeat' }
  if (reasons.includes('same title')) return { merge: true, reasons, skipWhy: null }
  const sa = titleJobSegment(a.title)
  const sb = titleJobSegment(b.title)
  if (sa && sb && sa !== sb) {
    return { merge: false, reasons, skipWhy: `titles describe different jobs ("${(a.title ?? '').split('|')[0].trim()}" vs "${(b.title ?? '').split('|')[0].trim()}")` }
  }
  return { merge: true, reasons, skipWhy: null }
}

/** The older of two tuitions (the original); ties broken by id for stability. */
export function olderOf<T extends { createdAt: string; id: string }>(a: T, b: T): T {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? a : b
  return a.id < b.id ? a : b
}

/** Refresh is allowed at most once every 3 days per tuition (item 16). */
export const REFRESH_EVERY_DAYS = 3
export function refreshAllowed(refreshedAt: string | null | undefined, now = Date.now()): { ok: boolean; nextAt: number | null } {
  if (!refreshedAt) return { ok: true, nextAt: null }
  const next = new Date(refreshedAt).getTime() + REFRESH_EVERY_DAYS * 86_400_000
  return next <= now ? { ok: true, nextAt: null } : { ok: false, nextAt: next }
}
