// PURE, client-safe (scripts/test-pr19.ts). The one rating display (owner,
// 23 Nov 2026 — PR-19): five stars always, filled gold, empty light grey, a half
// star for .5, then the number and the count — "5.0 (1 rating)", "4.6 (12
// ratings)". No ratings → the existing "No reviews yet" text, no empty stars.
// components/RatingStars draws it; every screen that shows a rating uses that.

export type StarFill = 'full' | 'half' | 'empty'

export const NO_REVIEWS_YET = 'No reviews yet'

/** The rating clamped to 0–5 (anything not a number is 0). */
export function clampRating(rating: number | string | null | undefined): number {
  const n = Number(rating)
  return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0
}

/** The five stars for a rating, to the nearest half: 4.6 → ★★★★½, 4.5 → ★★★★½, 4.8 → ★★★★★. */
export function starFills(rating: number | string | null | undefined): StarFill[] {
  const halves = Math.round(clampRating(rating) * 2)
  return [0, 1, 2, 3, 4].map((i) => (halves >= (i + 1) * 2 ? 'full' : halves === i * 2 + 1 ? 'half' : 'empty'))
}

/** "4.6". */
export function ratingNumber(rating: number | string | null | undefined): string {
  return clampRating(rating).toFixed(1)
}

/** "(1 rating)" / "(12 ratings)". */
export function ratingCountText(count: number): string {
  return `(${count.toLocaleString('en-US')} ${count === 1 ? 'rating' : 'ratings'})`
}

/** "5.0 (1 rating)" — or the number alone for one rating (count omitted). */
export function ratingText(rating: number | string | null | undefined, count?: number | null): string {
  return count == null ? ratingNumber(rating) : `${ratingNumber(rating)} ${ratingCountText(count)}`
}

/** "Rated 4.6 out of 5 from 12 ratings" / "Rated 4.0 out of 5" (one rating). */
export function ratingAriaLabel(rating: number | string | null | undefined, count?: number | null, prefix?: string): string {
  const head = prefix ? `${prefix} ${ratingNumber(rating)} out of 5` : `Rated ${ratingNumber(rating)} out of 5`
  return count == null ? head : `${head} from ${count.toLocaleString('en-US')} ${count === 1 ? 'rating' : 'ratings'}`
}

/** An average with no ratings behind it shows "No reviews yet" (count 0 or missing average). */
export function hasRatings(count: number | null | undefined): boolean {
  return Number(count) > 0
}

/** A stored notification body that starts with a star line ("★★★★☆ 4 out of 5",
 *  lib/demoFeedbackCore feedbackNotice): its rating, else null. The text stays
 *  stored as it is; the bell draws it with the shared stars. */
export function ratingFromStarBody(body: string | null | undefined): { rating: number; rest: string } | null {
  const m = /^([★☆]{5})\s+(\d(?:\.\d)?) out of 5\s*([\s\S]*)$/.exec((body ?? '').trim())
  if (!m) return null
  const rating = Number(m[2])
  return Number.isFinite(rating) && rating >= 0 && rating <= 5 ? { rating, rest: m[3] ?? '' } : null
}
