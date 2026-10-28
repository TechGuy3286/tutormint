// lib/jobFieldsCore.ts
//
// The Job Posting fields of a tuition (owner, 28 Oct 2026; migration 213):
// employment type, fee per month, area and postal code. PURE — the shared form,
// lib/jobs (create/update), the JSON-LD and the tests read the same rules.
//
//   Staff posts (createTeamJob / updateTeamJob) REQUIRE an employment type, a
//   fee (a band or an exact amount, never empty or 0) and an area; a postal
//   code, when given, is five digits. Parents keep every one of these optional:
//   their employment type is derived from the Job Type when they leave it empty.

import { isTuitionTitle } from '@/lib/jobPostingCore'

export type EmploymentTypeValue = 'part_time' | 'full_time' | 'contract'

export const EMPLOYMENT_TYPES: { value: EmploymentTypeValue; label: string }[] = [
  { value: 'part_time', label: 'Part-time' },
  { value: 'full_time', label: 'Full-time' },
  { value: 'contract', label: 'Contract' },
]

export function isEmploymentType(v: unknown): v is EmploymentTypeValue {
  return v === 'part_time' || v === 'full_time' || v === 'contract'
}

/** The default employment type for a Job Type: a home or online tuition is
 *  part-time, any other title (a school or academy post) is full-time. */
export function defaultEmploymentType(jobTitle: string | null | undefined): EmploymentTypeValue {
  return isTuitionTitle(jobTitle) ? 'part_time' : 'full_time'
}

/** The employment type to store: the one given, else the default. */
export function resolveEmploymentType(given: string | null | undefined, jobTitle: string | null | undefined): EmploymentTypeValue {
  return isEmploymentType(given) ? given : defaultEmploymentType(jobTitle)
}

/** Five digits, or empty. */
export function cleanPostalCode(v: string | null | undefined): string | null {
  const s = (v ?? '').replace(/\s+/g, '')
  return s === '' ? null : s
}

export function postalCodeProblem(v: string | null | undefined): string | null {
  const s = cleanPostalCode(v)
  if (s === null) return null
  return /^[0-9]{5}$/.test(s) ? null : 'The postal code must be 5 digits, e.g. 54000.'
}

/** A tuition has a fee when its band or amount carries a figure above 0. */
export function hasFee(min: number | null | undefined, max: number | null | undefined, budgetPkr?: number | null): boolean {
  return [min, max, budgetPkr].some((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
}

/**
 * The first missing or invalid Job Posting field on a STAFF post, or null.
 * Checked before anything is written.
 */
export function staffJobFieldProblem(input: {
  employmentType?: string | null
  budgetMin?: number | null
  budgetMax?: number | null
  area?: string | null
  postalCode?: string | null
}): string | null {
  if (!isEmploymentType(input.employmentType)) return 'Choose the employment type (Part-time, Full-time or Contract).'
  if (!hasFee(input.budgetMin, input.budgetMax)) return 'Enter the fee per month: choose a range or type the exact amount.'
  if (!(input.area ?? '').trim()) return 'Enter the area.'
  return postalCodeProblem(input.postalCode)
}

/** A parent's post: the same fields are optional; only a postal code, when one
 *  is typed, must be five digits. */
export function parentJobFieldProblem(input: { postalCode?: string | null }): string | null {
  return postalCodeProblem(input.postalCode)
}
