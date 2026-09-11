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

import { bridgeStatus, bridgeOtpCode, bridgeBanner, needsBridgeReverify } from '../lib/sms'
import { otpMatch } from '../lib/otp'
import {
  codeStillLive,
  pendingSendDecision,
  classifyPendingVerify,
  PENDING_MAX_ATTEMPTS,
} from '../lib/pendingSignupCore'
import { applySessionPersistence, persistOffFrom } from '../lib/sessionCookies'
import { hashCnic, blocklistHit } from '../lib/blocklistCore'
import { normalisePkMobile } from '../lib/phone'
import { crossesReviewThreshold } from '../lib/underReviewCore'
import { computeEntitlements, type EntitlementInputs } from '../lib/entitlements'
import {
  tutorListed,
  tutorListablePrecondition,
  tutorProfileNoindex,
  tutorSitemapEligible,
  badgesForPlan,
} from '../lib/planBadges'
import { isFixtureTuition } from '../lib/fixtures'
import { BANNED_LOGIN_MESSAGE } from '../lib/authMessages'
import { needsPhoneGate } from '../lib/phoneGate'

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

test('bridge handover: a bridge-verified account re-verifies only once the bridge is gone', () => {
  // While the bridge is still active, a bridge-verified account is NOT sent back
  // to re-verify — the handover fires only when the real provider has landed and
  // the code is removed.
  withEnv({ BRIDGE_OTP: '654321', BRIDGE_OTP_EXPIRES: future() }, () => {
    assert.equal(needsBridgeReverify('bridge'), false)
  })
  // Bridge removed (no code): a bridge-verified account must re-verify once with
  // a real code. This is exactly what the login route acts on.
  withEnv({ BRIDGE_OTP: undefined, BRIDGE_OTP_EXPIRES: undefined }, () => {
    assert.equal(needsBridgeReverify('bridge'), true)
    // An already-real ('otp') account, or one with no marker, is never re-gated.
    assert.equal(needsBridgeReverify('otp'), false)
    assert.equal(needsBridgeReverify(null), false)
  })
  // Bridge code set but EXPIRED counts as gone too (bridgeOtpCode() → null).
  withEnv({ BRIDGE_OTP: '654321', BRIDGE_OTP_EXPIRES: past() }, () => {
    assert.equal(needsBridgeReverify('bridge'), true)
  })
})

test('bridgeBanner: counts down while active, and stays up (differently) once expired', () => {
  const now = Date.parse('2026-09-09T00:00:00Z')
  const inDays = (d: number) => new Date(now + d * 86_400_000).toISOString()

  // Six days out, active: a day count and the active copy.
  const six = bridgeBanner({ active: true, codeSet: true, expiresAt: inDays(6), expired: false }, now)
  assert.equal(six.show, true)
  assert.equal(six.expired, false)
  assert.equal(six.message, 'Bridge OTP is active — 6 days remaining. Remove when the SMS provider lands.')

  // Under a day still reads as 1 (a countdown never shows 0 while active), and singular.
  const soon = bridgeBanner({ active: true, codeSet: true, expiresAt: new Date(now + 3600_000).toISOString(), expired: false }, now)
  assert.match(soon.message, /1 day remaining/)

  // Past expiry: shown, plainly, not vanished.
  const gone = bridgeBanner({ active: false, codeSet: true, expiresAt: inDays(-1), expired: true }, now)
  assert.equal(gone.show, true)
  assert.equal(gone.expired, true)
  assert.match(gone.message, /has expired/)

  // Never configured: no banner at all.
  assert.equal(bridgeBanner({ active: false, codeSet: false, expiresAt: null, expired: false }, now).show, false)
})

test('otpMatch: the dev bypass wins a tie, so a bridge value never masquerades', () => {
  assert.equal(otpMatch('000000', '000000', '000000'), 'bypass')
  assert.equal(otpMatch('111111', '000000', '111111'), 'bridge')
  assert.equal(otpMatch('999999', '000000', '111111'), 'none')
  assert.equal(otpMatch('654321', null, '654321'), 'bridge')
})

