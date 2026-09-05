/**
 * scripts/test-seedcast.ts
 *
 *   npm run test:seedcast
 *
 * Pins the identity columns the reset script writes (scripts/reset-seed-cast.ts)
 * without touching the database. `expectedIdentity` is the pure decision the
 * reset uses to set profiles.cnic_verified_at and profiles.verification_state
 * for each cast member; these tests assert the generated rows are consistent —
 * a member never claims one column without the other — and that the specific
 * seed accounts land where their names say they should.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SEED_CAST, expectedIdentity } from './seedCast'

const byKey = Object.fromEntries(SEED_CAST.map((m) => [m.key, m]))

test('verified and verificationState always agree — no half-set identity row', () => {
  for (const m of SEED_CAST) {
    const id = expectedIdentity(m)
    assert.equal(
      id.verified,
      id.verificationState === 'approved',
      `${m.key}: verified=${id.verified} but state=${id.verificationState}`,
    )
    assert.ok(
      id.verificationState === 'approved' || id.verificationState === 'none',
      `${m.key}: unexpected state ${id.verificationState}`,
    )
  }
})

test('every verified seed tutor gets approved identity columns', () => {
  for (const m of SEED_CAST.filter((x) => x.role === 'tutor' && x.verification === 'verified')) {
    const id = expectedIdentity(m)
    assert.deepEqual(id, { verified: true, verificationState: 'approved' }, m.key)
  }
})

test('the suspended tutor is not identity-verified', () => {
  assert.deepEqual(expectedIdentity(byKey['suspended-omar']), {
    verified: false,
    verificationState: 'none',
  })
})

test('a verified parent is approved; the unverified parent is cleared to none', () => {
  assert.deepEqual(expectedIdentity(byKey['featured-ayesha']), {
    verified: true,
    verificationState: 'approved',
  })
  assert.deepEqual(expectedIdentity(byKey['verified-fatima']), {
    verified: true,
    verificationState: 'approved',
  })
  // seed+unverified-zain: browse-only, so the stale 'approved' clears to 'none'.
  assert.deepEqual(expectedIdentity(byKey['unverified-zain']), {
    verified: false,
    verificationState: 'none',
  })
})
