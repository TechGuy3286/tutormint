// lib/jobRef.ts
//
// A tuition's human reference is TM-1001 (jobs.ref_id, migration 82) — short
// enough to read over a phone. People search for it in several shapes: "TM-1414",
// "tm1414", "TM 1414", or just "1414". This turns any of them into the canonical
// ref, so the Find-tuitions search box and the typeahead can look one up (PR92
// Part B). PURE — no imports — so the browse query, the suggest route and tests
// share one parser.

/**
 * The canonical "TM-<n>" ref for a query, or null when the query is not a ref.
 * Accepts an optional "TM" prefix (any case), optional spaces/dashes, then the
 * digits. A mixed query like "TM-1414 physics" is NOT a ref (returns null), so a
 * normal text search is unaffected.
 */
export function parseJobRef(input: string | null | undefined): string | null {
  const s = (input ?? '').trim().toUpperCase().replace(/[\s-]/g, '')
  const m = s.match(/^(?:TM)?(\d{1,7})$/)
  if (!m) return null
  return `TM-${m[1]}`
}