// -------------------------------------------- one SMS per number, no persist ---
// The pure core of "nothing persisted until verified" (owner, 11 Sep 2026): a
// live code for a number is reused (no second SMS), an expired one frees the
// number for a fresh send, and the code entry is classified without a DB.

test('codeStillLive: live within the window, dead past it', () => {
  const now = 1_000_000_000_000
  assert.equal(codeStillLive(now + 1, now), true)
  assert.equal(codeStillLive(now + 5 * 60 * 1000, now), true)
  assert.equal(codeStillLive(now, now), false)
  assert.equal(codeStillLive(now - 1, now), false)
})

test('pendingSendDecision: a live code is reused (no second SMS)', () => {
  const now = 1_000_000_000_000
  // A second attempt while a code is still outstanding sends nothing.
  assert.deepEqual(pendingSendDecision({ expiresAtMs: now + 4 * 60 * 1000 }, now), { action: 'reuse' })
})

test('pendingSendDecision: an expired row frees the number for one new SMS', () => {
  const now = 1_000_000_000_000
  // Expired outstanding code → the next attempt sends exactly one new message.
  assert.deepEqual(pendingSendDecision({ expiresAtMs: now - 1 }, now), { action: 'send' })
  // No row at all → send.
  assert.deepEqual(pendingSendDecision(null, now), { action: 'send' })
})

