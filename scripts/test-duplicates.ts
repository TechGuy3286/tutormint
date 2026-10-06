/**
 * scripts/test-duplicates.ts — the pure rules behind duplicate tuitions,
 * landing-page overlap, SEO limits and the Refresh limit (owner, 6 Oct 2026).
 *
 *   npm run test:duplicates
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { comboKey, duplicateReasons, olderOf, refreshAllowed, shouldMerge, titleJobSegment, type DuplicateFacts } from '../lib/duplicatesCore'
import { overlapNoindexSet } from '../lib/landingOverlapCore'
import { seoTitle, seoDescription, tuitionDescription, TITLE_MAX, DESCRIPTION_MAX, jobPostingJsonLd, tutorJsonLd } from '../lib/seo'

const base: DuplicateFacts = {
  id: 'a',
  title: 'Female Teacher Required | Grade 7 | Lahore',
  city: 'Lahore',
  area: '',
  classLevels: ['Grade 7'],
  masterIds: [10, 11],
  genderPreference: 'female',
  budgetPkr: 10000,
  budgetMinPkr: 10000,
  budgetMaxPkr: 15000,
  createdAt: '2026-09-24T10:00:00Z',
}

test('same title (case/space-insensitive) and same full combination are repeats', () => {
  const b = { ...base, id: 'b', title: 'female teacher  required | grade 7 | lahore', createdAt: '2026-10-02T10:00:00Z' }
  assert.deepEqual(duplicateReasons(base, b), ['same title', 'same combination'])
  const c = { ...base, id: 'c', title: 'Home Tutor Required | Grade 7 | Lahore' }
  assert.deepEqual(duplicateReasons(base, c), ['same combination'])
  const d = { ...base, id: 'd', title: 'Something else', masterIds: [10] }
  assert.deepEqual(duplicateReasons(base, d), [])
  // The combination ignores order of levels/subjects.
  assert.equal(comboKey({ ...base, masterIds: [11, 10] }), comboKey(base))
})

test('a generic title in DIFFERENT areas is not a repeat; the same title in the SAME area is (item 17)', () => {
  const generic = 'Home Tutor Required | Grade 6'
  const johar = { ...base, id: 'j', title: generic, area: 'Johar Town', masterIds: [1], budgetMinPkr: 5000, budgetMaxPkr: 9999 }
  const dha = { ...base, id: 'd', title: generic, area: 'DHA', masterIds: [2], budgetMinPkr: 10000, budgetMaxPkr: 14999 }
  assert.deepEqual(duplicateReasons(johar, dha), [], 'different areas: not flagged')
  assert.equal(shouldMerge(johar, dha).merge, false)
  const joharAgain = { ...johar, id: 'j2', area: 'johar  town', masterIds: [9] }
  assert.deepEqual(duplicateReasons(johar, joharAgain), ['same title'], 'same area (case/space-insensitive): flagged')
  // Same area + level + subjects + gender + budget band is a repeat whatever the titles say.
  const comboTwin = { ...johar, id: 'j3', title: 'Something else entirely' }
  assert.deepEqual(duplicateReasons(johar, comboTwin), ['same combination'])
  // ...and the same combination in a DIFFERENT area is not.
  assert.deepEqual(duplicateReasons(johar, { ...comboTwin, id: 'j4', area: 'Model Town' }), [])
})

test('merge rule: titles match → merge; combination-only with different job titles → skip', () => {
  const sameTitle = { ...base, id: 'b' }
  assert.equal(shouldMerge(base, sameTitle).merge, true)
  const coordinator = { ...base, id: 'c', title: 'Coordinator Required | Karachi' }
  const primary = { ...base, id: 'd', title: 'Primary Teacher Required | Grade 1–5 | Karachi' }
  const r = shouldMerge(coordinator, primary)
  assert.equal(r.merge, false)
  assert.match(r.skipWhy ?? '', /different jobs/)
  // Same job, different area wording → combination match with the same first segment → merge.
  const h1 = { ...base, id: 'e', title: 'Home Tutor Required | Grade 6 | Civil Lines, Karachi' }
  const h2 = { ...base, id: 'f', title: 'Home Tutor Required | Grade 6 | Civil Lines Karachi' }
  assert.equal(shouldMerge(h1, h2).merge, true)
  assert.equal(titleJobSegment('Coordinator Required | Karachi'), 'coordinator required')
  assert.equal(olderOf({ id: 'x', createdAt: '2026-01-02' }, { id: 'y', createdAt: '2026-01-01' }).id, 'y')
})

test('Refresh is allowed at most once every 3 days', () => {
  const now = Date.parse('2026-10-06T12:00:00Z')
  assert.equal(refreshAllowed(null, now).ok, true)
  assert.equal(refreshAllowed('2026-10-05T12:00:00Z', now).ok, false)
  assert.equal(refreshAllowed('2026-10-03T11:00:00Z', now).ok, true)
  assert.equal(refreshAllowed('2026-10-03T13:00:00Z', now).ok, false)
})

test('landing overlap: the narrower of two ≥80%-identical pages is noindex; the broader stays', () => {
  const pages = [
    { kind: 'tutors' as const, citySlug: 'karachi', masterId: 1, ids: ['a', 'b', 'c', 'd', 'e'] },
    { kind: 'tutors' as const, citySlug: 'karachi', masterId: 2, ids: ['a', 'b', 'c', 'd'] }, // 4/4 inside page 1
    { kind: 'tutors' as const, citySlug: 'karachi', masterId: 3, ids: ['a', 'x', 'y', 'z'] }, // 1/4 → fine
    { kind: 'tutors' as const, citySlug: 'lahore', masterId: 2, ids: ['a', 'b', 'c', 'd'] }, // other city
    { kind: 'tutors' as const, citySlug: 'karachi', masterId: 5, ids: ['p', 'q', 'r', 's'] },
    { kind: 'tutors' as const, citySlug: 'karachi', masterId: 4, ids: ['p', 'q', 'r', 's'] }, // identical: the smaller id (4) stays
  ]
  const noindex = overlapNoindexSet(pages)
  assert.deepEqual([...noindex.keys()].sort(), ['tutors/karachi/2', 'tutors/karachi/5'])
  assert.equal(noindex.get('tutors/karachi/2')?.masterId, 1)
  assert.equal(noindex.get('tutors/karachi/5')?.masterId, 4)
})

test('SEO limits: title ≤ 60 (brand only when it fits), description ≤ 155, tuition description from fields only', () => {
  assert.equal(seoTitle('Tuition jobs in Lahore'), 'Tuition jobs in Lahore | TutorMint')
  const long = seoTitle('Female Home Tutor Required | Prep / KG- III | Khyaban-e-Muhafiz, Karachi')
  assert.ok(long.length <= TITLE_MAX, long)
  assert.ok(!long.includes('verified, no commission'))
  assert.ok(!long.includes('| TutorMint'))
  const d = tuitionDescription({ classLevel: 'Grade 5', subjects: ['English', 'Urdu', 'Mathematics', 'Science', 'Islamiat'], area: 'KAECHS', city: 'Karachi', mode: 'Home Tutor', budget: 'Over Rs 20,000 a month' })
  assert.ok(d.length <= DESCRIPTION_MAX, d)
  assert.match(d, /^Grade 5 English, Urdu, Mathematics, Science tuition in KAECHS, Karachi\./)
  assert.ok(!/looking for|experienced/i.test(d), 'never the free text')
  assert.ok(seoDescription('x'.repeat(300)).length <= DESCRIPTION_MAX)
})

test('JobPosting carries identifier and, for online, TELECOMMUTE + Pakistan; Person has jobTitle, Service has name/description', () => {
  const jp = jobPostingJsonLd({
    url: 'https://www.tutormint.org/tuitions/karachi/x-abc123',
    title: 'Online Tutor Required',
    description: 'A description that is long enough to count as a real description of this tuition for the test.',
    datePosted: '2026-10-01T00:00:00Z',
    city: 'Karachi',
    area: null,
    subjects: ['Mathematics'],
    budgetMin: 10000,
    budgetMax: 15000,
    refId: 'TM-1234',
    online: true,
  }) as Record<string, unknown>
  assert.deepEqual(jp.identifier, { '@type': 'PropertyValue', name: 'TutorMint', value: 'TM-1234' })
  assert.equal(jp.jobLocationType, 'TELECOMMUTE')
  assert.deepEqual(jp.applicantLocationRequirements, { '@type': 'Country', name: 'Pakistan' })
  assert.ok(jp.baseSalary, 'baseSalary present when a band exists')
  const noBudget = jobPostingJsonLd({ url: 'u', title: 't', description: 'd', datePosted: '2026-10-01', city: 'Lahore', area: null, subjects: [], budgetMin: null, budgetMax: null, online: false }) as Record<string, unknown>
  assert.equal(noBudget.baseSalary, undefined)
  assert.equal(noBudget.jobLocationType, undefined)
  const graph = tutorJsonLd({ slug: 's', name: 'Ali', headline: null, avatarUrl: null, city: 'Lahore', area: 'DHA', subjects: ['Mathematics', 'Physics'], hourlyRatePkr: null, ratingAvg: null, ratingCount: null }) as { '@graph'?: Record<string, unknown>[] } & Record<string, unknown>
  const nodes = (graph['@graph'] ?? [graph]) as Record<string, unknown>[]
  const person = nodes.find((n) => n['@type'] === 'Person') ?? graph
  const service = nodes.find((n) => n['@type'] === 'Service')
  assert.equal(person.jobTitle, 'Mathematics tutor')
  assert.equal(service?.name, 'Mathematics tutoring in Lahore')
  assert.match(String(service?.description), /Ali teaches Mathematics, Physics in DHA, Lahore/)
})
