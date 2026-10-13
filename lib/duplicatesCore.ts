// lib/duplicatesCore.ts
//
// PURE rules for duplicate tuitions (owner, 6 Oct 2026). No database, no
// server-only import — shared by the post-time check, the tuition page's
// safety net, the admin Duplicates view, the merge data-op and the tests.
//
// Two tuitions are REPEATS of each other ONLY when they are the same
// requirement (owner, 13 Oct 2026 — this supersedes the 6 Oct "same title, or
// same combination" rule, which pointed the canonical of unrelated open
// tuitions at each other). ALL of these must hold:
//   • same city, and same area (or both empty);
//   • same level/grade set;
//   • overlapping subjects (or neither has any); when both carry per-grade
//     subjects, the same split;
//   • same Job Type (the job title: Coordinator vs Online Tutor is never a repeat);
//   • the same parent contact number — known on BOTH sides;
//   • posted within 30 days of each other.
// A different job title (Coordinator vs Online Tutor) or a different contact
// number is never a duplicate. Gender preference and budget are not compared: a
// repost with a changed budget is still the same requirement.

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
  /** Per-grade subjects (owner, 7 Oct 2026). When BOTH tuitions have them, the
   *  combination compares them grade by grade; otherwise the combined list. */
  gradeSubjects?: GradeSubjectIds | null
  /** The Job Type (jobs.teaching_mode). */
  jobType?: string | null
  /** The parent contact number as an MSISDN (lib/tuitionContactCore), or null. */
  contact?: string | null
}

import { perGradeKey, type GradeSubjectIds } from './gradeSubjects'

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

/** Two posts of one requirement are at most this many days apart. */
export const DUPLICATE_WINDOW_DAYS = 30

const levelSet = (f: DuplicateFacts): string =>
  (f.classLevels && f.classLevels.length > 0 ? f.classLevels : f.classLevel ? [f.classLevel] : []).map(norm).sort().join('|')

/** The one rule: are these two posts the same requirement? */
export function sameRequirement(a: DuplicateFacts, b: DuplicateFacts): boolean {
  if (!samePlace(a, b)) return false
  if (levelSet(a) !== levelSet(b)) return false
  if (a.masterIds.length > 0 || b.masterIds.length > 0) {
    const mine = new Set(a.masterIds)
    if (!b.masterIds.some((m) => mine.has(m))) return false
  }
  // Both tuitions carry per-grade subjects: the split must match too.
  const ga = a.gradeSubjects && a.gradeSubjects.length > 0 ? a.gradeSubjects : null
  const gb = b.gradeSubjects && b.gradeSubjects.length > 0 ? b.gradeSubjects : null
  if (ga && gb && perGradeKey(ga) !== perGradeKey(gb)) return false
  if (norm(a.jobType) !== norm(b.jobType)) return false
  if (!a.contact || !b.contact || a.contact !== b.contact) return false
  const ta = Date.parse(a.createdAt)
  const tb = Date.parse(b.createdAt)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false
  return Math.abs(ta - tb) <= DUPLICATE_WINDOW_DAYS * 86_400_000
}

export type DuplicateReason = 'same title' | 'same combination'

/**
 * How two tuitions repeat each other, or an empty list when they do not. Never
 * non-empty unless sameRequirement holds; 'same title' is added when the titles
 * are identical as well.
 */
export function duplicateReasons(a: DuplicateFacts, b: DuplicateFacts): DuplicateReason[] {
  if (!sameRequirement(a, b)) return []
  const out: DuplicateReason[] = []
  if (titleKey(a) && titleKey(a) === titleKey(b)) out.push('same title')
  out.push('same combination')
  return out
}

/** The 6 Oct rule, kept ONLY so a report can say what it used to flag. */
export function legacyDuplicateReasons(a: DuplicateFacts, b: DuplicateFacts): DuplicateReason[] {
  const out: DuplicateReason[] = []
  if (titleKey(a) && titleKey(a) === titleKey(b) && samePlace(a, b)) out.push('same title')
  const ka = comboKey(a)
  if (ka && ka === comboKey(b)) {
    const ga = a.gradeSubjects && a.gradeSubjects.length > 0 ? a.gradeSubjects : null
    const gb = b.gradeSubjects && b.gradeSubjects.length > 0 ? b.gradeSubjects : null
    if (!ga || !gb || perGradeKey(ga) === perGradeKey(gb)) out.push('same combination')
  }
  return out
}

/**
 * The merge rule (item 15): only a real repeat (sameRequirement) merges; the
 * title-segment guard stays as a second check.
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