test('classifyPendingVerify: match creates, wrong counts down, cap and expiry burn', () => {
  const now = 1_000_000_000_000
  const live = now + 5 * 60 * 1000

  // Correct code within the window → ok (the caller then creates the account).
  assert.deepEqual(classifyPendingVerify({ matched: true, expiresAtMs: live, attempts: 0, nowMs: now }), {
    state: 'ok',
  })

  // Wrong code → attempts left decreases toward the cap.
  assert.deepEqual(classifyPendingVerify({ matched: false, expiresAtMs: live, attempts: 0, nowMs: now }), {
    state: 'wrong',
    attemptsLeft: PENDING_MAX_ATTEMPTS - 1,
  })

  // At the attempt cap → locked (burned; start over).
  assert.deepEqual(
    classifyPendingVerify({ matched: false, expiresAtMs: live, attempts: PENDING_MAX_ATTEMPTS, nowMs: now }),
    { state: 'locked' },
  )

  // Past expiry, even a correct code → expired (the number is free again).
  assert.deepEqual(classifyPendingVerify({ matched: true, expiresAtMs: now - 1, attempts: 0, nowMs: now }), {
    state: 'expired',
  })
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
  phone_verified_at: '2026-01-01', is_suspended: false, is_banned: false, phone_verified_via: 'otp',
}

const baseTutorRow = {
  verification_status: 'verified', imported: false, claimed_at: null,
  under_review: false, degrees: ['BSc Mathematics'],
}

function inputs(over: Partial<EntitlementInputs>): EntitlementInputs {
  return {
    userId: 'u1',
    profile: baseTutor,
    tutorRow: { ...baseTutorRow },
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

test('entitlements: an OTP-verified Verified tutor gets the plan, the badge and is listed', () => {
  const e = computeEntitlements(inputs({ activeSubs: [{ plan_code: 'verified', expires_at: future() }] }))
  assert.equal(e.plan, 'verified')
  assert.equal(e.canSeeViewerIdentity, true)
  assert.deepEqual(e.badges, ['Verified'])
  assert.equal(e.listed, true)
  assert.equal(e.bridgeLocked, false)
  assert.equal(e.quota, 10)
})

// --- the new listing rule (owner, 10 Sep 2026): completion no longer lists ---

test('entitlements: a PAID tutor UNDER 100% is LISTED and can apply', () => {
  const e = computeEntitlements(
    inputs({
      profile: { ...baseTutor, profile_completion: 40 },
      activeSubs: [{ plan_code: 'verified', expires_at: future() }],
    }),
  )
  assert.equal(e.listed, true, 'completion no longer gates listing')
  assert.equal(e.plan, 'verified', 'an active plan means a real apply quota')
  assert.equal(e.profileCompletion, 40)
})

test('entitlements: a FREE tutor at 100% is NOT listed (a plan is required)', () => {
  const e = computeEntitlements(inputs({ activeSubs: [] }))
  assert.equal(e.listed, false)
  assert.equal(e.plan, null)
})

test('entitlements: a tutor with a plan but NOT verified is NOT listed', () => {
  const e = computeEntitlements(
    inputs({
      tutorRow: { ...baseTutorRow, verification_status: 'pending' },
      activeSubs: [{ plan_code: 'verified', expires_at: future() }],
    }),
  )
  assert.equal(e.listed, false, 'verification is required to be listed')
  assert.equal(e.plan, 'verified', 'the plan still resolves; the Apply gate tells them to verify')
})

test('entitlements: a listed tutor with NO reviewed degree carries no Verified badge', () => {
  const e = computeEntitlements(
    inputs({
      tutorRow: { ...baseTutorRow, degrees: [] },
      activeSubs: [{ plan_code: 'verified', expires_at: future() }],
    }),
  )
  assert.equal(e.listed, true, 'no degree does not delist — it only removes the badge')
  assert.deepEqual(e.badges, [], 'the verified plan grants only Verified, which the missing degree drops')
})

test('entitlements: a verified parent gets the free parent_verified tier with no subscription', () => {
  const e = computeEntitlements(
    inputs({
      profile: {
        role: 'parent', profile_completion: 100, cnic_verified_at: '2026-01-01', address_verified_at: '2026-01-01',
        phone_verified_at: '2026-01-01', is_suspended: false, is_banned: false, phone_verified_via: 'otp',
      },
      tutorRow: null,
      activeSubs: [],
    }),
  )
  assert.equal(e.plan, 'parent_verified')
  assert.equal(e.canInitiateMessage, true)
  assert.equal(e.canHire, false)
})

// ------------------------------------------------------- listing helpers ---

test('tutorListablePrecondition: verified + mobile + moderation-clear + claimed', () => {
  const ok = {
    phoneVerified: true, verificationStatus: 'verified', isSuspended: false,
    isBanned: false, underReview: false, imported: false, claimedAt: null,
  }
  assert.equal(tutorListablePrecondition(ok), true)
  assert.equal(tutorListablePrecondition({ ...ok, phoneVerified: false }), false)
  assert.equal(tutorListablePrecondition({ ...ok, verificationStatus: 'pending' }), false)
  assert.equal(tutorListablePrecondition({ ...ok, underReview: true }), false)
  assert.equal(tutorListablePrecondition({ ...ok, imported: true, claimedAt: null }), false)
  assert.equal(tutorListablePrecondition({ ...ok, imported: true, claimedAt: '2026-01-01' }), true)
})

test('tutorListed: requires an active paid plan on top of the precondition', () => {
  const base = {
    phoneVerified: true, verificationStatus: 'verified', isSuspended: false,
    isBanned: false, underReview: false, imported: false, claimedAt: null,
  }
  assert.equal(tutorListed({ ...base, hasActivePaidPlan: true }), true)
  assert.equal(tutorListed({ ...base, hasActivePaidPlan: false }), false, 'no plan, not listed')
})

test('tutorProfileNoindex: noindex below 100%, under review, OR a seed tutor', () => {
  assert.equal(tutorProfileNoindex({ profileCompletion: 100 }), false, 'a real tutor at 100% is indexable')
  assert.equal(tutorProfileNoindex({ profileCompletion: 40 }), true)
  assert.equal(tutorProfileNoindex({ profileCompletion: 100, underReview: true }), true)
  // Seed wins: a fixture tutor at 100% is STILL noindex.
  assert.equal(tutorProfileNoindex({ profileCompletion: 100, isSeed: true }), true)
})

test('tutorSitemapEligible: listed AND 100% AND not a seed tutor', () => {
  assert.equal(tutorSitemapEligible({ listed: true, profileCompletion: 100 }), true, 'a real listed 100% tutor is in the sitemap')
  assert.equal(tutorSitemapEligible({ listed: true, profileCompletion: 40 }), false)
  assert.equal(tutorSitemapEligible({ listed: false, profileCompletion: 100 }), false)
  // A seed tutor at 100% is absent from the sitemap.
  assert.equal(tutorSitemapEligible({ listed: true, profileCompletion: 100, isSeed: true }), false)
})

test('isFixtureTuition: seed parent / JOB-TRK / SEED-JOB are fixtures; a team post never is', () => {
  // A real, non-seed parent's ordinary post is indexable.
  assert.equal(isFixtureTuition({ jobTxId: 'JOB-TX-ABC123', parentIsSeed: false }), false)
  // The three fixture signals.
  assert.equal(isFixtureTuition({ jobTxId: 'JOB-TX-XYZ', parentIsSeed: true }), true, 'seed parent')
  assert.equal(isFixtureTuition({ jobTxId: 'JOB-TRK-000042', parentIsSeed: false }), true, 'bulk import')
  assert.equal(isFixtureTuition({ jobTxId: 'SEED-JOB-7', parentIsSeed: false }), true, 'seeded sample')
  // A genuine team post overrides every fixture signal and stays indexable.
  assert.equal(isFixtureTuition({ jobTxId: 'SEED-JOB-7', parentIsSeed: true, postedByTeam: true }), false)
  // A missing id is not, by itself, a fixture.
  assert.equal(isFixtureTuition({ jobTxId: null, parentIsSeed: false }), false)
})

test('badgesForPlan: the Verified badge is degree-gated for tutors, not parents', () => {
  assert.deepEqual(badgesForPlan('verified', true, true), ['Verified'])
  assert.deepEqual(badgesForPlan('verified', true, false), [], 'no degree drops Verified')
  assert.deepEqual(badgesForPlan('featured', true, false), ['Premium', 'Featured'], 'tier badges stay')
  assert.deepEqual(badgesForPlan('parent_verified', true, false), ['Verified'], 'parents are not degree-gated')
  assert.deepEqual(badgesForPlan('verified', false, true), [], 'unlisted shows nothing')
})

// ------------------------------------------------------- phone gate --------
// The predicate proxy.ts and /verify-phone both decide with. The one that
// matters most here is the no-mobile email account: it must NOT be gated
// (owner, 9 Sep) — it reaches its dashboard and is never sent to /verify-phone.

test('phone gate: an email-verified account with NO mobile is never gated', () => {
  // What the email signup path writes: phone_gate_required stays false.
  assert.equal(needsPhoneGate({ phone_gate_required: false, phone_verified_at: null }), false)
})

test('phone gate: an unverified mobile-first account IS gated', () => {
  assert.equal(needsPhoneGate({ phone_gate_required: true, phone_verified_at: null }), true)
})

test('phone gate: a verified mobile account is not gated', () => {
  assert.equal(needsPhoneGate({ phone_gate_required: true, phone_verified_at: '2026-09-01T00:00:00Z' }), false)
})

test('phone gate: a legacy / pre-mobile-first account is not gated', () => {
  // 21 of the 28 accounts that predated the gate had no verified number; the
  // flag is what keeps them out of it.
  assert.equal(needsPhoneGate({ phone_gate_required: false, phone_verified_at: null }), false)
})

test('phone gate: a missing profile (backfilled orphan) is not gated', () => {
  assert.equal(needsPhoneGate(null), false)
  assert.equal(needsPhoneGate(undefined), false)
})

// --------------------------------------------------------- exact copy ------

test('the banned-login message is exact and owner-locked', () => {
  assert.equal(
    BANNED_LOGIN_MESSAGE,
    'Your account has been banned due to fraudulent activities. Please contact support.',
  )
})
