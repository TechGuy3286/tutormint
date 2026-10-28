// scripts/test-job-posting-fields.ts — the Job Posting fields of a tuition
// (owner, 28 Oct 2026; migration 213): employment type, fee per month, area and
// postal code — required on a staff post, optional on a parent's — and the
// JobPosting JSON-LD rules (employmentType always, baseSalary only with a fee,
// postalCode when known).
//
//   npx tsx --test scripts/test-job-posting-fields.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  defaultEmploymentType,
  hasFee,
  parentJobFieldProblem,
  postalCodeProblem,
  resolveEmploymentType,
  staffJobFieldProblem,
} from '../lib/jobFieldsCore'
import { jobPostingEmploymentType, validateJobPosting } from '../lib/jobPostingCore'
import { jobPostingJsonLd } from '../lib/seo'
import { postcodeFor } from '../lib/postcodes'

const OK_STAFF = { employmentType: 'part_time', budgetMin: 10000, budgetMax: 19999, area: 'Johar Town', postalCode: '54000' }

test('staff post: every Job Posting field is required', () => {
  assert.equal(staffJobFieldProblem(OK_STAFF), null)
  assert.match(staffJobFieldProblem({ ...OK_STAFF, employmentType: '' }) ?? '', /employment type/i)
  assert.match(staffJobFieldProblem({ ...OK_STAFF, employmentType: 'freelance' }) ?? '', /employment type/i)
  assert.match(staffJobFieldProblem({ ...OK_STAFF, budgetMin: null, budgetMax: null }) ?? '', /fee per month/i)
  assert.match(staffJobFieldProblem({ ...OK_STAFF, budgetMin: 0, budgetMax: 0 }) ?? '', /fee per month/i, '0 is not a fee')
  assert.match(staffJobFieldProblem({ ...OK_STAFF, area: '  ' }) ?? '', /area/i)
  assert.match(staffJobFieldProblem({ ...OK_STAFF, postalCode: '5400' }) ?? '', /5 digits/)
  assert.match(staffJobFieldProblem({ ...OK_STAFF, postalCode: 'ABCDE' }) ?? '', /5 digits/)
})

test('staff post: an exact amount (min = max) or a one-sided band is a fee; an empty postal code is allowed', () => {
  assert.equal(staffJobFieldProblem({ ...OK_STAFF, budgetMin: 15000, budgetMax: 15000 }), null)
  assert.equal(staffJobFieldProblem({ ...OK_STAFF, budgetMin: 20000, budgetMax: null }), null)
  assert.equal(staffJobFieldProblem({ ...OK_STAFF, budgetMin: null, budgetMax: 4999 }), null)
  assert.equal(staffJobFieldProblem({ ...OK_STAFF, postalCode: '' }), null)
  assert.equal(staffJobFieldProblem({ ...OK_STAFF, postalCode: null }), null)
})

test('parent post: the same fields stay optional', () => {
  assert.equal(parentJobFieldProblem({ postalCode: null }), null)
  assert.equal(parentJobFieldProblem({ postalCode: undefined }), null)
  assert.match(parentJobFieldProblem({ postalCode: '12' }) ?? '', /5 digits/, 'a typed code must still be 5 digits')
  // A parent who leaves the employment type empty gets the Job Type default.
  assert.equal(resolveEmploymentType(null, 'Home Tutor'), 'part_time')
  assert.equal(resolveEmploymentType('', 'Primary Teacher'), 'full_time')
  assert.equal(resolveEmploymentType('contract', 'Home Tutor'), 'contract', 'what was chosen wins')
})

test('employment type default follows the Job Type', () => {
  assert.equal(defaultEmploymentType('Home Tutor'), 'part_time')
  assert.equal(defaultEmploymentType('Online Tutor'), 'part_time')
  assert.equal(defaultEmploymentType(''), 'part_time')
  assert.equal(defaultEmploymentType(null), 'part_time')
  assert.equal(defaultEmploymentType('Primary Teacher'), 'full_time')
  assert.equal(defaultEmploymentType('Principal'), 'full_time')
})

