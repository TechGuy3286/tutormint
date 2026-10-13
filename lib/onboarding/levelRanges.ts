// lib/onboarding/levelRanges.ts
//
// The onboarding Subjects step's PURE brain (owner, 13 Oct 2026). More tutors
// stop at this step than at any other, so it is built to be answered in a few
// taps:
//
//   • LEVEL RANGES — "Grade 1–5", "Grade 9–10 / Matric", "O Level"… one tap
//     selects every grade in the range; a grade can still be switched off.
//   • QUICK PICKS — the commonest level + subject pairs as one-tap chips.
//   • ONE SEARCH BOX — a subject typed once is found at every level.
//   • The minimum to continue is one level and one subject.
//
// A range is a set of grades of ONE taxonomy level, matched by NAME PATTERN
// against the live taxonomy — nothing here is a second list of grades or
// subjects, and a level the patterns do not name still appears, as its own
// range, under "More levels". No React, no I/O (scripts/test-level-ranges.ts).

import { subjectMatches } from '@/lib/smartSearchCore'

/** level (category) → grade → subject names: the shape lib/taxonomyBuild produces. */
export type Tree = Record<string, Record<string, string[]>>

export type LevelRange = {
  id: string
  label: string
  /** The taxonomy level (category) the grades belong to. */
  category: string
  /** Every grade in the range, in taxonomy order. */
  grades: string[]
  /** One of the eight named ranges (shown first); false = "More levels". */
  named: boolean
}

type Def = { id: string; label: string; category: RegExp; grade?: RegExp }

const DEFS: Def[] = [
  { id: 'pre', label: 'Play Group to KG', category: /^pre\s*-?\s*primary/i },
  { id: 'primary', label: 'Grade 1–5', category: /^primary\b/i },
  { id: 'middle', label: 'Grade 6–8', category: /^middle\b/i },
  { id: 'matric', label: 'Grade 9–10 / Matric', category: /^matric/i },
  { id: 'inter', label: 'Part I & II (FSc, FA, ICS, I.Com)', category: /^intermediate/i },
  { id: 'olevel', label: 'O Level', category: /^igcse/i, grade: /^o\s*levels?\b/i },
  { id: 'alevel', label: 'A Level', category: /^igcse/i, grade: /\ba\s*levels?\b/i },
  { id: 'bs', label: 'BS / University', category: /^bs\b/i },
]

/** The ranges the live taxonomy supports: the named ones first, then every
 *  level or grade they leave out, each as its own range. */
export function levelRanges(tree: Tree): LevelRange[] {
  const out: LevelRange[] = []
  const covered = new Set<string>()
  for (const def of DEFS) {
    for (const category of Object.keys(tree)) {
      if (!def.category.test(category)) continue
      const grades = Object.keys(tree[category] ?? {}).filter((g) => !def.grade || def.grade.test(g))
      if (grades.length === 0) continue
      out.push({ id: def.id, label: def.label, category, grades, named: true })
      for (const g of grades) covered.add(`${category}|${g}`)
      break
    }
  }
  for (const category of Object.keys(tree)) {
    const all = Object.keys(tree[category] ?? {})
    const left = all.filter((g) => !covered.has(`${category}|${g}`))
    if (left.length === 0) continue
    if (left.length === all.length) {
      out.push({ id: `level:${category}`, label: category, category, grades: left, named: false })
    } else {
      for (const g of left) out.push({ id: `grade:${category}|${g}`, label: g, category, grades: [g], named: false })
    }
  }
  return out
}

/** What a tutor has chosen: per range, which of its grades and which subjects. */
export type RangeSelection = Record<string, { grades: string[]; subjects: string[] }>

const inOrder = (range: LevelRange, grades: string[]) => range.grades.filter((g) => grades.includes(g))

/** One tap on a range: select every grade in it — or, when selected, remove it. */
export function toggleRange(sel: RangeSelection, range: LevelRange): RangeSelection {
  const next = { ...sel }
  if (next[range.id]) delete next[range.id]
  else next[range.id] = { grades: [...range.grades], subjects: [] }
  return next
}

