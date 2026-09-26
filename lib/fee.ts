// lib/fee.ts
//
// The tutor's monthly fee as a range (PR67), formatted in ONE place so cards, the
// public profile, search and the CV read identically. Reads fall back to the old
// hourly_rate_pkr column, so the code works whether or not fee_min_pkr/fee_max_pkr
// exist yet (deploy-before-migrate safe). PURE — no imports.

export const FEE_MIN_DEFAULT = 5000
export const FEE_MAX_DEFAULT = 100000

type FeeRow = {
  fee_min_pkr?: number | null
  fee_max_pkr?: number | null
  hourly_rate_pkr?: number | null
}

/** The [min, max] range from a row, falling back to hourly_rate_pkr. */
export function feeRange(row: FeeRow): { min: number | null; max: number | null } {
  const pos = (n: unknown): number | null => (typeof n === 'number' && n > 0 ? n : null)
  const one = pos(row.hourly_rate_pkr)
  return { min: pos(row.fee_min_pkr) ?? one, max: pos(row.fee_max_pkr) ?? one }
}

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`

/** "Rs 5,000 – 100,000 / month", "Rs 10,000 / month" when equal, or null. */
export function feeRangeLabel(min: number | null | undefined, max: number | null | undefined): string | null {
  const lo = typeof min === 'number' && min > 0 ? min : null
  const hi = typeof max === 'number' && max > 0 ? max : null
  if (lo && hi) return lo === hi ? `${rs(lo)} / month` : `${rs(lo)} – ${hi.toLocaleString('en-PK')} / month`
  const one = lo ?? hi
  return one ? `${rs(one)} / month` : null
}

/** The fee label straight from a row (range-aware, fallback-safe). */
export function feeLabelOf(row: FeeRow): string | null {
  const { min, max } = feeRange(row)
  return feeRangeLabel(min, max)
}

/** Validate a Min/Max pair (whole rupees, non-negative, min ≤ max). Returns an
 *  English + Urdu error, or null when valid. Used by onboarding and Settings. */
export function validateFeeRange(
  min: number | null,
  max: number | null,
): { en: string; ur: string } | null {
  const bad = (n: number | null) => n === null || !Number.isFinite(n) || n < 0 || !Number.isInteger(n)
  if (bad(min) || bad(max)) {
    return { en: 'Enter your fee in whole rupees.', ur: 'اپنی فیس پورے روپوں میں لکھیں۔' }
  }
  if ((min as number) > (max as number)) {
    return {
      en: 'The minimum can’t be higher than the maximum.',
      ur: 'کم از کم فیس زیادہ سے زیادہ فیس سے زیادہ نہیں ہو سکتی۔',
    }
  }
  return null
}
