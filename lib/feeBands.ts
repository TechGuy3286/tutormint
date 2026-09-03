// The fee / budget bands, in one place for both browse pages.
//
// They replaced two free-number inputs per bar. Those inputs asked a reader to
// know what a tutor costs before they had seen one, took two interactions and
// a blur to apply, and on a phone opened a numeric keyboard twice to express
// one idea. A band is a single tap.
//
// THE URL SHAPE IS UNCHANGED. feeMin/feeMax (tutors) and budgetMin/budgetMax
// (jobs) are still what the server reads and what a shared or bookmarked link
// carries; the band is only how the pair is chosen. That also means an old
// link with hand-set numbers keeps working — see `bandFor` below.
//
// Boundaries are half-open: each band's upper bound is one rupee below the
// next band's lower bound, so no fee falls in two bands and none falls between
// them. The consequence worth knowing is that exactly Rs 20,000 lands in
// "Over Rs 20,000" rather than in the band whose label ends there.

export type FeeBand = {
  value: string
  label: string
  min: string
  max: string
}

export const FEE_BANDS: FeeBand[] = [
  { value: '', label: 'Any fee', min: '', max: '' },
  { value: 'u5', label: 'Under Rs 5,000', min: '', max: '4999' },
  { value: '5-10', label: 'Rs 5,000 - 10,000', min: '5000', max: '9999' },
  { value: '10-20', label: 'Rs 10,000 - 20,000', min: '10000', max: '19999' },
  { value: 'o20', label: 'Over Rs 20,000', min: '20000', max: '' },
]

/** The same bands worded for a job post, where the number is a budget. */
export const BUDGET_BANDS: FeeBand[] = FEE_BANDS.map((b) =>
  b.value === '' ? { ...b, label: 'Any budget' } : b,
)

/**
 * Which band a min/max pair represents, or '' when it is not one of them.
 *
 * A URL from before this change — or one somebody edited by hand — can carry
 * any numbers at all. Rather than drop that filter or invent a band for it,
 * the select falls back to "Any fee" while the active-filter chips continue to
 * show the real values and can still clear them. The filter keeps working and
 * stays visible; only the select has nothing true to say about it.
 */
export function bandFor(min: string, max: string): string {
  const found = FEE_BANDS.find((b) => b.value !== '' && b.min === min && b.max === max)
  return found?.value ?? ''
}

/** The min/max a band sets. An unknown value clears both. */
export function bandRange(value: string): { min: string; max: string } {
  const band = FEE_BANDS.find((b) => b.value === value)
  return { min: band?.min ?? '', max: band?.max ?? '' }
}

/** How a band's active range reads on a chip. */
export function feeChipLabel(min: string, max: string): string {
  const band = FEE_BANDS.find((b) => b.value !== '' && b.min === min && b.max === max)
  if (band) return band.label
  if (min && max) return `Rs ${Number(min).toLocaleString('en-PK')} - ${Number(max).toLocaleString('en-PK')}`
  if (min) return `From Rs ${Number(min).toLocaleString('en-PK')}`
  return `Up to Rs ${Number(max).toLocaleString('en-PK')}`
}
