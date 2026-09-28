// PR84 — the merge behind the level-first tutor Settings subject editor.
//
// The editor shows subjects ONCE PER LEVEL (category): the union of that level's
// subjects across its grades. A subject is "selected" if the tutor has it for
// ANY grade in the level. But a tutor's saved subjects may not cover every grade
// in a level (PR74 found 15 such tutors), and opening the editor must NEVER
// silently expand a partial subject to all grades or drop anyone's rows.
//
// So the save does not replace the set — it MERGES. Given the tutor's existing
// per-grade master ids, the non-legacy taxonomy, and the editor's final
// selected-subject names per TOUCHED level, the final set is:
//
//   * a newly picked subject (was NOT selected before) → added for EVERY grade in
//     that level where the taxonomy has it,
//   * an unpicked subject (was selected) → removed from every grade in that level,
//   * an untouched subject (still selected) → its EXACT existing per-grade rows
//     are kept (a partial stays partial — never expanded),
//   * a level not in `selections` → all its rows kept exactly (untouched),
//   * a removed level → passed with an EMPTY selection, so every subject is
//     unpicked and all its rows are removed.
//
// Passing an UNCHANGED level's derived selection is a no-op (every subject is
// was==now), so the editor can safely pass every level it shows; only real
// add/remove/level changes move a row. Legacy master ids are never in the
// non-legacy `masters`, so a legacy-only level is never in `selections` and is
// preserved untouched.

export type SubjectMasterLite = { id: number; category: string; subject: string | null }

/** The initial editor selection derived from the tutor's saved ids: per level
 *  (category), the subject names the tutor has for ANY grade. Non-legacy only. */
export function deriveSelections(existing: number[], masters: SubjectMasterLite[]): Record<string, string[]> {
  const set = new Set(existing)
  const acc: Record<string, Set<string>> = {}
  for (const m of masters) {
    if (m.subject == null) continue
    if (set.has(m.id)) (acc[m.category] ??= new Set()).add(m.subject)
  }
  const out: Record<string, string[]> = {}
  for (const [cat, subs] of Object.entries(acc)) out[cat] = [...subs].sort()
  return out
}

/** Merge the editor's final per-level selections into the tutor's existing set,
 *  preserving untouched (including partial-grade) rows. Returns the final master
 *  ids, sorted. */
export function mergeSubjectSelections(
  existing: number[],
  masters: SubjectMasterLite[],
  selections: Record<string, string[]>,
): number[] {
  const existingSet = new Set(existing)
  const final = new Set(existing)

  // category -> subject -> [master ids across its grades]
  const byCat = new Map<string, Map<string, number[]>>()
  for (const m of masters) {
    if (m.subject == null) continue
    let bySub = byCat.get(m.category)
    if (!bySub) {
      bySub = new Map()
      byCat.set(m.category, bySub)
    }
    const arr = bySub.get(m.subject) ?? []
    arr.push(m.id)
    bySub.set(m.subject, arr)
  }

  for (const [category, selected] of Object.entries(selections)) {
    const bySub = byCat.get(category)
    if (!bySub) continue
    const selSet = new Set(selected)
    for (const [subject, ids] of bySub) {
      const was = ids.some((id) => existingSet.has(id))
      const now = selSet.has(subject)
      if (now && !was) for (const id of ids) final.add(id)
      else if (!now && was) for (const id of ids) final.delete(id)
      // untouched (was == now): leave `final` as-is — a partial stays partial.
    }
  }

  return [...final].sort((a, b) => a - b)
}
