// npm run test:smartsearch — the pure smart-search parser (owner, 8 Oct 2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseQuery, withoutSpan, broaderSubject, nearestLevels, subjectMatches, type Dict } from '../lib/smartSearchCore'

const dict: Dict = {
  cities: ['Lahore', 'Karachi', 'Faisalabad', 'Sahiwal', 'Islamabad'],
  levels: [
    { slug: 'x80g-4', name: 'Grade 1', category: 'Primary' },
    { slug: 'x80g-5', name: 'Grade 2', category: 'Primary' },
    { slug: 'x80g-6', name: 'Grade 3', category: 'Primary' },
    { slug: 'x80g-7', name: 'Grade 4', category: 'Primary' },
    { slug: 'x80g-8', name: 'Grade 5', category: 'Primary' },
    { slug: 'x80g-12', name: 'Grade 9 - Arts', category: 'Matriculation / Secondary' },
    { slug: 'x80g-14', name: 'Grade 9 - Science', category: 'Matriculation / Secondary' },
    { slug: 'x80g-13', name: 'Grade 10 - Arts', category: 'Matriculation / Secondary' },
    { slug: 'x80g-15', name: 'Grade 10 - Science', category: 'Matriculation / Secondary' },
    { slug: 'x80g-17', name: 'O Levels', category: 'IGCSE' },
    { slug: 'x80g-20', name: 'FSC Part I & Part II', category: 'Intermediate' },
  ],
  subjects: [
    { slug: 'mathematics', name: 'Mathematics' },
    { slug: 'additional-mathematics', name: 'Additional Mathematics' },
    { slug: 'physics', name: 'Physics' },
    { slug: 'english', name: 'English' },
    { slug: 'art-and-drawing', name: 'Art & Drawing' },
    { slug: 'computer-science', name: 'Computer Science' },
    { slug: 'beaconhouse-school', name: 'Beaconhouse School', school: true },
    { slug: 'lahore-grammar-school', name: 'Lahore Grammar School', school: true },
  ],
  aliases: [{ kind: 'level', slug: 'x80g-20', alias: 'fsc' }],
}

test('short forms and Roman Urdu', () => {
  assert.equal(parseQuery('math', dict).subject?.name, 'Mathematics')
  assert.equal(parseQuery('maths', dict).subject?.name, 'Mathematics')
  assert.equal(parseQuery('hisab', dict).subject?.name, 'Mathematics')
  assert.equal(parseQuery('angrezi', dict).subject?.name, 'English')
  assert.equal(parseQuery('cs', dict).subject?.name, 'Computer Science')
  assert.equal(parseQuery('lgs', dict).school?.name, 'Lahore Grammar School')
  assert.deepEqual(parseQuery('matric', dict).levels.sort(), ['Grade 10 - Arts', 'Grade 10 - Science', 'Grade 9 - Arts', 'Grade 9 - Science'])
  assert.deepEqual(parseQuery('fsc', dict).levels, ['FSC Part I & Part II'])
})

test('typos tolerated', () => {
  assert.equal(parseQuery('mathmatics', dict).subject?.name, 'Mathematics')
  assert.equal(parseQuery('fizics', dict).subject?.name, 'Physics')
  assert.equal(parseQuery('phisics', dict).subject?.name, 'Physics')
  assert.equal(parseQuery('beacchon', dict).school?.name, 'Beaconhouse School')
})

test('a full sentence becomes city · level · school', () => {
  const p = parseQuery('sahiwal tutor for primary school beacchon house', dict)
  assert.equal(p.city, 'Sahiwal')
  assert.equal(p.levelLabel, 'Primary')
  assert.deepEqual(p.levels, ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'])
  assert.equal(p.school?.name, 'Beaconhouse School')
  assert.equal(p.subject, null) // never Art & Drawing
  assert.deepEqual(p.spans.map((s) => s.kind).sort(), ['city', 'level', 'school'])
})

test('a chip × removes only its words', () => {
  assert.equal(withoutSpan('sahiwal tutor for primary', 'sahiwal'), 'primary')
})

test('fallbacks are related, never random', () => {
  assert.equal(broaderSubject({ slug: 'additional-mathematics', name: 'Additional Mathematics' }, dict.subjects)?.name, 'Mathematics')
  assert.equal(broaderSubject({ slug: 'physics', name: 'Physics' }, dict.subjects), null)
  assert.deepEqual(nearestLevels(['Grade 4'], dict.levels).sort(), ['Grade 3', 'Grade 5'])
})

test('picker matching uses the same words', () => {
  assert.ok(subjectMatches('hisab', 'Mathematics', ['hisab']))
  assert.ok(subjectMatches('mathmatics', 'Mathematics'))
  assert.ok(!subjectMatches('fizics', 'Mathematics'))
})
