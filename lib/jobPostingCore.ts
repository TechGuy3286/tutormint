// lib/jobPostingCore.ts
//
// The parts of a tuition's JobPosting that are RULES rather than markup (owner,
// 12 Oct 2026): what kind of work it is, the plain-text description built from
// the tuition's own fields, and a validator that checks a finished JobPosting
// against the fields Google requires and recommends. Pure — no imports from the
// server — so the page, the tests and the audit script read the same rules.

import { ONLINE_JOB_TITLE } from '@/lib/jobTitlesCore'

export const HOME_JOB_TITLE = 'Home Tutor'

/** A tuition (home or online) as opposed to a post at a school or academy. */
export function isTuitionTitle(jobTitle: string | null | undefined): boolean {
  const t = (jobTitle ?? '').trim()
  return t === '' || t === HOME_JOB_TITLE || t === ONLINE_JOB_TITLE
}

export type EmploymentType = 'PART_TIME' | 'FULL_TIME' | 'CONTRACTOR'

/**
 * JobPosting.employmentType.
 *
 * A home or online tuition is PART_TIME — a few hours a week, which is what the
 * word means to someone searching Google Jobs. A school post says what it is
 * only when the post's own words say so ("part time", "visiting", "full time",
 * "contract"); otherwise NOTHING is claimed and the field is left out (it is a
 * recommended field, not a required one). Never guessed.
 */
export function employmentTypeFor(job: { jobTitle: string | null; title?: string | null; description?: string | null }): EmploymentType | null {
  if (isTuitionTitle(job.jobTitle)) return 'PART_TIME'
  const text = `${job.jobTitle ?? ''} ${job.title ?? ''} ${job.description ?? ''}`.toLowerCase()
  if (/\bpart[\s-]?time\b|\bvisiting\b/.test(text)) return 'PART_TIME'
  if (/\bfull[\s-]?time\b/.test(text)) return 'FULL_TIME'
  if (/\bcontract(ual)?\b/.test(text)) return 'CONTRACTOR'
  return null
}

/**
 * JobPosting.employmentType — ALWAYS present (owner, 28 Oct 2026; migration 213
 * gave every tuition a stored jobs.employment_type). The stored value wins:
 * part_time → PART_TIME, full_time → FULL_TIME, contract → CONTRACTOR. A row
 * with none (not expected after the backfill) falls back to the Job Type: a
 * home or online tuition is PART_TIME, any other title FULL_TIME.
 * employmentTypeFor (above) is the older words-only rule, kept for callers that
 * read a post's own text.
 */
export function jobPostingEmploymentType(stored: string | null | undefined, jobTitle: string | null | undefined): EmploymentType {
  if (stored === 'part_time') return 'PART_TIME'
  if (stored === 'full_time') return 'FULL_TIME'
  if (stored === 'contract') return 'CONTRACTOR'
  return isTuitionTitle(jobTitle) ? 'PART_TIME' : 'FULL_TIME'
}

function list(items: string[]): string {
  const xs = items.filter(Boolean)
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/**
 * The JobPosting description: at least two plain sentences built ONLY from the
 * tuition's own fields — Job Type, level, subjects, area and city, timing,
 * gender preference, mode and budget — followed by what the poster wrote, when
 * they wrote something. Nothing is invented; a field that is empty is left out
 * together with its sentence.
 */
export function jobPostingDescription(job: {
  jobTitle: string | null
  level: string | null
  subjects: string[]
  area: string | null
  city: string | null
  timing: string | null
  genderWord: string | null
  budgetLabel: string | null
  schoolName?: string | null
  freeText?: string | null
}): string {
  const online = (job.jobTitle ?? '').trim() === ONLINE_JOB_TITLE
  const tuition = isTuitionTitle(job.jobTitle)
  const role = (job.jobTitle ?? '').trim() || HOME_JOB_TITLE
  const subjects = job.subjects.filter(Boolean).slice(0, 8)
  const where = [job.area, job.city].map((s) => (s ?? '').trim()).filter(Boolean)
  const place = where.length ? where.join(', ') : 'Pakistan'

  const first =
    `${/^[aeiou]/i.test(role) ? 'An' : 'A'} ${role} is required` +
    (job.schoolName ? ` at ${job.schoolName}` : '') +
    (job.level ? ` for ${job.level}` : '') +
    (subjects.length ? `, teaching ${list(subjects)}` : '') +
    (online ? `. Lessons are online, for a family in ${place}.` : ` in ${place}.`)

  const mode = online
    ? 'This is an online tuition, taught from home anywhere in Pakistan.'
    : tuition
      ? `This is a home tuition, taught in person at the family's home${job.area ? ` in ${job.area}` : ''}.`
      : `This is a teaching post at a school or academy${job.city ? ` in ${job.city}` : ''}.`

  const parts = [
    first,
    mode,
    job.timing ? `Timing: ${job.timing.trim().replace(/[.\s]+$/, '')}.` : '',
    job.genderWord ? `A ${job.genderWord.toLowerCase()} teacher is preferred.` : '',
    job.budgetLabel ? `${tuition ? 'Budget' : 'Salary'}: ${job.budgetLabel} a month.` : '',
    'Apply on TutorMint — free to join, no commission.',
  ].filter(Boolean)

  const free = (job.freeText ?? '').replace(/\s+/g, ' ').trim()
  return free ? `${parts.join(' ')} ${free}` : parts.join(' ')
}

/** How many sentences a piece of plain text has (a rough, honest count). */
export function sentenceCount(text: string): number {
  return text.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim().length > 3).length
}

