/**
 * scripts/test-duplicates.ts — the pure rules behind duplicate tuitions,
 * landing-page overlap, SEO limits and the Refresh limit (owner, 6 Oct 2026).
 *
 *   npm run test:duplicates
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DUPLICATE_WINDOW_DAYS, comboKey, duplicateReasons, legacyDuplicateReasons, olderOf, refreshAllowed, sameRequirement, shouldMerge, titleJobSegment, type DuplicateFacts } from '../lib/duplicatesCore'
import { overlapNoindexSet } from '../lib/landingOverlapCore'
import { seoTitle, seoDescription, tuitionDescription, TITLE_MAX, DESCRIPTION_MAX, jobPostingJsonLd, tutorProfileJsonLd } from '../lib/seo'

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

// A repeat is the SAME REQUIREMENT (owner, 13 Oct 2026): place, levels,
// overlapping subjects, Job Type, contact number, within 30 days.
const b0: DuplicateFacts = { ...base, jobType: 'Home Tutor', contact: '923001234567' }

test('a true repost — same contact, same requirement — is a repeat, whatever the budget or wording', () => {
  const repost = { ...b0, id: 'b', title: 'female teacher  required | grade 7 | lahore', createdAt: '2026-10-02T10:00:00Z' }
  assert.deepEqual(duplicateReasons(b0, repost), ['same title', 'same combination'])
  // A new title, a changed budget and only one subject in common: still the same requirement.
  const reworded = { ...repost, id: 'c', title: 'Home Tutor Required | Grade 7 | Lahore', masterIds: [11, 99], budgetMinPkr: 20000, budgetMaxPkr: null, genderPreference: null }
  assert.deepEqual(duplicateReasons(b0, reworded), ['same combination'])
  assert.equal(sameRequirement(b0, reworded), true)
  assert.equal(shouldMerge(b0, repost).merge, true)
})

test('each field of the rule, alone, stops a match', () => {
  const twin = { ...b0, id: 'b', createdAt: '2026-10-02T10:00:00Z' }
  assert.equal(sameRequirement(b0, twin), true)
  assert.equal(sameRequirement(b0, { ...twin, contact: '923009999999' }), false, 'a different contact number is never a duplicate')
  assert.equal(sameRequirement(b0, { ...twin, contact: null }), false, 'an unknown number cannot be called the same')
  assert.equal(sameRequirement({ ...b0, contact: null }, { ...twin, contact: null }), false)
  assert.equal(sameRequirement(b0, { ...twin, jobType: 'Online Tutor' }), false, 'a different job title')
  assert.equal(sameRequirement(b0, { ...twin, city: 'Karachi' }), false)
  assert.equal(sameRequirement(b0, { ...twin, area: 'DHA' }), false, 'one has an area, the other none')
  assert.equal(sameRequirement({ ...b0, area: 'johar  town' }, { ...twin, area: 'Johar Town' }), true)
  assert.equal(sameRequirement(b0, { ...twin, classLevels: ['Grade 7', 'Grade 8'] }), false, 'a different grade set')
  assert.equal(sameRequirement(b0, { ...twin, masterIds: [50, 51] }), false, 'no subject in common')
  assert.equal(sameRequirement({ ...b0, masterIds: [] }, { ...twin, masterIds: [] }), true, 'neither has subjects')
  assert.equal(sameRequirement(b0, { ...twin, createdAt: '2026-10-24T10:00:00Z' }), true, '30 days apart')
  assert.equal(sameRequirement(b0, { ...twin, createdAt: '2026-10-25T10:00:00Z' }), false, '31 days apart')
  assert.equal(DUPLICATE_WINDOW_DAYS, 30)
})

test('the wrong-canonical examples: TM-1250 and TM-1253 are not repeats of TM-1172; TM-1245 IS a repost of TM-1215', () => {
  // TM-1172, TM-1250, TM-1253: one city, no area, the same Grade 1–5 subject
  // list and budget — which is all the old rule compared.
  const grades = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5']
  const shared = { city: 'Karachi', area: '', classLevels: grades, masterIds: [3258, 3259, 3260, 3261], genderPreference: null, budgetPkr: 20000, budgetMinPkr: 20000, budgetMaxPkr: null }
  const tm1172: DuplicateFacts = { ...shared, id: '1172', title: 'Online Tutor Required | Grade 1–5 | Karachi', jobType: 'Online Tutor', contact: '923000000001', createdAt: '2026-09-23T10:00:00Z' }
  const tm1250: DuplicateFacts = { ...shared, id: '1250', title: 'Coordinator Required | Karachi', jobType: 'Co-ordinator / Section Head', contact: '923000000002', createdAt: '2026-09-26T10:00:00Z' }
  const tm1253: DuplicateFacts = { ...shared, id: '1253', title: 'Primary Teacher Required | Grade 1–5 | Karachi', jobType: 'Primary Teacher', contact: '923000000002', createdAt: '2026-09-26T11:00:00Z' }
  assert.deepEqual(legacyDuplicateReasons(tm1250, tm1172), ['same combination'], 'what the old rule did')
  assert.deepEqual(legacyDuplicateReasons(tm1253, tm1172), ['same combination'])
  assert.deepEqual(duplicateReasons(tm1250, tm1172), [])
  assert.deepEqual(duplicateReasons(tm1253, tm1172), [])
  // Two posts from one number for different jobs are not repeats either.
  assert.deepEqual(duplicateReasons(tm1253, tm1250), [])

  // TM-1245 / TM-1215: the same number, Grade 1, the same three subjects, Online
  // Tutor, one day apart — the same requirement posted twice.
  const g1 = { city: 'Karachi', area: '', classLevels: ['Grade 1'], masterIds: [3258, 3259, 3260], genderPreference: null, budgetPkr: 20000, budgetMinPkr: 20000, budgetMaxPkr: null, jobType: 'Online Tutor', contact: '923000000003' }
  const tm1215: DuplicateFacts = { ...g1, id: '1215', title: 'Online Tutor Required for Primary class -( Grade 1 ) -Karachi', createdAt: '2026-09-25T10:00:00Z' }
  const tm1245: DuplicateFacts = { ...g1, id: '1245', title: 'Male / Female Online Tutor (Grade 1 ) - Karachi.', createdAt: '2026-09-26T10:00:00Z' }
  assert.deepEqual(duplicateReasons(tm1245, tm1215), ['same combination'])
})

test('merge rule: only a real repeat merges', () => {
  const coordinator = { ...b0, id: 'c', title: 'Coordinator Required | Karachi' }
  const primary = { ...b0, id: 'd', title: 'Primary Teacher Required | Grade 1–5 | Karachi' }
  const r = shouldMerge(coordinator, primary)
  assert.equal(r.merge, false)
  assert.match(r.skipWhy ?? '', /different jobs/)
  assert.equal(shouldMerge(b0, { ...b0, id: 'x', contact: '923009999999' }).skipWhy, 'not a repeat')
  assert.equal(titleJobSegment('Coordinator Required | Karachi'), 'coordinator required')
  assert.equal(olderOf({ id: 'x', createdAt: '2026-01-02' }, { id: 'y', createdAt: '2026-01-01' }).id, 'y')
  // The old combination key still ignores the order of levels and subjects.
  assert.equal(comboKey({ ...base, masterIds: [11, 10] }), comboKey(base))
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
  // The tutor profile is a ProfilePage + Person now (owner, 13 Oct 2026): no
  // Service, no fee, no rating.
  const graph = tutorProfileJsonLd({ slug: 's', name: 'Ali', avatarUrl: null, city: 'Lahore', areas: ['DHA'], subjects: ['Mathematics', 'Physics'], levels: ['O Levels'] }) as { '@graph': Record<string, unknown>[] }
  const person = graph['@graph'].find((n) => n['@type'] === 'Person')!
  assert.equal(person.jobTitle, 'Tutor')
  assert.deepEqual(person.knowsAbout, ['Mathematics', 'Physics', 'O Levels'])
  assert.equal(graph['@graph'].some((n) => n['@type'] === 'Service'), false)
})