/** Switch one grade of a selected range on or off. The last grade off removes the range. */
export function toggleGrade(sel: RangeSelection, range: LevelRange, grade: string): RangeSelection {
  const cur = sel[range.id]
  if (!cur || !range.grades.includes(grade)) return sel
  const grades = cur.grades.includes(grade) ? cur.grades.filter((g) => g !== grade) : inOrder(range, [...cur.grades, grade])
  const next = { ...sel }
  if (grades.length === 0) delete next[range.id]
  else next[range.id] = { ...cur, grades }
  return next
}

/** Tick or untick a subject under a range (selecting the range if it was not). */
export function toggleSubject(sel: RangeSelection, range: LevelRange, subject: string): RangeSelection {
  const cur = sel[range.id] ?? { grades: [...range.grades], subjects: [] }
  const subjects = cur.subjects.includes(subject) ? cur.subjects.filter((s) => s !== subject) : [...cur.subjects, subject]
  return { ...sel, [range.id]: { ...cur, subjects } }
}

/** The subjects the SELECTED grades of a range offer, first-seen order. */
export function subjectsOffered(tree: Tree, range: LevelRange, grades: string[] = range.grades): string[] {
  const out: string[] = []
  for (const g of inOrder(range, grades)) for (const s of tree[range.category]?.[g] ?? []) if (!out.includes(s)) out.push(s)
  return out
}

/** How many levels and subjects are chosen — the two halves of "can continue". */
export function selectionCounts(sel: RangeSelection): { levels: number; subjects: number } {
  const rows = Object.values(sel).filter((r) => r.grades.length > 0)
  return { levels: rows.length, subjects: rows.reduce((n, r) => n + r.subjects.length, 0) }
}

/** The minimum to continue: one level and one subject (in a level that has grades). */
export function canContinue(sel: RangeSelection): boolean {
  return Object.values(sel).some((r) => r.grades.length > 0 && r.subjects.length > 0)
}

export type Master = { id: number; category: string; level: string; subject: string | null }

/** The taxonomy ids a selection means: each chosen subject at each chosen grade
 *  that offers it. A subject a grade does not offer adds nothing. */
export function resolveSelection(sel: RangeSelection, ranges: LevelRange[], masters: Master[]): number[] {
  const byId = new Map(ranges.map((r) => [r.id, r]))
  const ids = new Set<number>()
  for (const [rangeId, row] of Object.entries(sel)) {
    const range = byId.get(rangeId)
    if (!range || row.subjects.length === 0) continue
    for (const m of masters) {
      if (m.category === range.category && m.subject && row.grades.includes(m.level) && row.subjects.includes(m.subject)) ids.add(m.id)
    }
  }
  return [...ids]
}

/** A saved set of ids, read back as a selection (a returning tutor's choices). */
export function selectionFromIds(ids: number[], ranges: LevelRange[], masters: Master[]): RangeSelection {
  const byId = new Map(masters.map((m) => [m.id, m]))
  const sel: RangeSelection = {}
  for (const id of ids) {
    const m = byId.get(id)
    if (!m || !m.subject) continue
    const range = ranges.find((r) => r.category === m.category && r.grades.includes(m.level))
    if (!range) continue
    const row = sel[range.id] ?? (sel[range.id] = { grades: [], subjects: [] })
    if (!row.grades.includes(m.level)) row.grades = inOrder(range, [...row.grades, m.level])
    if (!row.subjects.includes(m.subject)) row.subjects.push(m.subject)
  }
  return sel
}

// --------------------------------------------------------------- quick picks

export type QuickPick = {
  id: string
  label: string
  /** The range's id, or a pattern for a "More levels" range (by level name). */
  range: string | RegExp
  /** Only these grades of the range (FSc within Part I & II); all when absent. */
  grades?: RegExp
  /** The first of these names the range offers, for each entry. */
  subjects?: string[][]
  /** The range's MAIN subjects (Admin → Settings → Subjects). */
  main?: boolean
  /** Every subject the range offers (small levels only — Quran). */
  all?: boolean
}

export const QUICK_PICKS: QuickPick[] = [
  { id: 'matric-maths', label: 'Matric Maths', range: 'matric', subjects: [['Mathematics']] },
  { id: 'olevel-english', label: 'O Level English', range: 'olevel', subjects: [['English Language', 'English']] },
  { id: 'primary-all', label: 'Primary all subjects', range: 'primary', main: true },
  { id: 'quran', label: 'Quran / Nazra', range: /quran/i, all: true },
  { id: 'fsc-physics', label: 'FSc Physics', range: 'inter', grades: /^fsc/i, subjects: [['Physics']] },
]