export type JobPostingProblem = { field: string; level: 'required' | 'recommended'; problem: string }

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const isDate = (v: unknown): boolean => typeof v === 'string' && !Number.isNaN(new Date(v).getTime())

/**
 * Check a JobPosting against Google's job-posting fields.
 * Required: title, description, datePosted, hiringOrganization (with a name),
 * jobLocation with an address — or, for remote work, jobLocationType
 * TELECOMMUTE with applicantLocationRequirements.
 * Recommended: validThrough, employmentType, baseSalary, directApply,
 * identifier, and the address parts (addressLocality, addressRegion,
 * addressCountry).
 * An empty list means nothing is missing or invalid.
 */
export function validateJobPosting(j: unknown, now = Date.now()): JobPostingProblem[] {
  const out: JobPostingProblem[] = []
  const need = (field: string, problem: string) => out.push({ field, level: 'required', problem })
  const want = (field: string, problem: string) => out.push({ field, level: 'recommended', problem })
  const p = obj(j)
  if (!p || p['@type'] !== 'JobPosting') return [{ field: '@type', level: 'required', problem: 'not a JobPosting' }]

  if (!str(p.title)) need('title', 'missing')
  const desc = str(p.description)
  if (!desc) need('description', 'missing')
  else if (sentenceCount(desc) < 2) need('description', 'shorter than two sentences')
  if (!isDate(p.datePosted)) need('datePosted', 'missing or not a date')

  const org = obj(p.hiringOrganization)
  if (!org || !str(org.name)) need('hiringOrganization', 'missing a name')

  const remote = p.jobLocationType === 'TELECOMMUTE'
  const loc = obj(p.jobLocation)
  const addr = loc ? obj(loc.address) : null
  if (!addr && !remote) need('jobLocation', 'missing an address')
  if (remote && !obj(p.applicantLocationRequirements)) need('applicantLocationRequirements', 'missing for a remote job')
  if (addr) {
    if (!str(addr.addressCountry)) need('jobLocation.address.addressCountry', 'missing')
    if (!str(addr.addressLocality)) want('jobLocation.address.addressLocality', 'missing')
    if (!str(addr.addressRegion)) want('jobLocation.address.addressRegion', 'missing')
  }

  if (!isDate(p.validThrough)) want('validThrough', 'missing or not a date')
  else if (new Date(p.validThrough as string).getTime() < now) need('validThrough', 'in the past — the posting reads as expired')
  else if (isDate(p.datePosted) && new Date(p.validThrough as string) < new Date(p.datePosted as string)) need('validThrough', 'before datePosted')

  const et = p.employmentType
  const ALLOWED = ['FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'TEMPORARY', 'INTERN', 'VOLUNTEER', 'PER_DIEM', 'OTHER']
  if (et == null) want('employmentType', 'missing')
  else if (![et].flat().every((v) => ALLOWED.includes(String(v)))) need('employmentType', `not one of Google's values: ${String(et)}`)

  const salary = obj(p.baseSalary)
  if (!salary) want('baseSalary', 'missing')
  else {
    const value = obj(salary.value)
    if (!str(salary.currency)) need('baseSalary.currency', 'missing')
    if (!value || !str(value.unitText)) need('baseSalary.value.unitText', 'missing')
    const hasOne = value && typeof value.value === 'number'
    const hasRange = value && typeof value.minValue === 'number' && typeof value.maxValue === 'number'
    if (!hasOne && !hasRange) need('baseSalary.value', 'needs a value, or both minValue and maxValue')
  }

  if (p.directApply !== true && p.directApply !== false) want('directApply', 'missing')
  const id = obj(p.identifier)
  if (!id || !str(id.value)) want('identifier', 'missing')
  return out
}
