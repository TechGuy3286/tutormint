// npm run test:searchwords — everyday search words read as filters, and the
// 24 Oct "English" search (owner, 28 Oct 2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseQuery, understood, typedSubjectWins, withoutSpan, intentFilters, type Dict } from '../lib/smartSearchCore'

const dict: Dict = {
  cities: ['Lahore', 'Karachi', 'Islamabad'],
  levels: [1, 2, 3, 4, 5, 6, 7, 8].map((g) => ({ slug: `g${g}`, name: `Grade ${g}`, category: g <= 5 ? 'Primary' : 'Middle' })),
  subjects: [
    { slug: 'english', name: 'English' },
    { slug: 'mathematics', name: 'Mathematics' },
    { slug: 'x80s-ielts-preparation', name: 'IELTS Preparation' },
  ],
  aliases: [],
}

test('"online" is the Online Tutor job type, not an unknown word', () => {
  for (const q of ['online', 'Online', 'online jobs', 'online tuition', 'Online all']) {
    const p = parseQuery(q, dict)
    assert.equal(p.mode, 'Online Tutor', q)
    assert.ok(understood(p), q)
    assert.equal(p.leftover, '', q)
  }
})

test('"home" is Home tutor', () => {
  assert.equal(parseQuery('home tutor lahore', dict).mode, 'Home Tutor')
  assert.equal(parseQuery('home tuition', dict).mode, 'Home Tutor')
  assert.equal(parseQuery('home tutor lahore', dict).city, 'Lahore')
})

test('evening / morning / afternoon are the time of day', () => {
  assert.equal(parseQuery('Evening', dict).timing, 'evening')
  assert.equal(parseQuery('morning maths', dict).timing, 'morning')
  assert.equal(parseQuery('morning maths', dict).subject?.name, 'Mathematics')
  assert.equal(parseQuery('afternoon', dict).timing, 'afternoon')
  assert.ok(understood(parseQuery('evening', dict)))
})

test('jobs / job / vacancy mean tuition jobs', () => {
  for (const q of ['jobs', 'job', 'vacancy', 'tuition jobs lahore']) {
    assert.equal(parseQuery(q, dict).jobs, true, q)
  }
  assert.equal(parseQuery('tuition jobs lahore', dict).city, 'Lahore')
})

test('overseas / uae / dubai / saudi / abroad mean online, student abroad', () => {
  for (const q of ['online uae', 'Online overseas', 'dubai', 'saudi', 'abroad', 'english tutor uae']) {
    const f = intentFilters(parseQuery(q, dict))
    assert.equal(f.mode, 'Online Tutor', q)
    assert.equal(f.abroad, true, q)
  }
  // One chip says both; removing it removes every word it came from.
  const p = parseQuery('online uae', dict)
  assert.equal(p.spans.filter((s) => s.kind === 'mode').length, 1)
  assert.equal(withoutSpan('online uae', p.spans[0].text), '')
})

test('a grade range names every grade in it', () => {
  const p = parseQuery('Grade 1-5 tuition in Islamabad evening', dict)
  assert.deepEqual(p.levels, ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'])
  assert.equal(p.city, 'Islamabad')
  assert.equal(p.timing, 'evening')
  assert.deepEqual(parseQuery('class 6 to 8', dict).levels, ['Grade 6', 'Grade 7', 'Grade 8'])
})

test('a chip × for a filter word keeps the rest of the search', () => {
  const p = parseQuery('online english lahore', dict)
  const online = p.spans.find((s) => s.kind === 'mode')!
  assert.equal(withoutSpan('online english lahore', online.text), 'english lahore')
})

test('the "English" case: typed subject wins over a different dropdown subject', () => {
  // 24 Oct 2026: subject=4208 (IELTS Preparation · All Tests) + q=English → 0.
  const englishMasters = [3114, 3162, 3258, 3315]
  assert.equal(typedSubjectWins(englishMasters, 4208), true)
  // The picked subject is one of the typed ones → keep the narrower pick.
  assert.equal(typedSubjectWins(englishMasters, 3258), false)
  // Words that name no subject never override the dropdown.
  assert.equal(typedSubjectWins(null, 4208), false)
  assert.equal(typedSubjectWins([], 4208), false)
  assert.equal(typedSubjectWins(englishMasters, null), false)
  assert.equal(parseQuery('English', dict).subject?.slug, 'english')
})

test('both list loaders apply the rule, so first page and Load more agree', () => {
  for (const f of ['lib/jobFeed.ts', 'lib/browseTutors.ts']) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /reconcileSubjectQuery\(filters\.masterId, filters\.q\)/, f)
  }
  const feed = readFileSync('lib/jobFeed.ts', 'utf8')
  assert.match(feed, /q\.eq\('teaching_mode', smartMode\)/)
  assert.match(feed, /timings\.ilike/)
})
