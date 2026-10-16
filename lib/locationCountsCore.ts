// lib/locationCountsCore.ts
//
// Admin → Locations → "Typed by tutors and parents" (owner, 16 Oct 2026). PURE.
// The heading, the chips, the bulk buttons and the summary line all come from
// ONE counts object — the one the latest list load returned — so they can never
// disagree (the heading once read 0 while the chips said 5, and earlier 5 vs 8:
// the heading was re-read by the page after each approval while the chips kept
// the count from the last list load). A bulk button with nothing to approve is
// disabled. Tested in scripts/test-locations-followups.ts.

export type ReviewCounts = { same: number; notArea: number; add: number; aliases: number; ignored: number }
export type ReviewKindId = 'all' | 'same' | 'not_area' | 'add'

export const REVIEW_KIND_LABEL: Record<Exclude<ReviewKindId, 'all'>, string> = {
  same: 'Same as an area',
  not_area: 'Not an area',
  add: 'New area',
}

export function reviewCountsView(c: ReviewCounts, busy = false) {
  const waiting = c.same + c.notArea + c.add
  return {
    waiting,
    heading: `Typed by tutors and parents (${waiting})`,
    summary: `Suggested: ${c.same} same as an area · ${c.notArea} not an area · ${c.add} new area. Already done: ${c.aliases} counted as an existing area · ${c.ignored} marked not an area.`,
    tabs: [
      { id: 'all' as const, label: 'All', n: waiting },
      { id: 'same' as const, label: REVIEW_KIND_LABEL.same, n: c.same },
      { id: 'not_area' as const, label: REVIEW_KIND_LABEL.not_area, n: c.notArea },
      { id: 'add' as const, label: REVIEW_KIND_LABEL.add, n: c.add },
    ],
    bulk: (
      [
        ['same', c.same],
        ['not_area', c.notArea],
        ['add', c.add],
      ] as const
    ).map(([id, n]) => ({ id, n, label: `Approve all “${REVIEW_KIND_LABEL[id]}” (${n})`, disabled: busy || n === 0 })),
  }
}
