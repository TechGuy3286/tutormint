// lib/gradeSubjects.ts
//
// Subjects PER GRADE on a tuition (owner, 7 Oct 2026). PURE and client-safe:
// the form, the job writes, the display and the duplicate check all read these.
//
//   In the form   a map grade name → subject names (what the chips toggle).
//   Stored        jobs.grade_subjects = [{ grade, masterIds }] — taxonomy ids,
//                 never free text (rule 12), in the order the grades were chosen.
//   Combined      job_subjects = the UNION of every grade's ids, written on every
//                 save, so everything that reads job_subjects is unchanged.

import { collapseLevels } from './levelDisplay'

export type GradeSubjectMap = Record<string, string[]>
export type GradeSubjectIds = { grade: string; masterIds: number[] }[]

const uniq = <T,>(xs: T[]) => Array.from(new Set(xs))

/** Tap a subject chip under ONE grade. Other grades are untouched. */
export function toggleGradeSubject(map: GradeSubjectMap, grade: string, subject: string): GradeSubjectMap {
  const cur = map[grade] ?? []
  return { ...map, [grade]: cur.includes(subject) ? cur.filter((s) => s !== subject) : [...cur, subject] }
}

/** "Select all" for ONE grade: every subject that grade offers, nothing from another. */
export function selectAllForGrade(map: GradeSubjectMap, grade: string, offered: string[]): GradeSubjectMap {
  return { ...map, [grade]: uniq([...(map[grade] ?? []), ...offered]) }
}

/** "Clear all" for ONE grade. */
export function clearGrade(map: GradeSubjectMap, grade: string): GradeSubjectMap {
  return { ...map, [grade]: [] }
}

/** Keep only the selected grades — removing a grade removes its subject list. */
export function keepGrades(map: GradeSubjectMap, grades: string[]): GradeSubjectMap {
  const out: GradeSubjectMap = {}
  for (const g of grades) out[g] = map[g] ?? []
  return out
}

/** The combined subject names across the selected grades, in grade order. */
export function unionSubjects(map: GradeSubjectMap, grades: string[]): string[] {
  return uniq(grades.flatMap((g) => map[g] ?? []))
}

/** Selected grades that offer subjects but have none chosen (validation). */
export function gradesMissingSubjects(map: GradeSubjectMap, grades: string[], offered: Record<string, string[]>): string[] {
  return grades.filter((g) => (offered[g] ?? []).length > 0 && (map[g] ?? []).length === 0)
}

/**
 * Clean a per-grade payload on the SERVER: only the job's own grades, whole
 * positive ids, no repeats, no empty grades. Null when nothing is left (the
 * tuition then behaves exactly as before per-grade data existed).
 */
export function sanitizeGradeSubjects(raw: unknown, classLevels: string[]): GradeSubjectIds | null {
  if (!Array.isArray(raw)) return null
  const allowed = new Set(classLevels.map((l) => l.trim()))
  const out: GradeSubjectIds = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const grade = String((item as { grade?: unknown }).grade ?? '').trim()
    if (!grade || seen.has(grade) || (allowed.size > 0 && !allowed.has(grade))) continue
    const ids = uniq(
      (Array.isArray((item as { masterIds?: unknown }).masterIds) ? ((item as { masterIds: unknown[] }).masterIds) : [])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n > 0),
    )
    if (ids.length === 0) continue
    seen.add(grade)
    out.push({ grade, masterIds: ids })
  }
  return out.length > 0 ? out : null
}

/** The union of every grade's ids — what job_subjects holds. */
export function unionMasterIds(groups: GradeSubjectIds): number[] {
  return uniq(groups.flatMap((g) => g.masterIds)).sort((a, b) => a - b)
}

/** The selected grades with no subjects in the stored groups (server validation). */
export function gradesWithoutIds(groups: GradeSubjectIds, classLevels: string[]): string[] {
  const has = new Set(groups.filter((g) => g.masterIds.length > 0).map((g) => g.grade))
  return classLevels.filter((l) => !has.has(l))
}

/** A stable key for comparing two tuitions' per-grade subjects (duplicate check). */
export function perGradeKey(groups: GradeSubjectIds): string {
  return groups
    .map((g) => `${g.grade.trim().toLowerCase()}:${[...g.masterIds].sort((a, b) => a - b).join(',')}`)
    .sort()
    .join('|')
}

export type GradeGroup = { grade: string; subjects: string[] }
export type DisplayGroup = { label: string; subjects: string[] }

/**
 * Subjects grouped by grade for display: "Grade 1: English, Urdu · Grade 2:
 * Maths". When EVERY grade has the same subjects it is shown once:
 * "Grades 1–3: English, Urdu, Maths".
 */
export function displayGroups(groups: GradeGroup[]): DisplayGroup[] {
  const g = groups.filter((x) => x.subjects.length > 0)
  if (g.length === 0) return []
  const sameEverywhere =
    g.length > 1 && g.every((x) => x.subjects.length === g[0].subjects.length && x.subjects.every((s) => g[0].subjects.includes(s)))
  if (sameEverywhere) {
    const label = collapseLevels(g.map((x) => x.grade))
    return [{ label: label.replace(/^Grade\s/, 'Grades '), subjects: g[0].subjects }]
  }
  return g.map((x) => ({ label: x.grade, subjects: x.subjects }))
}

/** The one-line text form: "Grade 1: English, Urdu · Grade 2: Maths". */
export function gradeSubjectsLine(groups: GradeGroup[]): string {
  return displayGroups(groups)
    .map((d) => `${d.label}: ${d.subjects.join(', ')}`)
    .join(' · ')
}

/**
 * The BACKFILL rule (owner, 7 Oct 2026): a tuition's current subject ids,
 * grouped by each id's own grade, in the tuition's grade order (any grade not
 * in class_levels — a retired one — follows). Each grade therefore keeps the
 * tuition's current subject list for that grade; nothing is added or dropped,
 * and the union is exactly the ids it started with.
 */
export function groupIdsByGrade(ids: number[], gradeOf: Map<number, string>, gradeOrder: string[]): GradeSubjectIds {
  const by = new Map<string, number[]>()
  for (const id of uniq(ids)) {
    const g = gradeOf.get(id)
    if (!g) continue
    const list = by.get(g) ?? []
    list.push(id)
    by.set(g, list)
  }
  const order = [...gradeOrder.filter((g) => by.has(g)), ...[...by.keys()].filter((g) => !gradeOrder.includes(g))]
  return order.map((g) => ({ grade: g, masterIds: (by.get(g) ?? []).sort((a, b) => a - b) }))
}
