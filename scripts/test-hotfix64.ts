/**
 * scripts/test-hotfix64.ts  —  npm run test:hotfix64
 *
 * HOTFIX-64: the data-op matcher ignores phone formatting + the synthetic
 * email, and a raw GoTrue/DB "Database error creating new user" is mapped to the
 * friendly bilingual message on every signup path. Pure logic only; the trigger
 * tolerance is a DB change verified live in a BEGIN…ROLLBACK (stated in the
 * report), not here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normMobile, phoneMatchesCore } from '../lib/dataopMatch'
import { classifyAuthError, AUTH_MSG } from '../lib/authMessages'

test('normMobile reduces every Pakistani-mobile shape to one MSISDN + core + synthetic', () => {
  const want = { msisdn: '923244015462', core10: '3244015462', synthetic: '923244015462@users.tutormint.org' }
  for (const raw of [
    '03244015462',
    '3244015462',
    '923244015462',
    '+923244015462',
    '+92 324 4015462',
    '0092-3244015462',
    '0324-401-5462',
    ' 0324 4015462 ',
  ]) {
    assert.deepEqual(normMobile(raw), want, `shape ${JSON.stringify(raw)}`)
  }
})

test('normMobile rejects non-Pakistani-mobile input', () => {
  assert.equal(normMobile('123'), null)
  assert.equal(normMobile('0423 1234567'), null) // landline-style, not 3XXXXXXXXX
  assert.equal(normMobile('name@example.com'), null)
})

test('phoneMatchesCore ignores formatting and matches on the last 10 digits', () => {
  assert.equal(phoneMatchesCore('+92 324-4015462', '3244015462'), true)
  assert.equal(phoneMatchesCore('0324 4015462', '3244015462'), true)
  assert.equal(phoneMatchesCore('0300 0000000', '3244015462'), false)
  assert.equal(phoneMatchesCore(null, '3244015462'), false)
})

test('a raw account-creation failure maps to the friendly bilingual message, not technical text', () => {
  for (const raw of [
    'Database error creating new user',
    'unexpected_failure: Database error creating new user',
    'unexpected failure',
  ]) {
    const cls = classifyAuthError(raw)
    assert.ok(cls, `classified: ${raw}`)
    assert.equal(cls!.key, 'accountCreateFailed')
  }
  // The member-facing text is the owner's exact line + an Urdu line, and never
  // the raw "Database error".
  assert.match(AUTH_MSG.accountCreateFailed.en, /Something went wrong creating your account/)
  assert.match(AUTH_MSG.accountCreateFailed.en, /0321 5872222/)
  assert.ok(AUTH_MSG.accountCreateFailed.ur.length > 0)
  assert.ok(!/database error/i.test(AUTH_MSG.accountCreateFailed.en))
})
