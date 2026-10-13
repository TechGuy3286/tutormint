/**
 * scripts/test-school-search.ts — npm run test:schoolsearch
 *
 * School-name search (owner, 13 Oct 2026): a typed school name gets a row
 * linking to the school's page, and is NEVER treated as a subject or added to
 * subjects or search words. Pure rules + source checks — no network, no database.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { knownSchools } from '../lib/schoolJobsCore'
import { matchSchool, schoolRowLabel } from '../lib/schoolSearchCore'
import { subjectMatches, BUILTIN_SUBJECT_WORDS } from '../lib/smartSearchCore'

const read = (p: string) => readFileSync(p, 'utf8')
const known = knownSchools([{ name: 'Aitchison College' }, { name: 'Cadet College Hasanabdal' }])
const name = (q: string) => matchSchool(q, known)?.name ?? null

test('a school name, its short name, or a near-miss is recognised', () => {
  assert.equal(name('Beaconhouse School'), 'Beaconhouse School')
  assert.equal(name('beaconhouse'), 'Beaconhouse School')
  assert.equal(name('  BEACONHOUSE  '), 'Beaconhouse School')
  assert.equal(name('LGS'), 'Lahore Grammar School')
  assert.equal(name('lgs johar town tutor'), 'Lahore Grammar School')
  assert.equal(name('City School'), 'The City School')
  assert.equal(name('the city school'), 'The City School')
  assert.equal(name('Roots'), 'Roots International Schools')
  assert.equal(name('tutor for aitchison'), 'Aitchison College')
  // A typo within a letter or two of a one-word name.
  assert.equal(name('beconhouse'), 'Beaconhouse School')
  assert.equal(matchSchool('beconhouse', known)?.fuzzy, true)
  assert.equal(name('aitchisen'), 'Aitchison College')
})

test('a subject, a city or a stray word is not a school', () => {
  for (const q of ['physics', 'computer', 'maths', 'quran', 'lahore', 'home tutor', 'english grade 5', 'lgsx', 'root', 'city', 'school', 'xy', '']) {
    assert.equal(name(q), null, q)
  }
  // The longest phrase wins, so "lahore grammar school" is not read as a shorter word.
  assert.equal(matchSchool('lahore grammar school', known)?.matched, 'lahore grammar school')
})

test('the row says "Tutors and tuitions for <School>"', () => {
  assert.equal(schoolRowLabel('Beaconhouse School'), 'Tutors and tuitions for Beaconhouse School')
})

test('a school name never matches as a subject, and is never added to subjects or search words', () => {
  // The subject matcher does not know school names…
  for (const q of ['beaconhouse', 'lgs', 'roots']) {
    for (const subject of ['Mathematics', 'English', 'Physics', 'Computer Science', 'Urdu']) assert.equal(subjectMatches(q, subject, []), false, `${q} / ${subject}`)
  }
  // …and no academic subject's search words name a school. (The schools in the
  // taxonomy are the Admission Test Prep entries, which are schools already.)
  for (const slug of ['mathematics', 'english', 'physics', 'chemistry', 'biology', 'computer-science']) {
    const words = (BUILTIN_SUBJECT_WORDS[slug] ?? []).map((w) => w.toLowerCase())
    for (const q of ['beaconhouse', 'lgs', 'roots', 'city school']) assert.ok(!words.includes(q), `${slug} / ${q}`)
  }

  // The school lookup only READS: it writes to no table at all.
  for (const f of ['lib/schoolSearch.ts', 'lib/schoolSearchCore.ts']) {
    const src = read(f)
    assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(src), `${f} writes nothing`)
    assert.ok(!/taxonomy_aliases|taxonomy_subjects|taxonomy_master/.test(src), `${f} never touches subjects or search words`)
  }
  // "Link to school" marks the search; it does not add a search word or a subject.
  const unmet = read('lib/unmetSearches.ts')
  const link = unmet.slice(unmet.indexOf('export async function linkSearchToSchool'), unmet.indexOf('/** The To review cards, each marked'))
  assert.ok(link.includes("kind: 'school'") && !/taxonomy_|addSearchWord|addSubjectFromSearch/.test(link))
})

test('the suggestion is its own "school" row, linking only to a page that exists', () => {
  const route = read('app/api/search/suggest/route.ts')
  assert.ok(route.includes("export type SuggestGroup = 'school' | 'subject' | 'location' | 'tutor' | 'job'"))
  assert.ok(route.includes('if (school?.href) {') && route.includes("group: 'school' as SuggestGroup"))
  // The onboarding subject box reads SUBJECT rows only, so a school row is never offered as a subject.
  assert.ok(read('components/tutor/NewOnboardingFlow.tsx').includes(".filter((x) => x.group === 'subject')"))
  const lib = read('lib/schoolSearch.ts')
  assert.ok(lib.includes('href: group ? schoolHubPath(group.slug) : null'), 'no page, no link')
  // No new page: the row links to the existing school hub route.
  assert.ok(lib.includes("from '@/lib/schoolJobs'"))
  // The Browse tutors results show the row too.
  const browse = read('app/(site)/browse/tutors/page.tsx')
  assert.ok(browse.includes('schoolSuggestionFor(q)') && browse.includes('{school && <SchoolSuggestionRow school={school} />}'))
  assert.ok(read('components/search/Typeahead.tsx').includes("school: 'Schools'"))
})

test('Unmet searches: a school is labelled "School" and gets "Link to school", not "Add as new subject"', () => {
  const ui = read('app/admin/overview/todo-unmet/UnmetSearchesClient.tsx')
  assert.ok(ui.includes('Link to school'))
  assert.ok(ui.includes('onAdd={canAddSubject && !c.schoolMatch ? (name) => void addSubject(c, name) : undefined}'))
  assert.ok(read('app/admin/overview/todo-unmet/page.tsx').includes('withSchoolMatches(board.toReview)'))
  const route = read('app/api/admin/unmet-searches/done/route.ts')
  assert.ok(route.includes("z.enum(['done', 'ignored', 'school'])") && route.includes('checkAdminRole('))
  // Audited, and the database accepts the new kind.
  assert.ok(read('lib/unmetSearches.ts').includes("'search.link_school'"))
  assert.ok(read('supabase/migrations/169_onboarding_email_staff_areas.sql').includes("'subject', 'school'"))
})
