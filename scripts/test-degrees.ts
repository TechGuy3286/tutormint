/**
 * scripts/test-degrees.ts   —   npm run test:degrees
 *
 * lib/degrees: every stored credential shape (plain string, clean object, and the
 * doubly-nested-JSON corruption) decodes to clean fields and a plain display line
 * — never raw JSON. The repair and the readers share this parser.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCredential, degreeLabel, degreeLabels, certLabel } from '../lib/degrees'

test('a plain-string degree is its own line', () => {
  assert.equal(degreeLabel('BS Physics — Punjab University (2019)'), 'BS Physics — Punjab University (2019)')
  assert.deepEqual(parseCredential('BS Physics — Punjab University (2019)').title, 'BS Physics — Punjab University (2019)')
})

test('a clean object degree becomes "Title, Institute (Year)"', () => {
  const c = parseCredential('{"title":"BS Physics","institute":"Punjab University","year":"2019","fileName":"","fileUrl":""}')
  assert.equal(c.title, 'BS Physics')
  assert.equal(c.institute, 'Punjab University')
  assert.equal(c.year, '2019')
  assert.equal(degreeLabel('{"title":"BS Physics","institute":"Punjab University","year":"2019"}'), 'BS Physics, Punjab University (2019)')
})

test('the doubly-nested corruption unwraps to the innermost real fields', () => {
  // The exact shape from production (535aada4): title holds the JSON of the whole
  // credential, whose title holds the real value.
  const corrupt =
    '{"title":"{\\"title\\":\\"BS Physics — Punjab University (2019)\\",\\"institute\\":\\"\\",\\"year\\":\\"\\",\\"fileName\\":\\"\\",\\"fileUrl\\":\\"\\"}","institute":"","year":"","fileName":"","fileUrl":""}'
  const c = parseCredential(corrupt)
  assert.equal(c.title, 'BS Physics — Punjab University (2019)')
  assert.equal(degreeLabel(corrupt), 'BS Physics — Punjab University (2019)')
  // No braces ever leak.
  assert.ok(!degreeLabel(corrupt).includes('{'))
})

test('certificate keeps its name; issuer maps in; blanks drop', () => {
  assert.equal(certLabel('{"title":"IELTS 8.0","issuer":"British Council","year":"2021"}'), 'IELTS 8.0, British Council (2021)')
  assert.equal(certLabel('Cambridge Certified Educator'), 'Cambridge Certified Educator')
  assert.deepEqual(degreeLabels(['', '{}', 'BSc Maths']), ['BSc Maths'])
})
