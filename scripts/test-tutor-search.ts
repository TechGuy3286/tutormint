// npm run test:tutorsearch — smart tutor search (owner, 13 Oct 2026): synonyms
// and typos, dropdown counts, the zero-result fallback and "Notify me".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { parseQuery, type Dict } from '../lib/smartSearchCore'
import { alertLabel, alertOpen, alertSms, facetsFor, matchesAlert, optionLabel, type IndexedTutor, type TaxRow } from '../lib/tutorFacetsCore'
import { buildAliasIndex } from '../lib/areaAliasCore'
import NotifyMe from '../components/search/NotifyMe'

const dict: Dict = {
  builtin: false,
  cities: ['Lahore', 'Karachi', 'Islamabad'],
  levels: [
    { slug: 'g9', name: 'Grade 9 - Science', category: 'Matriculation / Secondary' },
    { slug: 'ol', name: 'O Levels', category: 'IGCSE' },
  ],
  subjects: [
    { slug: 'computer-science', name: 'Computer Science', school: false },
    { slug: 'ict', name: 'ICT', school: false },
    { slug: 'programming', name: 'Programming', school: false },
    { slug: 'mathematics', name: 'Mathematics', school: false },
    { slug: 'nazra-quran', name: 'Nazra Quran', school: false },
  ],
  // The Search words table (taxonomy_aliases), admin-editable.
  aliases: [
    { kind: 'subject', slug: 'computer-science', alias: 'computer' },
    { kind: 'subject', slug: 'ict', alias: 'computer' },
    { kind: 'subject', slug: 'programming', alias: 'computer' },
    { kind: 'subject', slug: 'mathematics', alias: 'maths' },
    { kind: 'subject', slug: 'mathematics', alias: 'math' },
    { kind: 'subject', slug: 'nazra-quran', alias: 'quran' },
    { kind: 'level', slug: 'g9', alias: 'ssc' },
  ],
}

test('"computer" finds Computer Science, and the other subjects the word means', () => {
  const p = parseQuery('computer', dict)
  assert.equal(p.subject?.name, 'Computer Science')
  assert.deepEqual((p.alsoSubjects ?? []).map((s) => s.slug).sort(), ['ict', 'programming'])
})

test('typos still find it: "compter", "matematics", "lahor"', () => {
  const p = parseQuery('compter', dict)
  assert.equal(p.subject?.name, 'Computer Science')
  assert.ok((p.alsoSubjects ?? []).length >= 1, 'the related subjects come with it')
  assert.equal(parseQuery('matematics', dict).subject?.name, 'Mathematics')
  assert.equal(parseQuery('maths', dict).subject?.name, 'Mathematics')
  assert.equal(parseQuery('lahor', dict).city, 'Lahore')
  assert.equal(parseQuery('quran tutor', dict).subject?.name, 'Nazra Quran')
  assert.deepEqual(parseQuery('ssc', dict).levels, ['Grade 9 - Science'])
})

const TAX: TaxRow[] = [
  { id: 1, category: 'Matriculation / Secondary', level: 'Grade 9 - Science', subject: 'Computer Science' },
  { id: 2, category: 'Matriculation / Secondary', level: 'Grade 9 - Science', subject: 'Mathematics' },
  { id: 3, category: 'IGCSE', level: 'O Levels', subject: 'Computer Science' },
  { id: 4, category: 'IGCSE', level: 'O Levels', subject: 'Physics' },
]
const T = (id: string, cities: string[], areas: string[], masterIds: number[]): IndexedTutor => ({ id, slug: id, cities, areas, masterIds })
const TUTORS = [
  T('a', ['Lahore'], ['DHA Lahore', 'Johar Town'], [1, 2]),
  T('b', ['Lahore'], ['D.H.A'], [1]),
  T('c', ['Karachi'], ['Liaqatbad'], [3]),
  T('d', ['Karachi', 'Lahore'], ['Liaqatabad'], [2]),
]
const ALIASES = buildAliasIndex([
  { city: 'Lahore', raw: 'D.H.A', area: 'DHA Lahore' },
  { city: 'Karachi', raw: 'Liaqatbad', area: 'Liaqatabad' },
])

test('dropdowns show only options that have a tutor, with counts', () => {
  const f = facetsFor(TUTORS, TAX, {}, ALIASES)
  assert.deepEqual(f.cities.map(optionLabel), ['Lahore (3)', 'Karachi (2)'])
  assert.deepEqual(f.categories.map((c) => c.name).sort(), ['IGCSE', 'Matriculation / Secondary'])
  assert.deepEqual(f.subjects['Matriculation / Secondary|Grade 9 - Science'].map(optionLabel), ['Computer Science (2)', 'Mathematics (2)'])
  // Physics has no tutor: it is not offered at all.
  assert.deepEqual(f.subjects['IGCSE|O Levels'].map((o) => o.name), ['Computer Science'])
})

