// lib/onboarding/subjectGroups.ts
//
// The onboarding subjects step's PURE grouping (hotfix, 7 Oct 2026). Tutors got
// stuck on a list of 50+ subjects per level, so the step shows the level's MAIN
// subjects first (the core flags from Admin → Settings → Subjects, migration 146)
// and the rest behind "More subjects". One list per LEVEL (category), never one
// per grade: Grades 6, 7 and 8 read as one "Middle" list.
//
// PURE — no React, no I/O — so the grouping and the search filter are unit-tested
// (scripts/test-onboarding-subjects.ts).

import { subjectMatches } from '@/lib/smartSearchCore'

/** category -> grade -> subject[] (the shape lib/taxonomyBuild produces). */
export type Tree = Record<string, Record<string, string[]>>

export type SubjectGroups = {
  /** The level's main subjects (union over its grades, first-seen order), plus
   *  any already-picked subject that is not main — so a selection shows ONCE. */
  main: string[]
  /** Every other subject the level offers, alphabetical. */
  more: string[]
  /** The level has no main subjects at all: open straight to the full list. */
  noMain: boolean
}

export function subjectGroups(tree: Tree, core: Tree, category: string, selected: string[] = [], keepOrder = false): SubjectGroups {
  const grades = tree[category] ?? {}
  const all = new Set<string>()
  for (const g of Object.keys(grades)) for (const s of grades[g] ?? []) all.add(s)

  const main: string[] = []
  const coreGrades = core[category] ?? {}
  for (const g of Object.keys(grades)) {
    for (const s of coreGrades[g] ?? []) if (all.has(s) && !main.includes(s)) main.push(s)
  }
  const noMain = main.length === 0
  // A picked subject outside the main list sits with the main chips (ticked), so
  // the selection is visible once and never repeated in "More".
  for (const s of selected) if (all.has(s) && !main.includes(s)) main.push(s)

  // A no-grade level (migration 153) keeps the owner's authored order.
  const rest = Array.from(all).filter((s) => !main.includes(s))
  const more = keepOrder ? rest : rest.sort((a, b) => a.localeCompare(b))
  return { main, more, noMain }
}

/** Filter the "More" list by a typed query: a plain substring match, OR a name
 *  the platform's typo-tolerant / Roman-Urdu search returned for that query
 *  (/api/search/suggest — "fizics" → Physics, "hisab" → Mathematics). */
export function filterMore(
  more: string[],
  query: string,
  suggested: string[] = [],
  /** Search words per subject name (lowercase) — the ONE smart search (owner, 8 Oct 2026). */
  words: Record<string, string[]> = {},
): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return more
  const hits = new Set(suggested.map((s) => s.toLowerCase()))
  return more.filter((s) => subjectMatches(q, s, words[s.toLowerCase()] ?? []) || hits.has(s.toLowerCase()))
}
