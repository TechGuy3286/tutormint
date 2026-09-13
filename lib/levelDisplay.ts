// lib/levelDisplay.ts
//
// Render a set of Job levels readably for a card / title (owner, 11 Sep 2026).
// Level is a multi-select now (migration 79 split the lumped rows), so a job can
// carry "Grade 1", "Grade 2", … — and a contiguous run must read as "Grade 1–5",
// not "Grade 1 | Grade 2 | Grade 3 | Grade 4 | Grade 5". Pure, so the collapse is
// unit-testable.

/** "Grade 9 Arts" → { n: 9, suffix: " Arts" }; non-grade levels return null. */
function parseGrade(level: string): { n: number; suffix: string } | null {
  const m = level.trim().match(/^Grade (\d+)(.*)$/)
  if (!m) return null
  return { n: parseInt(m[1], 10), suffix: m[2] }
}

/**
 * Collapse a level array to a display string: a contiguous run of same-suffix
 * grades (Grade 1, Grade 2, … in order, each one more than the last) becomes
 * "Grade first–last<suffix>"; everything else is kept as written. An en-dash
 * separates the range.
 *
 * The remaining parts are joined for the body line with ", " in input order
 * (the default). Pass `{ conjunction: true }` for the natural-phrase card title,
 * which joins the last two with " and " ("Grade 2 and Grade 5", "Grade 1–5,
 * Grade 8 and O Levels") so the level reads as prose rather than a list.
 */
export function collapseLevels(
  levels: (string | null | undefined)[],
  opts?: { conjunction?: boolean },
): string {
  const list = (levels ?? []).map((l) => (l ?? '').trim()).filter(Boolean)
  const parts: string[] = []
  let i = 0
  while (i < list.length) {
    const g = parseGrade(list[i])
    if (!g) {
      parts.push(list[i])
      i++
      continue
    }
    // Extend the run while the next level is the same suffix and one grade higher.
    let j = i
    while (j + 1 < list.length) {
      const cur = parseGrade(list[j])
      const next = parseGrade(list[j + 1])
      if (cur && next && next.suffix === cur.suffix && next.n === cur.n + 1) j++
      else break
    }
    if (j > i) {
      const last = parseGrade(list[j])!
      parts.push(`Grade ${g.n}–${last.n}${g.suffix}`)
    } else {
      parts.push(list[i])
    }
    i = j + 1
  }
  if (opts?.conjunction && parts.length > 1) {
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  }
  return parts.join(', ')
}