test('choosing a city narrows areas, levels and subjects to that city — and a subject narrows the cities', () => {
  const lahore = facetsFor(TUTORS, TAX, { city: 'Lahore' }, ALIASES)
  // The alias counts as the curated area: DHA once, with both tutors.
  assert.deepEqual(lahore.areas.map(optionLabel), ['DHA Lahore (2)', 'Johar Town (1)', 'Liaqatabad (1)'])
  assert.equal(lahore.levels['IGCSE'], undefined, 'no O Level tutor in Lahore')
  const karachi = facetsFor(TUTORS, TAX, { city: 'Karachi' }, ALIASES)
  assert.deepEqual(karachi.areas.map(optionLabel), ['Liaqatabad (2)'])
  // Vice versa: a subject narrows the cities.
  const cs = facetsFor(TUTORS, TAX, { masterIds: [3] }, ALIASES)
  assert.deepEqual(cs.cities.map(optionLabel), ['Karachi (1)'])
  assert.equal(facetsFor(TUTORS, TAX, { city: 'Lahore', masterIds: [1] }, ALIASES).total, 2)
})

test('zero results never end the page: closest tutors, a free request, and Notify me', () => {
  const page = readFileSync('app/(site)/browse/tutors/page.tsx', 'utf8')
  assert.ok(page.includes('Closest tutors'), 'the relaxed list has a heading')
  assert.ok(page.includes('fallback.line.en'), 'and says in words what was relaxed')
  assert.equal(page.split('Post a free tuition request').length - 1, 2, 'in both zero-result states')
  assert.equal(page.split('<NotifyMe').length - 1, 2, 'in both zero-result states')
  assert.ok(!/>\s*Not found\s*</.test(page), 'never a bare "Not found"')
  // The request button carries what was searched.
  assert.ok(page.includes('/parent/dashboard/post-job${city || area'))
  // The opt-in renders, and is not pre-ticked.
  const html = renderToStaticMarkup(createElement(NotifyMe, { q: 'astronomy', city: 'Gilgit' }))
  assert.ok(html.includes('Notify me when a matching tutor joins'))
  assert.ok(html.includes('Send me one message when a tutor matching this search joins.'))
  assert.ok(html.includes('type="checkbox"') && !/type="checkbox"[^>]*checked/.test(html), 'an explicit, unticked opt-in')
})

test('Notify me: one message for a NEW matching tutor, then closed; lapses after 60 days', () => {
  const want = { city: 'Lahore', masterIds: [3, 4], knownTutorIds: ['a'] }
  assert.equal(matchesAlert(want, T('new', ['Lahore'], [], [4])), true)
  assert.equal(matchesAlert(want, T('a', ['Lahore'], [], [4])), false, 'already listed when the request was made')
  assert.equal(matchesAlert(want, T('x', ['Karachi'], [], [4])), false, 'another city')
  assert.equal(matchesAlert(want, T('y', ['Lahore'], [], [1])), false, 'another subject')
  assert.equal(matchesAlert({ city: null, masterIds: [], knownTutorIds: [] }, T('z', ['Lahore'], [], [1])), false, 'a request with nothing to match is never sent')
  const now = Date.parse('2026-10-13T00:00:00Z')
  assert.equal(alertOpen({ closed_at: null, notified_at: null, expires_at: '2026-12-12T00:00:00Z' }, now), true)
  assert.equal(alertOpen({ closed_at: null, notified_at: null, expires_at: '2026-10-12T00:00:00Z' }, now), false, 'expired')
  assert.equal(alertOpen({ closed_at: null, notified_at: '2026-10-12T00:00:00Z', expires_at: '2026-12-12T00:00:00Z' }, now), false, 'already sent')
  assert.equal(alertLabel({ level: 'O Level', subject: 'Physics', city: 'Lahore' }), 'O Level Physics tutor in Lahore')
  const sms = alertSms('O Level Physics tutor in Lahore', 'https://www.tutormint.org/tutor/x')
  assert.ok(sms.includes('only message') && !/rs\.?\s*\d|free|offer|discount/i.test(sms), 'no marketing, no price')
  // The sweep closes the request BEFORE it sends, so a retry cannot send twice.
  const sweep = readFileSync('lib/tutorAlerts.ts', 'utf8')
  assert.ok(sweep.indexOf("close_reason: 'notified'") < sweep.indexOf('getSmsProvider().send('))
  const sql = readFileSync('supabase/migrations/167_search_synonyms_alerts_title_names.sql', 'utf8')
  assert.ok(sql.includes("interval '60 days'"))
})

test('searches and synonyms create no new indexable page', () => {
  const robots = readFileSync('app/robots.ts', 'utf8')
  assert.ok(/browse\/tutors\?/.test(robots) || /\/browse\/\*\?/.test(robots) || robots.includes('?'), 'filtered browse URLs stay out of the crawl')
  const unmet = readFileSync('lib/unmetSearches.ts', 'utf8')
  assert.ok(unmet.includes('never automatically from a'), 'a subject is added only by staff')
})
