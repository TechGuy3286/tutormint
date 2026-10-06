// lib/gradeSubjectBulk.ts
//
// "Select all" / "Clear all" for ONE grade's subjects (owner, 6 Oct 2026, item
// 17). Pure, client-safe. Subjects are chosen BY NAME (lib/taxonomy resolves each
// name × every selected grade to master ids), so:
//   • Select all adds every subject listed for that grade — and only those; a
//     subject that exists only in another grade is never added.
//   • Clear all removes that grade's subjects. A subject offered by two selected
//     grades (e.g. English in Grade 1 and Grade 2) is one choice, so clearing it
//     from one grade clears it for both — the same as unticking it by hand.
// Individual subjects can still be tapped off afterwards.

/** The selection with every one of this grade's subjects added (order kept, no repeats). */
export function selectAllForGrade(selected: string[], gradeSubjects: string[]): string[] {
  const out = [...selected]
  for (const s of gradeSubjects) if (!out.includes(s)) out.push(s)
  return out
}

/** The selection with this grade's subjects removed. */
export function clearAllForGrade(selected: string[], gradeSubjects: string[]): string[] {
  const drop = new Set(gradeSubjects)
  return selected.filter((s) => !drop.has(s))
}

/** Whether every one of this grade's subjects is already selected. */
export function gradeFullySelected(selected: string[], gradeSubjects: string[]): boolean {
  return gradeSubjects.length > 0 && gradeSubjects.every((s) => selected.includes(s))
}
