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
import { otpMatch, resetCodeState, resetDailyCapReached, RESET_CODE_TTL_MS, RESET_DAILY_MAX, RESET_MESSAGES, MAX_ATTEMPTS } from '../lib/otp'
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
import { directoryBlockers, isDirectoryListed, profileGaps, tutorFixFor } from '../lib/tutorListingStatus'
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

// ------------------------------------------- password-reset codes (5 Oct 2026) ---

test('reset code: 10-minute expiry, 5 wrong tries lock, expiry read before the lock', () => {
  const now = Date.parse('2026-10-05T10:00:00Z')
  assert.equal(RESET_CODE_TTL_MS, 10 * 60 * 1000)
  const live = now + RESET_CODE_TTL_MS
  assert.equal(resetCodeState({ expiresAtMs: live, attempts: 0, nowMs: now }), 'live')
  assert.equal(resetCodeState({ expiresAtMs: live, attempts: MAX_ATTEMPTS - 1, nowMs: now }), 'live', 'four wrong tries: still live')
  assert.equal(resetCodeState({ expiresAtMs: live, attempts: MAX_ATTEMPTS, nowMs: now }), 'locked', 'the fifth wrong try locks it')
  assert.equal(resetCodeState({ expiresAtMs: live, attempts: 0, nowMs: live }), 'expired', 'exactly 10 minutes later it is expired')
  assert.equal(resetCodeState({ expiresAtMs: live, attempts: MAX_ATTEMPTS, nowMs: live + 1 }), 'expired', 'locked AND expired reads as expired')
})

test('reset code: at most 3 per mobile per day', () => {
  assert.equal(RESET_DAILY_MAX, 3)
  assert.equal(resetDailyCapReached(0), false)
  assert.equal(resetDailyCapReached(2), false, 'the third code is still allowed')
  assert.equal(resetDailyCapReached(3), true, 'the fourth is refused')
  assert.equal(resetDailyCapReached(7), true)
})

