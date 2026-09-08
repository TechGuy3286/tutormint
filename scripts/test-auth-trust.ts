/**
 * scripts/test-auth-trust.ts  —  npm run test:authtrust
 *
 * Real unit tests for the Part 5 auth-&-trust logic, against the PURE cores the
 * routes are built from (owner, Part 5: "verified by code review" is not
 * evidence). Nothing here touches the one shared database — each test drives a
 * pure function or an env-only helper. What is genuinely DB-integration (the
 * login 403 path, the phone_verified_via write, the blocklist read, the
 * under_review flip) is proven by the pure core it decides with, plus the live
 * smoke; that split is stated in the Part 5 report.
 *
 * Uses node:test, like scripts/test-delivery.ts.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { bridgeStatus, bridgeOtpCode } from '../lib/sms'
import { otpMatch, resendWaitSeconds, RESEND_COOLDOWN_MS } from '../lib/otp'
import { applySessionPersistence, persistOffFrom } from '../lib/sessionCookies'
import { hashCnic, blocklistHit } from '../lib/blocklistCore'
import { normalisePkMobile } from '../lib/phone'
import { crossesReviewThreshold } from '../lib/underReviewCore'
import { computeEntitlements, type EntitlementInputs } from '../lib/entitlements'
import { BANNED_LOGIN_MESSAGE } from '../lib/authMessages'

// ------------------------------------------------------------ BRIDGE_OTP ---

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k]
    if (env[k] === undefined) delete process.env[k]
    else process.env[k] = env[k]
  }
  try {
    fn()
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString()
const past = () => new Date(Date.now() - 86_400_000).toISOString()

test('bridge: a set code with a FUTURE expiry verifies signups', () => {
  withEnv({ BRIDGE_OTP: '654321', BRIDGE_OTP_EXPIRES: future() }, () => {
    const s = bridgeStatus()
    assert.equal(s.active, true)
    assert.equal(s.expired, false)
    assert.equal(bridgeOtpCode(), '654321')
    // And a submitted bridge code is recognised as the bridge, not the bypass.
    assert.equal(otpMatch('654321', null, bridgeOtpCode()), 'bridge')
  })
})

test('bridge: PAST its expiry it refuses, whether or not the code is still set', () => {
  withEnv({ BRIDGE_OTP: '654321', BRIDGE_OTP_EXPIRES: past() }, () => {
    const s = bridgeStatus()
    assert.equal(s.active, false)
    assert.equal(s.expired, true)
    assert.equal(s.codeSet, true)
    assert.equal(bridgeOtpCode(), null, 'expired ⇒ no code, so nothing verifies')
  })
})

test('bridge: a code with NO expiry env is off — an unbounded bridge is impossible', () => {
  withEnv({ BRIDGE_OTP: '654321', BRIDGE_OTP_EXPIRES: undefined }, () => {
    assert.equal(bridgeStatus().active, false)
    assert.equal(bridgeOtpCode(), null)
  })
  // A future expiry but no code is also off.
  withEnv({ BRIDGE_OTP: undefined, BRIDGE_OTP_EXPIRES: future() }, () => {
    assert.equal(bridgeStatus().active, false)
  })
})

test('otpMatch: the dev bypass wins a tie, so a bridge value never masquerades', () => {
  assert.equal(otpMatch('000000', '000000', '000000'), 'bypass')
  assert.equal(otpMatch('111111', '000000', '111111'), 'bridge')
  assert.equal(otpMatch('999999', '000000', '111111'), 'none')
  assert.equal(otpMatch('654321', null, '654321'), 'bridge')
})

// ------------------------------------------------------- resend countdown ---

test('resendWaitSeconds: a 5-minute countdown that reaches zero', () => {
  assert.equal(RESEND_COOLDOWN_MS, 5 * 60 * 1000)
  const now = 1_000_000_000_000
  // Just sent: the full five minutes remain.
  assert.equal(resendWaitSeconds(now, now), 300)
  // Two minutes in: three remain.
  assert.equal(resendWaitSeconds(now - 2 * 60_000, now), 180)
  // One second short of the cooldown: still waiting.
  assert.equal(resendWaitSeconds(now - (RESEND_COOLDOWN_MS - 1000), now), 1)
  // Past the cooldown: re-enabled.
  assert.equal(resendWaitSeconds(now - RESEND_COOLDOWN_MS, now), 0)
  assert.equal(resendWaitSeconds(now - 10 * 60_000, now), 0)
})

// ----------------------------------------------------------- remember me ---

test('remember-me OFF makes sb-* auth cookies session cookies, and survives a refresh', () => {
  assert.equal(persistOffFrom('0'), true)
  assert.equal(persistOffFrom(undefined), false)
  assert.equal(persistOffFrom('1'), false)

  const authCookie = { name: 'sb-abc-auth-token', value: 'x', options: { maxAge: 3600, expires: new Date(), path: '/', httpOnly: true } }

  // Persistence OFF: maxAge/expires are stripped, everything else kept.
  const once = applySessionPersistence(authCookie, true)
  assert.equal('maxAge' in (once.options as object), false)
  assert.equal('expires' in (once.options as object), false)
  assert.equal((once.options as { path?: string }).path, '/')
  assert.equal((once.options as { httpOnly?: boolean }).httpOnly, true)

  // A simulated token refresh re-writes the cookie; applying again keeps it a
  // session cookie (this is why it runs on every response, not just at login).
  const refreshed = applySessionPersistence({ ...authCookie }, true)
  assert.equal('maxAge' in (refreshed.options as object), false)

  // Persistence ON: untouched.
  const kept = applySessionPersistence(authCookie, false)
  assert.equal((kept.options as { maxAge?: number }).maxAge, 3600)

  // A non-auth cookie is never touched, even with persistence off.
  const other = { name: 'tm_persist', value: '0', options: { maxAge: 999 } }
  assert.equal((applySessionPersistence(other, true).options as { maxAge?: number }).maxAge, 999)
})

// -------------------------------------------------------- signup blocklist ---

test('blocklist: a banned account is matched by normalised mobile OR hashed CNIC', () => {
  // The same person types their number and CNIC in various shapes; both signup
  // and claim normalise the same way before matching, so the keys line up.
  const mobile = normalisePkMobile('0300 1234567')
  assert.equal(mobile, '923001234567')
  const cnicHash = hashCnic('35201-1234567-8')
  assert.ok(cnicHash && cnicHash.length === 64)
  // Formatting-insensitive: the dashed and bare CNIC hash identically.
  assert.equal(hashCnic('3520112345678'), cnicHash)

  const rows = [{ mobile: '923001234567', cnic_hash: null }, { mobile: null, cnic_hash: cnicHash }]

  // Mobile hit (typed with a leading zero and spaces, normalised to match).
  assert.deepEqual(blocklistHit(rows, { mobile, cnicHash: null }), { mobile: true, cnic: false })
  // CNIC hit (dashed input, hashed to match).
  assert.deepEqual(blocklistHit(rows, { mobile: null, cnicHash }), { mobile: false, cnic: true })
  // A different person: no hit.
  assert.deepEqual(
    blocklistHit(rows, { mobile: normalisePkMobile('0300 7654321'), cnicHash: hashCnic('11111-1111111-1') }),
    { mobile: false, cnic: false },
  )
})

test('hashCnic: too-few digits is not a usable key (null, never a partial match)', () => {
  assert.equal(hashCnic('123'), null)
  assert.equal(hashCnic(null), null)
})

// --------------------------------------------------------- review trigger ---

test('crossesReviewThreshold: one verified reporter, or two of anyone', () => {
  assert.equal(crossesReviewThreshold({ hasVerifiedReporter: true, openReportCount: 1 }), true)
  assert.equal(crossesReviewThreshold({ hasVerifiedReporter: false, openReportCount: 1 }), false)
  assert.equal(crossesReviewThreshold({ hasVerifiedReporter: false, openReportCount: 2 }), true)
  assert.equal(crossesReviewThreshold({ hasVerifiedReporter: false, openReportCount: 0 }), false)
})

// --------------------------------------------------------- entitlements ----

const PLANS: EntitlementInputs['plans'] = [
  {
    code: 'verified', audience: 'tutor', name: 'Verified', monthly_quota: 10, displayed_quota: '10',
    can_view_contact: false, can_whatsapp: false, can_initiate_message: false, can_hire: false,
    can_see_viewer_identity: true, search_rank: 1, badges: ['Verified'], tag_label: null,
  },
  {
    code: 'parent_verified', audience: 'parent', name: 'Verified parent', monthly_quota: 5, displayed_quota: '5',
    can_view_contact: false, can_whatsapp: false, can_initiate_message: true, can_hire: false,
    can_see_viewer_identity: false, search_rank: 0, badges: ['Verified'], tag_label: null,
  },
]

const baseTutor = {
  role: 'tutor', profile_completion: 100, cnic_verified_at: '2026-01-01', address_verified_at: null,
  is_suspended: false, is_banned: false, phone_verified_via: 'otp',
}

function inputs(over: Partial<EntitlementInputs>): EntitlementInputs {
  return {
    userId: 'u1',
    profile: baseTutor,
    tutorRow: { verification_status: 'verified', imported: false, claimed_at: null },
    activeSubs: [],
    pausedPlanCode: null,
    plans: PLANS,
    counter: null,
    ...over,
  }
}

test('entitlements: a BANNED account gets nothing (banned + suspended, no plan, no badge)', () => {
  const e = computeEntitlements(
    inputs({
      profile: { ...baseTutor, is_banned: true },
      activeSubs: [{ plan_code: 'verified', expires_at: future() }],
    }),
  )
  assert.equal(e.banned, true)
  assert.equal(e.suspended, true)
  assert.equal(e.plan, null)
  assert.deepEqual(e.badges, [])
  assert.equal(e.canSeeViewerIdentity, false)
})

test('entitlements: a SUSPENDED account gets nothing but is not banned', () => {
  const e = computeEntitlements(
    inputs({
      profile: { ...baseTutor, is_suspended: true },
      activeSubs: [{ plan_code: 'verified', expires_at: future() }],
    }),
  )
  assert.equal(e.suspended, true)
  assert.equal(e.banned, false)
  assert.equal(e.plan, null)
  assert.deepEqual(e.badges, [])
})

test('entitlements: a BRIDGE-verified account holds no plan and no badge, but stays listed', () => {
  const e = computeEntitlements(
    inputs({
      profile: { ...baseTutor, phone_verified_via: 'bridge' },
      activeSubs: [{ plan_code: 'verified', expires_at: future() }],
    }),
  )
  assert.equal(e.bridgeLocked, true)
  assert.equal(e.plan, null, 'an active plan row confers nothing while bridge-locked')
  assert.deepEqual(e.badges, [])
  assert.equal(e.canSeeViewerIdentity, false)
  assert.equal(e.listed, true, 'the lock removes the plan/badge, not the listing')
  assert.equal(e.suspended, false)
})

test('entitlements: an OTP-verified Verified tutor gets the plan and the badge', () => {
  const e = computeEntitlements(inputs({ activeSubs: [{ plan_code: 'verified', expires_at: future() }] }))
  assert.equal(e.plan, 'verified')
  assert.equal(e.canSeeViewerIdentity, true)
  assert.deepEqual(e.badges, ['Verified'])
  assert.equal(e.bridgeLocked, false)
  assert.equal(e.quota, 10)
})

test('entitlements: a verified parent gets the free parent_verified tier with no subscription', () => {
  const e = computeEntitlements(
    inputs({
      profile: {
        role: 'parent', profile_completion: 100, cnic_verified_at: '2026-01-01', address_verified_at: '2026-01-01',
        is_suspended: false, is_banned: false, phone_verified_via: 'otp',
      },
      tutorRow: null,
      activeSubs: [],
    }),
  )
  assert.equal(e.plan, 'parent_verified')
  assert.equal(e.canInitiateMessage, true)
  assert.equal(e.canHire, false)
})

// --------------------------------------------------------- exact copy ------

test('the banned-login message is exact and owner-locked', () => {
  assert.equal(
    BANNED_LOGIN_MESSAGE,
    'Your account has been banned due to fraudulent activities. Please contact support.',
  )
})