export type ResolvedPick = { pick: QuickPick; range: LevelRange; grades: string[]; subjects: string[] }

/** The quick picks the live taxonomy can honour — one that names no real level
 *  or subject is simply not offered. */
export function resolveQuickPicks(tree: Tree, core: Tree, ranges: LevelRange[], picks: QuickPick[] = QUICK_PICKS): ResolvedPick[] {
  const out: ResolvedPick[] = []
  for (const pick of picks) {
    const range = typeof pick.range === 'string' ? ranges.find((r) => r.id === pick.range) : ranges.find((r) => (pick.range as RegExp).test(r.category))
    if (!range) continue
    const grades = pick.grades ? range.grades.filter((g) => pick.grades!.test(g)) : range.grades
    if (grades.length === 0) continue
    const offered = subjectsOffered(tree, range, grades)
    let subjects: string[] = []
    if (pick.all) subjects = offered
    else if (pick.main) subjects = subjectsOffered(core, range, grades).filter((s) => offered.includes(s))
    else subjects = (pick.subjects ?? []).map((names) => names.find((n) => offered.includes(n))).filter((s): s is string => !!s)
    if (subjects.length === 0) continue
    out.push({ pick, range, grades, subjects })
  }
  return out
}

/** Is this quick pick fully in the selection already? (Its chip shows ticked.) */
export function pickApplied(sel: RangeSelection, p: ResolvedPick): boolean {
  const row = sel[p.range.id]
  return !!row && p.grades.every((g) => row.grades.includes(g)) && p.subjects.every((s) => row.subjects.includes(s))
}

/** One tap on a quick pick: add its grades and subjects — or take its subjects
 *  back out when it is already applied. Other choices are untouched. */
export function applyQuickPick(sel: RangeSelection, p: ResolvedPick): RangeSelection {
  const cur = sel[p.range.id]
  if (cur && pickApplied(sel, p)) {
    const subjects = cur.subjects.filter((s) => !p.subjects.includes(s))
    return { ...sel, [p.range.id]: { ...cur, subjects } }
  }
  // A new range takes only the pick's grades; a range already chosen keeps its
  // grades and gains the pick's.
  const grades = cur ? inOrder(p.range, [...cur.grades, ...p.grades]) : [...p.grades]
  const subjects = [...(cur?.subjects ?? [])]
  for (const s of p.subjects) if (!subjects.includes(s)) subjects.push(s)
  return { ...sel, [p.range.id]: { grades, subjects } }
}

// -------------------------------------------------------------- the one search

export type SearchHit = { range: LevelRange; subject: string; selected: boolean }

/**
 * A typed subject, found at every level that offers it. Matches the subject's
 * name, its Search words and near-misses (lib/smartSearchCore — the same rule
 * as the Browse search), plus any name the server's typo-tolerant search
 * returned. The tutor's chosen levels come first, then the others in order.
 */
export function searchSubjects(
  query: string,
  tree: Tree,
  ranges: LevelRange[],
  sel: RangeSelection,
  words: Record<string, string[]> = {},
  serverHits: string[] = [],
  limit = 14,
): SearchHit[] {
  const q = query.trim()
  if (q.length < 2) return []
  const hits = new Set(serverHits.map((s) => s.toLowerCase()))
  const out: SearchHit[] = []
  const ordered = [...ranges.filter((r) => sel[r.id]), ...ranges.filter((r) => !sel[r.id])]
  for (const range of ordered) {
    const row = sel[range.id]
    for (const subject of subjectsOffered(tree, range, row ? row.grades : range.grades)) {
      if (!(subjectMatches(q, subject, words[subject.toLowerCase()] ?? []) || hits.has(subject.toLowerCase()))) continue
      out.push({ range, subject, selected: !!row && row.subjects.includes(subject) })
      if (out.length >= limit) return out
    }
  }
  return out
}

/** The removable chips: every chosen subject with the level it is under. */
export function selectionChips(sel: RangeSelection, ranges: LevelRange[]): { range: LevelRange; subject: string }[] {
  const out: { range: LevelRange; subject: string }[] = []
  for (const range of ranges) for (const subject of sel[range.id]?.subjects ?? []) out.push({ range, subject })
  return out
}
