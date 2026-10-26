// lib/overviewOrderCore.ts
//
// The admin Overview's section order (owner, 26 Oct 2026) — ONE constant. The
// six named sections always come first, in this order; every other section
// (today: the staff "My link" card, and anything added later) goes below them.
// A role sees the sections it is allowed to see, in the same order.
// scripts/test-overview-order.ts fails if this list changes.
//
// PURE — no imports.

export const OVERVIEW_SECTION_ORDER = [
  'cards', // Square cards
  'todo', // Today's to-do
  'team', // Team overview
  'signupToPayment', // Sign-up to payment
  'dailyFunnel', // Daily sign-up funnel
  'sources', // Where sign-ups came from
] as const

export type OverviewSectionKey = (typeof OVERVIEW_SECTION_ORDER)[number]

/** The sections to draw, in order: the fixed six first (only those present),
 *  then every other section in the order it was given. */
export function orderOverviewSections<T extends { key: string }>(sections: T[]): T[] {
  const fixed: T[] = []
  for (const key of OVERVIEW_SECTION_ORDER) {
    const s = sections.find((x) => x.key === key)
    if (s) fixed.push(s)
  }
  const fixedKeys = new Set<string>(OVERVIEW_SECTION_ORDER)
  return [...fixed, ...sections.filter((s) => !fixedKeys.has(s.key))]
}