test('JobPosting employmentType: stored value mapped, else derived — never missing', () => {
  assert.equal(jobPostingEmploymentType('part_time', 'Principal'), 'PART_TIME')
  assert.equal(jobPostingEmploymentType('full_time', 'Home Tutor'), 'FULL_TIME')
  assert.equal(jobPostingEmploymentType('contract', null), 'CONTRACTOR')
  assert.equal(jobPostingEmploymentType(null, 'Online Tutor'), 'PART_TIME')
  assert.equal(jobPostingEmploymentType(null, 'O Levels Teacher'), 'FULL_TIME')
})

const base = {
  url: 'https://www.tutormint.org/tuitions/lahore/sample-abc123',
  title: 'Home Tutor Required | Grade 6 | Johar Town | Lahore',
  description: 'A Home Tutor is required for Grade 6 in Johar Town, Lahore. This is a home tuition.',
  datePosted: new Date().toISOString(),
  validThrough: new Date(Date.now() + 10 * 86_400_000).toISOString(),
  city: 'Lahore',
  area: 'Johar Town',
  subjects: ['Mathematics'],
  budgetMin: null as number | null,
  budgetMax: null as number | null,
}

test('JSON-LD: employmentType always present, even when no type is passed', () => {
  const j = jobPostingJsonLd({ ...base, jobTitle: 'Primary Teacher' }) as Record<string, unknown>
  assert.equal(j.employmentType, 'FULL_TIME')
  const h = jobPostingJsonLd({ ...base }) as Record<string, unknown>
  assert.equal(h.employmentType, 'PART_TIME')
  const s = jobPostingJsonLd({ ...base, employmentType: jobPostingEmploymentType('contract', 'Primary Teacher') }) as Record<string, unknown>
  assert.equal(s.employmentType, 'CONTRACTOR')
  assert.deepEqual(validateJobPosting(h).filter((p) => p.field === 'employmentType'), [])
})

test('JSON-LD: baseSalary (PKR, per month) only when a fee exists', () => {
  const none = jobPostingJsonLd({ ...base }) as Record<string, unknown>
  assert.equal(none.baseSalary, undefined)
  const withFee = jobPostingJsonLd({ ...base, budgetMin: 15000, budgetMax: 15000 }) as Record<string, unknown>
  const sal = withFee.baseSalary as { currency: string; value: { minValue: number; maxValue: number; unitText: string } }
  assert.equal(sal.currency, 'PKR')
  assert.equal(sal.value.unitText, 'MONTH')
  assert.deepEqual([sal.value.minValue, sal.value.maxValue], [15000, 15000])
  assert.equal(hasFee(null, null, 0), false)
  assert.equal(hasFee(null, null, 8000), true)
})

const addr = (j: unknown) => ((j as { jobLocation: { address: Record<string, unknown> } }).jobLocation.address)

test('JSON-LD: postalCode — stored wins, else the city lookup, else omitted', () => {
  assert.equal(addr(jobPostingJsonLd({ ...base, postalCode: '54782' })).postalCode, '54782')
  assert.equal(addr(jobPostingJsonLd({ ...base })).postalCode, postcodeFor('Lahore', 'Johar Town'))
  assert.equal(addr(jobPostingJsonLd({ ...base, postalCode: 'bad' })).postalCode, '54000', 'a malformed stored code falls back to the lookup')
  assert.equal('postalCode' in addr(jobPostingJsonLd({ ...base, city: 'Gujranwala', area: null })), false, 'unknown → not emitted')
  assert.equal(postalCodeProblem('54000'), null)
})

test('wiring: staff create/update refuse missing fields before writing; the page passes the stored fields', () => {
  const jobs = readFileSync('lib/jobs.ts', 'utf8')
  assert.equal((jobs.match(/validate\(input\) \?\? staffJobFieldProblem\(input\)/g) ?? []).length, 2, 'createTeamJob and updateTeamJob')
  assert.equal((jobs.match(/validate\(input\) \?\? parentJobFieldProblem\(input\)/g) ?? []).length, 2, 'createJob and updateJob')
  const page = readFileSync('app/(site)/tuitions/[city]/[slug]/page.tsx', 'utf8')
  assert.match(page, /jobPostingEmploymentType\(job\.employment_type/)
  assert.match(page, /postalCode: job\.postal_code/)
  const form = readFileSync('components/forms/PostTuitionForm.tsx', 'utf8')
  assert.match(form, /staffJobFieldProblem\(/)
  assert.match(form, /Employment type/)
})