test('reset errors: plain English with Urdu, never technical', () => {
  for (const k of ['wrong', 'expired', 'locked', 'dailyLimit'] as const) {
    const m = RESET_MESSAGES[k]
    assert.ok(m.en.length > 10 && m.ur.length > 5, `${k} has both lines`)
    assert.doesNotMatch(m.en, /otp|sha|hash|null|undefined|\b4\d\d\b/i, `${k} is not technical`)
  }
  assert.match(RESET_MESSAGES.dailyLimit.en, /3 codes/)
  assert.match(RESET_MESSAGES.dailyLimit.en, /contact support/i)
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

// The one-time-fee model (owner, 15 Sep 2026): the Rs 199 fee lists a tutor on
// the free Basic tier (synthesised, no subscription — like the free parent);
// Premium/Featured are paid subs that add powers. 'verified' is no longer a plan
// a tutor holds, so it is not in this active-plan set.
const PLANS: EntitlementInputs['plans'] = [
  {
    code: 'basic', audience: 'tutor', name: 'Basic', monthly_quota: 10, displayed_quota: '10',
    can_view_contact: false, can_whatsapp: false, can_initiate_message: true, can_hire: false,
    can_see_viewer_identity: false, search_rank: 1, badges: ['Verified'], tag_label: null,
  },
  {
    code: 'premium', audience: 'tutor', name: 'Premium', monthly_quota: 100, displayed_quota: 'Unlimited',
    can_view_contact: true, can_whatsapp: true, can_initiate_message: true, can_hire: false,
    can_see_viewer_identity: true, search_rank: 2, badges: ['Verified', 'Premium'], tag_label: null,
  },
  {
    code: 'featured', audience: 'tutor', name: 'Featured', monthly_quota: 150, displayed_quota: 'Unlimited',
    can_view_contact: true, can_whatsapp: true, can_initiate_message: true, can_hire: false,
    can_see_viewer_identity: true, search_rank: 3, badges: ['Verified', 'Premium', 'Featured'], tag_label: 'Featured',
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
  is_seed: false, is_team_account: false,
  // PR106-H4 — the Verified badge needs the fee paid + CNIC + photo + selfie
  // SUBMITTED (with a file) and none rejected. The baseline tutor has all three
  // on file; dedicated tests cover the pending/rejected cases.
  verification_state: 'approved', cnic_number: '1234512345671',
  cnic_image_path: 'identity-docs/u1/cnic.jpg', profile_pic_status: 'approved', selfie_status: 'approved',
  avatar_url: 'avatars/u1/photo.jpg',
}

// Fee paid, verification not rejected/suspended, degree on file, city+area+gender
// set — the baseline of a verified, visible Basic tutor (PR16). `hasSubjects` (an
// input flag) defaults true.
const baseTutorRow = {
  verification_status: 'verified', imported: false, claimed_at: null,
  under_review: false, degrees: ['BSc Mathematics'], verified_fee_paid_at: '2026-01-01',
  city: 'Lahore', area: 'Johar Town', gender: 'male',
}

function inputs(over: Partial<EntitlementInputs>): EntitlementInputs {
  return {
    userId: 'u1',
    profile: baseTutor,
    tutorRow: { ...baseTutorRow },
    hasSubjects: true,
    activeSubs: [],
    pausedPlanCode: null,
    plans: PLANS,
    counter: null,
    ...over,
  }
}

test('entitlements: a BANNED account gets nothing (banned + suspended, no plan, no badge)', () => {
  const e = computeEntitlements(inputs({ profile: { ...baseTutor, is_banned: true } }))
  assert.equal(e.banned, true)
  assert.equal(e.suspended, true)
  assert.equal(e.plan, null)
  assert.deepEqual(e.badges, [])
  assert.equal(e.canSeeViewerIdentity, false)
})

test('entitlements: a SUSPENDED account gets nothing but is not banned', () => {
  const e = computeEntitlements(inputs({ profile: { ...baseTutor, is_suspended: true } }))
  assert.equal(e.suspended, true)
  assert.equal(e.banned, false)
  assert.equal(e.plan, null)
  assert.deepEqual(e.badges, [])
})

test('entitlements: a BRIDGE-verified account holds no plan and no badge, but stays listed', () => {
  const e = computeEntitlements(inputs({ profile: { ...baseTutor, phone_verified_via: 'bridge' } }))
  assert.equal(e.bridgeLocked, true)
  assert.equal(e.plan, null, 'the fee-based Basic tier confers nothing while bridge-locked')
  assert.deepEqual(e.badges, [])
  assert.equal(e.canSeeViewerIdentity, false)
  assert.equal(e.listed, true, 'the lock removes the plan/badge, not the listing')
  assert.equal(e.suspended, false)
})

test('entitlements: a fee-paid tutor is on Basic — Verified badge, listed, 10 applies, NO viewer identity', () => {
  const e = computeEntitlements(inputs({}))
  assert.equal(e.plan, 'basic')
  assert.equal(e.canSeeViewerIdentity, false, 'seeing who viewed you is Premium+, not Basic')
  assert.equal(e.canInitiateMessage, true, 'all tutor tiers can message a parent')
  assert.deepEqual(e.badges, ['Verified'])
  assert.equal(e.listed, true)
  assert.equal(e.bridgeLocked, false)
  assert.equal(e.quota, 10)
})

test('entitlements: a fee-paid tutor whose docs are NOT yet staff-approved has verificationPending and no Verified badge (PR105-B §3)', () => {
  // Fee paid, on Basic, but selfie not yet approved → no Verified badge, and the
  // dashboard shows "Verification pending".
  const e = computeEntitlements(inputs({ profile: { ...baseTutor, selfie_status: 'submitted' } }))
  assert.equal(e.plan, 'basic', 'the fee still puts them on Basic')
  assert.equal(e.verified, true, 'verified (the fee) is unchanged')
  assert.equal(e.verificationPending, true)
  assert.deepEqual(e.badges, [], 'Verified is withheld until all three docs are approved')
})

test('entitlements: a Premium tutor whose document is REJECTED keeps Premium but loses Verified and is blocked (PR106-H4 §2)', () => {
  const e = computeEntitlements(
    inputs({
      profile: { ...baseTutor, profile_pic_status: 'rejected', profile_pic_reason: 'The photo is blurry.' },
      activeSubs: [{ plan_code: 'premium', expires_at: future() }],
    }),
  )
  assert.deepEqual(e.badges, ['Premium'], 'the plan-tier badge stays, Verified is paused')
  assert.equal(e.docRejected, true)
  assert.equal(e.rejectedDoc?.key, 'photo')
})

test('entitlements: a fee-paid tutor whose docs are SUBMITTED but not yet approved IS Verified (PR106-H4 §1)', () => {
  // The new rule: no staff approval needed — submitted + not rejected = Verified.
  const e = computeEntitlements(
    inputs({ profile: { ...baseTutor, profile_pic_status: 'pending', selfie_status: 'pending' } }),
  )
  assert.ok(e.badges.includes('Verified'), 'Verified the moment docs are submitted')
  assert.equal(e.docRejected, false)
})

test('entitlements: a Premium tutor sees who viewed, gets contact, and an Unlimited-display cap', () => {
  const e = computeEntitlements(inputs({ activeSubs: [{ plan_code: 'premium', expires_at: future() }] }))
  assert.equal(e.plan, 'premium', 'a paid sub wins over the synthesised Basic tier')
  assert.equal(e.canSeeViewerIdentity, true)
  assert.equal(e.canViewContact, true)
  assert.equal(e.displayedQuota, 'Unlimited')
  assert.equal(e.quota, 100, 'the real cap behind Unlimited is enforced')
  assert.deepEqual(e.badges, ['Verified', 'Premium'])
})

// --- the one-time-fee listing rule (owner, 15 Sep 2026) ---

test('entitlements: a fee-paid tutor UNDER 100% is LISTED and on Basic', () => {
  const e = computeEntitlements(inputs({ profile: { ...baseTutor, profile_completion: 40 } }))
  assert.equal(e.listed, true, 'completion no longer gates listing')
  assert.equal(e.plan, 'basic', 'the fee alone puts them on Basic')
  assert.equal(e.profileCompletion, 40)
})

test('entitlements: a tutor who has NOT paid the fee is VISIBLE but NOT verified (PR16 §1)', () => {
  const e = computeEntitlements(inputs({ tutorRow: { ...baseTutorRow, verified_fee_paid_at: null } }))
  assert.equal(e.visible, true, 'the fee no longer gates visibility')
  assert.equal(e.listed, true, 'listed is the visibility alias')
  assert.equal(e.verified, false, 'no fee = not verified')
  assert.equal(e.plan, null, 'no fee = no Basic plan')
  assert.deepEqual(e.badges, [], 'an unverified tutor shows no badge')
})

test('entitlements: a fee-paid tutor whose verification is REJECTED is NOT visible', () => {
  const e = computeEntitlements(inputs({ tutorRow: { ...baseTutorRow, verification_status: 'rejected' } }))
  assert.equal(e.visible, false, 'a rejected verification delists')
})

test('entitlements: the Verified badge no longer depends on a degree (PR105-B §1) — it needs staff-approved docs', () => {
  // A fully-staff-approved tutor with NO degree still shows Verified: the rule is
  // CNIC+photo+selfie now, not a reviewed degree.
  const e = computeEntitlements(inputs({ tutorRow: { ...baseTutorRow, degrees: [] } }))
  assert.equal(e.visible, true, 'no degree does not delist')
  assert.equal(e.verified, true, 'the fee is paid')
  assert.deepEqual(e.badges, ['Verified'], 'docs approved → Verified, with or without a degree')
})

test('entitlements: a verified tutor whose CNIC lacks documents carries no Verified badge (PR105-B §1)', () => {
  // cnic_verified_at set but no cnic_number/image → deriveCnicStatus is "pending",
  // so docs are not approved and the Verified badge is withheld.
  const e = computeEntitlements(
    inputs({ profile: { ...baseTutor, cnic_number: null, cnic_image_path: null, verification_state: 'submitted' } }),
  )
  assert.equal(e.verified, true, 'the fee is paid')
  assert.deepEqual(e.badges, [], 'no CNIC documents → no Verified badge')
  assert.equal(e.verificationPending, true)
})

// --- visibility vs apply-rights (PR16 §1) ---

// ONE SOURCE (owner, 5 Oct 2026, item 8): visibility IS the tutor_directory
// view's rule, which lists every real tutor account (migration 124). Missing
// subjects / city / area / gender are profile gaps, not visibility blockers.
test('entitlements: a verified tutor with NO subjects is still visible (gap, not blocker)', () => {
  const e = computeEntitlements(inputs({ hasSubjects: false }))
  assert.equal(e.visible, true, 'the directory lists every real tutor')
  assert.deepEqual(e.visibilityBlockers, [])
  assert.equal(e.verified, true, 'the fee is paid, so they can still apply')
  assert.equal(e.plan, 'basic', 'they still hold Basic — the fee is paid')
})

test('entitlements: NO city / area / gender never blocks visibility; hidden / suspended do', () => {
  assert.deepEqual(computeEntitlements(inputs({ tutorRow: { ...baseTutorRow, city: null } })).visibilityBlockers, [])
  assert.deepEqual(computeEntitlements(inputs({ tutorRow: { ...baseTutorRow, area: null } })).visibilityBlockers, [])
  assert.deepEqual(computeEntitlements(inputs({ tutorRow: { ...baseTutorRow, gender: null } })).visibilityBlockers, [])
  const hidden = computeEntitlements(inputs({ profile: { ...baseTutor, hidden_from_public: true } }))
  assert.equal(hidden.visible, false)
  assert.deepEqual(hidden.visibilityBlockers, ['hidden'])
})

test('entitlements: a listed tutor has no listing blockers', () => {
  const e = computeEntitlements(inputs({}))
  assert.equal(e.listed, true)
  assert.deepEqual(e.listingBlockers, [])
})

test('entitlements: a verified parent gets the free parent_verified tier with no subscription', () => {
  const e = computeEntitlements(
    inputs({
      profile: {
        role: 'parent', profile_completion: 100, cnic_verified_at: '2026-01-01', address_verified_at: '2026-01-01',
        phone_verified_at: '2026-01-01', is_suspended: false, is_banned: false, phone_verified_via: 'otp',
        is_seed: false, is_team_account: false,
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

test('tutorListablePrecondition: mobile + moderation-clear + claimed; pending is fine, only rejected/suspended block', () => {
  const ok = {
    phoneVerified: true, verificationStatus: 'verified', isSuspended: false,
    isBanned: false, underReview: false, imported: false, claimedAt: null,
  }
  assert.equal(tutorListablePrecondition(ok), true)
  assert.equal(tutorListablePrecondition({ ...ok, phoneVerified: false }), false)
  // Under the fee model the fee is what verifies; a still-pending status does NOT block.
  assert.equal(tutorListablePrecondition({ ...ok, verificationStatus: 'pending' }), true)
  assert.equal(tutorListablePrecondition({ ...ok, verificationStatus: 'rejected' }), false)
  assert.equal(tutorListablePrecondition({ ...ok, verificationStatus: 'suspended' }), false)
  assert.equal(tutorListablePrecondition({ ...ok, underReview: true }), false)
  assert.equal(tutorListablePrecondition({ ...ok, imported: true, claimedAt: null }), false)
  assert.equal(tutorListablePrecondition({ ...ok, imported: true, claimedAt: '2026-01-01' }), true)
})

test('tutorListed: requires the one-time fee on top of the precondition', () => {
  const base = {
    phoneVerified: true, verificationStatus: 'verified', isSuspended: false,
    isBanned: false, underReview: false, imported: false, claimedAt: null,
  }
  assert.equal(tutorListed({ ...base, feePaid: true }), true)
  assert.equal(tutorListed({ ...base, feePaid: false }), false, 'no fee, not listed')
})

test('tutorProfileNoindex: fee + staff approvals index; any missing is noindex; completion is irrelevant (owner, 5 Oct 2026)', () => {
  const ok = { verified: true, completion: 100, cnicApproved: true, profilePicApproved: true, selfieApproved: true }
  assert.equal(tutorProfileNoindex(ok), false, 'fee + all approvals is indexable')
  assert.equal(tutorProfileNoindex({ ...ok, verified: false }), true, 'no fee → noindex')
  assert.equal(tutorProfileNoindex({ ...ok, completion: 99 }), false, 'below 100% is STILL indexable (paid + approved)')
  assert.equal(tutorProfileNoindex({ ...ok, completion: 0 }), false, '0% is still indexable')
  assert.equal(tutorProfileNoindex({ ...ok, cnicApproved: false }), true, 'CNIC not approved → noindex')
  assert.equal(tutorProfileNoindex({ ...ok, profilePicApproved: false }), true, 'photo not approved → noindex')
  assert.equal(tutorProfileNoindex({ ...ok, selfieApproved: false }), true, 'selfie not approved → noindex')
  assert.equal(tutorProfileNoindex({ ...ok, underReview: true }), true)
  assert.equal(tutorProfileNoindex({ ...ok, isSeed: true }), true, 'seed → still noindex')
})

test('tutorSitemapEligible: listed AND fee AND all approvals AND not seed — completion irrelevant (owner, 5 Oct 2026)', () => {
  const ok = { verified: true, completion: 100, cnicApproved: true, profilePicApproved: true, selfieApproved: true }
  assert.equal(tutorSitemapEligible({ listed: true, ...ok }), true, 'a listed, approved, fee-paid tutor is in the sitemap')
  assert.equal(tutorSitemapEligible({ listed: true, ...ok, verified: false }), false, 'no fee → out')
  assert.equal(tutorSitemapEligible({ listed: true, ...ok, completion: 80 }), true, 'below 100% is still in (paid + approved)')
  assert.equal(tutorSitemapEligible({ listed: true, ...ok, selfieApproved: false }), false, 'selfie not approved → out')
  assert.equal(tutorSitemapEligible({ listed: false, ...ok }), false, 'not listed → out')
  assert.equal(tutorSitemapEligible({ listed: true, ...ok, isSeed: true }), false)
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

// ------------------------------------------ directory listing bar (mig 87) ---

// ONE SOURCE (owner, 5 Oct 2026, item 8): directoryBlockers mirrors the
// tutor_directory VIEW (migrations 127 + 137) exactly; the step-1 items are
// profile GAPS (profileGaps), never listing reasons.
const listedFacts = {
  role: 'tutor',
  phoneVerified: true, hasSubjects: true, city: 'Lahore', area: 'Johar Town', gender: 'male',
  isSuspended: false, isBanned: false, underReview: false, verificationStatus: 'verified',
  imported: false, claimedAt: null, isSeed: false, isTeamAccount: false, hiddenFromPublic: false,
}

test('directoryBlockers: a real tutor account is listed (no fee, no step-1 requirement)', () => {
  assert.deepEqual(directoryBlockers(listedFacts), [])
  assert.equal(isDirectoryListed(listedFacts), true)
  // An EMPTY profile is still listed — migration 124 lists every real tutor.
  assert.deepEqual(directoryBlockers({ ...listedFacts, phoneVerified: false, hasSubjects: false, city: '', area: '', gender: null }), [])
})

test('directoryBlockers: exactly the view\'s conditions, in its order', () => {
  assert.deepEqual(directoryBlockers({ ...listedFacts, role: 'parent' }), ['not_tutor'])
  assert.deepEqual(directoryBlockers({ ...listedFacts, role: 'admin' }), ['not_tutor'])
  assert.deepEqual(directoryBlockers({ ...listedFacts, isSuspended: true }), ['suspended'])
  assert.deepEqual(directoryBlockers({ ...listedFacts, isBanned: true }), ['banned'])
  assert.deepEqual(directoryBlockers({ ...listedFacts, underReview: true }), ['under_review'])
  assert.deepEqual(directoryBlockers({ ...listedFacts, verificationStatus: 'rejected' }), ['verification_rejected'])
  assert.deepEqual(directoryBlockers({ ...listedFacts, verificationStatus: 'suspended' }), ['verification_rejected'])
  assert.deepEqual(directoryBlockers({ ...listedFacts, verificationStatus: 'pending' }), [], 'pending verification still lists')
  assert.deepEqual(directoryBlockers({ ...listedFacts, isSeed: true }), ['fixture'])
  assert.deepEqual(directoryBlockers({ ...listedFacts, isTeamAccount: true }), ['fixture'])
  assert.deepEqual(directoryBlockers({ ...listedFacts, hiddenFromPublic: true }), ['hidden'])
  // Several at once come back in the view's order.
  assert.deepEqual(
    directoryBlockers({ ...listedFacts, isBanned: true, isSuspended: true, hiddenFromPublic: true }),
    ['suspended', 'banned', 'hidden'],
  )
})

test('profileGaps: the step-1 nudges, each on its own, never a listing reason', () => {
  assert.deepEqual(profileGaps(listedFacts), [])
  assert.deepEqual(profileGaps({ ...listedFacts, hasSubjects: false }), ['no_subjects'])
  assert.deepEqual(profileGaps({ ...listedFacts, city: '' }), ['no_city'])
  assert.deepEqual(profileGaps({ ...listedFacts, city: '   ' }), ['no_city'], 'whitespace-only city is no city')
  assert.deepEqual(profileGaps({ ...listedFacts, area: '' }), ['no_area'])
  assert.deepEqual(profileGaps({ ...listedFacts, gender: null }), ['no_gender'])
  assert.deepEqual(profileGaps({ ...listedFacts, phoneVerified: false }), ['phone_unverified'])
  // A gap is a fix link, not a blocker: the same facts list fine.
  assert.deepEqual(directoryBlockers({ ...listedFacts, phoneVerified: false }), [])
})

test('directoryBlockers: an unclaimed import is blocked from the directory, in view order', () => {
  const imp = { ...listedFacts, imported: true, claimedAt: null }
  assert.deepEqual(directoryBlockers(imp), ['unclaimed_import'])
})

// §5 (owner, 5 Oct 2026, migration 137): a staff-rejected CNIC, profile picture
// or selfie delists; approval of the re-upload reverses it with no other change.
test('directoryBlockers: a rejected identity document delists (CNIC, picture or selfie)', () => {
  assert.deepEqual(directoryBlockers({ ...listedFacts, cnicRejected: true }), ['document_rejected'])
  assert.deepEqual(directoryBlockers({ ...listedFacts, photoRejected: true }), ['document_rejected'])
  assert.deepEqual(directoryBlockers({ ...listedFacts, selfieRejected: true }), ['document_rejected'])
  assert.deepEqual(directoryBlockers({ ...listedFacts, cnicRejected: true, selfieRejected: true }), ['document_rejected'], 'one blocker, however many documents')
  // Pending or approved is NOT rejected — nothing blocks.
  assert.deepEqual(directoryBlockers({ ...listedFacts, cnicRejected: false, photoRejected: false, selfieRejected: false }), [])
  // Absent facts (a caller that does not carry them) never block.
  assert.deepEqual(directoryBlockers({ ...listedFacts, cnicRejected: null, photoRejected: undefined }), [])
  // The fix opens the identity section of Settings (the re-upload screen).
  assert.equal(tutorFixFor('document_rejected')?.href, '/tutor/dashboard/settings#identity')
})

test('tutorFixFor: only the tutor-fixable visibility blockers offer a screen', () => {
  // PR 4 §1.6: each opens the exact step of the tap-tap flow.
  assert.equal(tutorFixFor('no_subjects')?.href, '/tutor/complete-profile?step=subjects')
  assert.equal(tutorFixFor('no_city')?.href, '/tutor/complete-profile?step=city')
  assert.equal(tutorFixFor('no_area')?.href, '/tutor/complete-profile?step=area')
  assert.equal(tutorFixFor('no_gender')?.href, '/tutor/complete-profile?step=gender')
  assert.equal(tutorFixFor('phone_unverified')?.href, '/tutor/complete-profile?step=mobile')
  assert.equal(tutorFixFor('suspended'), null)
  assert.equal(tutorFixFor('fixture'), null)
  assert.equal(tutorFixFor('unclaimed_import'), null)
})

test('badgesForPlan: the Verified badge needs staff approval (verifiedOk), tutors AND parents (PR105-B §1)', () => {
  assert.deepEqual(badgesForPlan('basic', true, true), ['Verified'])
  assert.deepEqual(badgesForPlan('basic', true, false), [], 'approvals incomplete drops Verified')
  assert.deepEqual(badgesForPlan('featured', true, false), ['Premium', 'Featured'], 'tier badges stay regardless')
  assert.deepEqual(badgesForPlan('premium', true, false), ['Premium'], 'premium tier badge stays')
  assert.deepEqual(badgesForPlan('parent_verified', true, false), [], 'a parent without CNIC verified has no Verified badge')
  assert.deepEqual(badgesForPlan('parent_verified', true, true), ['Verified'], 'a CNIC-verified parent shows Verified')
  assert.deepEqual(badgesForPlan('parent_featured', true, false), ['Featured'], 'parent tier badge stays')
  assert.deepEqual(badgesForPlan('basic', false, true), [], 'unlisted shows nothing')
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

// ── PR37 — one shared indexability rule (lib/seo/indexable) ──
import { tutorProfileIndexable, tuitionIndexable } from '../lib/seo/indexable'

test('tutor index rule = paid + approved (owner, 5 Oct 2026): fee + staff-approved CNIC/photo/selfie, completion irrelevant', () => {
  const base = { feePaid: true, completion: 100, cnicApproved: true, profilePicApproved: true, selfieApproved: true, isSeed: false, underReview: false }
  assert.equal(tutorProfileIndexable(base), true)
  assert.equal(tutorProfileIndexable({ ...base, feePaid: false }), false, 'no fee')
  assert.equal(tutorProfileIndexable({ ...base, completion: 99 }), true, 'below 100% is still indexable')
  assert.equal(tutorProfileIndexable({ ...base, completion: null }), true, 'no completion figure at all is fine')
  // Paid but not approved, and approved but unpaid: both noindex.
  assert.equal(tutorProfileIndexable({ ...base, cnicApproved: false, profilePicApproved: false, selfieApproved: false }), false, 'paid, not approved')
  assert.equal(tutorProfileIndexable({ ...base, feePaid: false, completion: 100 }), false, 'approved, not paid')
  assert.equal(tutorProfileIndexable({ ...base, cnicApproved: false }), false, 'CNIC not approved')
  assert.equal(tutorProfileIndexable({ ...base, profilePicApproved: false }), false, 'photo not approved')
  assert.equal(tutorProfileIndexable({ ...base, selfieApproved: false }), false, 'selfie not approved')
  assert.equal(tutorProfileIndexable({ ...base, isSeed: true }), false, 'seed never indexable')
  assert.equal(tutorProfileIndexable({ ...base, underReview: true }), false, 'under review')
})

test('PR37: a tuition is indexable only when open and not a fixture', () => {
  assert.equal(tuitionIndexable({ status: 'open', isFixture: false }), true)
  assert.equal(tuitionIndexable({ status: 'paused', isFixture: false }), false, 'paused')
  assert.equal(tuitionIndexable({ status: 'closed', isFixture: false }), false, 'closed')
  assert.equal(tuitionIndexable({ status: 'hired', isFixture: false }), false, 'hired')
  assert.equal(tuitionIndexable({ status: 'open', isFixture: true }), false, 'seed/fixture')
})

// ── PR94 Part 3 — Team inbox status tags (first missing wins) ──

import { memberInboxTag } from '../lib/inboxTags'

test('memberInboxTag: tutor first-missing order; parent only on verification', () => {
  const complete = { role: 'tutor', completion: 100, hasWhatsapp: true, awaitingApproval: false, feePaid: true, cnicVerified: true }
  assert.equal(memberInboxTag(complete), null)
  assert.equal(memberInboxTag({ ...complete, completion: 40 })?.label, 'Incomplete profile — 40%')
  assert.equal(memberInboxTag({ ...complete, hasWhatsapp: false })?.label, 'No WhatsApp number')
  assert.equal(memberInboxTag({ ...complete, awaitingApproval: true })?.label, 'Waiting for staff approval')
  assert.equal(memberInboxTag({ ...complete, feePaid: false })?.label, 'Fee not paid')
  assert.equal(memberInboxTag({ ...complete, completion: 40, hasWhatsapp: false, feePaid: false })?.label, 'Incomplete profile — 40%')
  assert.equal(memberInboxTag({ role: 'parent', completion: 0, hasWhatsapp: false, awaitingApproval: false, feePaid: false, cnicVerified: true }), null)
  assert.equal(memberInboxTag({ role: 'parent', completion: 100, hasWhatsapp: true, awaitingApproval: false, feePaid: true, cnicVerified: false })?.label, 'CNIC not verified')
  // Each tag names the template staff should reach for (PR105 §6).
  assert.equal(memberInboxTag({ ...complete, hasWhatsapp: false })?.templateKey, 'no_whatsapp')
  assert.equal(memberInboxTag({ ...complete, awaitingApproval: true })?.templateKey, 'awaiting_approval')
  assert.equal(memberInboxTag({ ...complete, feePaid: false })?.templateKey, 'fee_not_paid')
  const t = memberInboxTag({ ...complete, completion: 40 })!
  assert.ok(t.labelUr.length > 0 && ['gold', 'red', 'navy', 'teal'].includes(t.tone))
})
