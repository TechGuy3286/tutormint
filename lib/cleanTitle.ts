// lib/cleanTitle.ts
//
// One shared clean-up for a stored tuition title (PR89 Part B). Some titles were
// saved with double spaces, empty pipe segments or a dangling separator, e.g.
//   "Female Home Tutor Required  | Grade 3 | -"  →  "Female Home Tutor Required | Grade 3"
//
// Applied on EVERY save (parent posting, admin/staff posting, AI-written titles,
// edits) so a messy title never reaches the database, and once over the existing
// rows. It only ever touches the TITLE TEXT — never public_slug or the URL.
//
// The rule, in order:
//   * split on the pipe, so segments are cleaned independently;
//   * inside a segment, collapse any run of whitespace to one space and trim;
//   * strip leading/trailing separator punctuation (| - – — ,) and spaces from
//     each segment — this is what removes the lone "-" or "," segment;
//   * drop the segments that are now empty;
//   * rejoin the survivors with " | ".
// Separators that sit INSIDE a segment ("Grade 9-10", "PECHS Block 6, Karachi",
// "Grade 1–5") are untouched — only the segment ends are stripped.
//
// PURE — no imports — so the write paths, the data clean-up and the tests share
// one function.

// The separator characters treated as trimmable at a segment's edges.
const EDGE_SEPARATORS = /^[\s|\-–—,]+|[\s|\-–—,]+$/g

export function cleanTuitionTitle(raw: string | null | undefined): string {
  const source = (raw ?? '').toString()
  const segments = source
    .split('|')
    .map((seg) => seg.replace(/\s+/g, ' ').trim())
    .map((seg) => seg.replace(EDGE_SEPARATORS, '').trim())
    .filter((seg) => seg.length > 0)
  return segments.join(' | ')
}

/** The messy-title patterns the clean-up removes, for the data audit and tests:
 *  a double space, an empty "| |" segment, a segment that is only separators, or
 *  a leading/trailing separator on the whole string. True = the title is messy. */
export function isMessyTitle(raw: string | null | undefined): boolean {
  const s = (raw ?? '').toString()
  if (s.length === 0) return false
  return s !== cleanTuitionTitle(s)
}
