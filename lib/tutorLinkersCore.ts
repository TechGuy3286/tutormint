// PURE (scripts/test-pr16.ts). Which cached pages LINK TO a tutor who has just
// left the indexable set (PR-16, owner 22 Nov 2026): suspended, banned, hidden,
// erased, documents rejected — anything that drops them from listed_tutor_slugs().
//
// Those pages are rebuilt at once instead of on the 24-hour safety net, and ONLY
// those pages (every mark is an ISR write on the next visit):
//   * other tutors' profiles whose "Similar tutors" would include them;
//   * open tuitions whose "matching tutors" would include them;
//   * their city's tutor pages (/tutors/<city>, and /female for a woman) and
//     Browse tutors; their own profile.
// "Would include" is decided by the SAME rules the pages use
// (lib/tutorCrawlCore similarTutors / tutorsForTuition), run over the set as it
// was BEFORE they left — so it is exactly the set of pages that showed them.

import { citySegment } from '@/lib/slugs'
import { similarTutors, tutorsForTuition, type CrawlTuition, type CrawlTutor } from '@/lib/tutorCrawlCore'
import type { Mark } from '@/lib/publicRevalidateCore'

export type LinkerTuition = CrawlTuition & { publicSlug: string | null }

/** The slugs that were listed before and are not now. */
export function droppedSlugs(before: readonly string[], now: readonly string[]): string[] {
  const current = new Set(now)
  return [...new Set(before)].filter((s) => !current.has(s))
}

/**
 * The pages to rebuild because `gone` (tutors in `before` that left) are no
 * longer linkable. `before` is the full indexable set as it was (gone tutors
 * included); `tuitions` are the open tuitions (only those in a gone tutor's
 * city can be affected).
 */
export function linkerMarks(before: readonly CrawlTutor[], gone: readonly CrawlTutor[], tuitions: readonly LinkerTuition[]): Mark[] {
  if (gone.length === 0) return []
  const goneIds = new Set(gone.map((t) => t.id))
  const goneCities = new Set(gone.map((t) => t.citySlug))
  const paths = new Set<string>()
  const all = [...before]

  // Other profiles: only a same-city tutor sharing a subject can list a gone
  // tutor among its six, so only those are checked.
  for (const p of all) {
    if (goneIds.has(p.id) || !goneCities.has(p.citySlug)) continue
    if (!gone.some((g) => g.citySlug === p.citySlug && g.subjects.some((s) => p.subjects.includes(s)))) continue
    if (similarTutors(all, p).some((t) => goneIds.has(t.id))) paths.add(`/tutor/${p.slug}`)
  }

  // Open tuitions in a gone tutor's city.
  for (const j of tuitions) {
    if (!j.publicSlug || !j.city || !goneCities.has(citySegment(j.city))) continue
    if (tutorsForTuition(all, j).some((t) => goneIds.has(t.id))) paths.add(`/tuitions/${citySegment(j.city)}/${j.publicSlug}`)
  }

  // Their city's tutor pages, Browse tutors and their own profile.
  for (const g of gone) {
    paths.add(`/tutors/${g.citySlug}`)
    if (g.gender === 'female') paths.add(`/tutors/${g.citySlug}/female`)
    paths.add(`/tutor/${g.slug}`)
  }
  paths.add('/browse/tutors')
  return [...paths].sort().map((path) => ({ path }))
}

/** Each server keeps the crawl set in memory for up to 5 minutes
 *  (LANDING_LIVE_REVALIDATE), so a page rebuilt on another server right after
 *  the drop could still list the tutor. The same marks are applied once more
 *  after that window. */
export const LINKER_REDO_MS = 6 * 60_000

export type PendingMarks = { marks: Mark[]; redoAt: string }

/** Is a stored second pass due? */
export function redoDue(p: PendingMarks | null | undefined, nowMs: number): boolean {
  return !!p && Array.isArray(p.marks) && p.marks.length > 0 && Date.parse(p.redoAt) <= nowMs
}

/** Merge new marks into a pending second pass (redo time pushed out). */
export function withPending(p: PendingMarks | null | undefined, marks: Mark[], nowMs: number): PendingMarks {
  const paths = new Set([...(p?.marks ?? []).map((m) => m.path), ...marks.map((m) => m.path)])
  return { marks: [...paths].sort().map((path) => ({ path })), redoAt: new Date(nowMs + LINKER_REDO_MS).toISOString() }
}
