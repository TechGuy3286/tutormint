// scripts/test-partner-finance.ts — owner, 8 Oct 2026.
// Partner role (view-only), staff badge, owner-only areas, Finance totals,
// the funnel "lost" lists, the 24-hour payments to-do rule and the new
// "Stopped at" stops. Offline: pure functions plus source scans.
//   npx tsx --test scripts/test-partner-finance.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { isReadOnlyRole, roleBadge, roleSatisfies, SCREEN_ACCESS, type AdminRole } from '../lib/adminAccessCore'
import { isReadMethod } from '../lib/requestMethod'
import { classify, countedInMonth, methodLabel, summarise, typeLabel, type FinancePayment } from '../lib/financeCore'
import { funnelSets, isWaitingPayment } from '../lib/overviewItemsCore'
import { stoppedAtLabel, EMAIL_NOT_CONFIRMED, MOBILE_NOT_VERIFIED } from '../lib/onboardingStopCore'
import type { FlowFacts } from '../lib/tutorFlow'

test('a Partner may view every screen; writes are refused by method', () => {
  for (const [key, roles] of Object.entries(SCREEN_ACCESS)) {
    assert.equal(roleSatisfies('partner', roles as AdminRole[]), true, key)
  }
  assert.equal(isReadOnlyRole('partner'), true)
  for (const r of ['owner', 'admin', 'operations', 'tuitions_staff'] as AdminRole[]) assert.equal(isReadOnlyRole(r), false)
  assert.equal(isReadMethod('GET'), true)
  assert.equal(isReadMethod('head'), true)
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', '', null, undefined]) assert.equal(isReadMethod(m), false, String(m))
})

test('owner-only areas admit the owner and the Partner, nobody else', () => {
  for (const key of ['finance', 'revenue', 'paymentAmounts', 'plans', 'plansMutate', 'paymentGateways', 'reconciliation', 'team', 'audit', 'paymentsRefund'] as const) {
    assert.deepEqual(SCREEN_ACCESS[key], [], key)
    assert.equal(roleSatisfies('owner', SCREEN_ACCESS[key]), true)
    for (const r of ['admin', 'operations', 'tuitions_staff'] as AdminRole[]) assert.equal(roleSatisfies(r, SCREEN_ACCESS[key]), false, `${key} ${r}`)
  }
  // Payments: status for admin + operations; amounts are a separate key.
  assert.equal(roleSatisfies('operations', SCREEN_ACCESS.payments), true)
  assert.equal(roleSatisfies('admin', SCREEN_ACCESS.payments), true)
  assert.equal(roleSatisfies('operations', SCREEN_ACCESS.paymentAmounts), false)
})

test('staff badge: every staff role reads "Admin"; owner and Partner see real roles', () => {
  for (const r of ['admin', 'operations', 'tuitions_staff']) assert.equal(roleBadge(r), 'Admin')
  assert.equal(roleBadge('owner'), 'Owner')
  assert.equal(roleBadge('partner'), 'Partner')
  assert.equal(roleBadge('operations', 'owner'), 'Operations')
  assert.equal(roleBadge('tuitions_staff', 'partner'), 'Tuitions staff')
  assert.equal(roleBadge('operations', 'admin'), 'Admin')
})

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

test('every /api/admin write route goes through checkAdminRole (so a Partner gets 403)', () => {
  const ALLOW = new Set([
    // getAdminActor + strict owner literal / self-only, reviewed by hand:
    path.join('app', 'api', 'admin', 'reauth', 'route.ts'),
    path.join('app', 'api', 'admin', 'paypro', 'test-order', 'route.ts'),
  ])
  const files = walk(path.join('app', 'api', 'admin')).filter((f) => f.endsWith('route.ts'))
  assert.ok(files.length > 40)
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    if (!/export (async )?function (POST|PUT|PATCH|DELETE)/.test(src)) continue
    if (ALLOW.has(f)) continue
    assert.ok(/checkAdminRole\(|checkAdminSelf\(/.test(src), `${f} must call checkAdminRole`)
  }
  const test = readFileSync(path.join('app', 'api', 'admin', 'paypro', 'test-order', 'route.ts'), 'utf8')
  assert.ok(test.includes("actor.adminRole !== 'owner'"))
})

test('the proxy stamps the real method; checkAdminRole refuses a Partner write', () => {
  const proxy = readFileSync('proxy.ts', 'utf8')
  assert.ok(proxy.includes('headers.set(METHOD_HEADER, request.method)'))
  const auth = readFileSync(path.join('lib', 'adminAuth.ts'), 'utf8')
  assert.ok(auth.includes('isReadOnlyRole(actor.adminRole) && !opts.self'))
  assert.ok(auth.includes("!== 'verified'"))
  const layout = readFileSync(path.join('app', 'admin', 'layout.tsx'), 'utf8')
  assert.ok(layout.includes("mfa === 'none' && (readOnly || !inMfaGrace())"))
})

const pay = (o: Partial<FinancePayment>): FinancePayment => ({
  id: Math.random().toString(36).slice(2),
  ref: 'TM-1',
  userId: 'u',
  planCode: 'verified',
  audience: 'tutor',
  amountPkr: 199,
  refundedAmountPkr: null,
  refundedAt: null,
  approvedAt: '2026-10-05T10:00:00Z',
  provider: 'paypro',
  method: 'JazzCash',
  note: null,
  ...o,
})

test('Finance: refunds and deleted-account payments never enter a total', () => {
  const rows = [
    pay({}),
    pay({ planCode: 'premium', amountPkr: 499, method: 'Easypaisa' }),
    pay({ userId: null, note: 'deleted test account' }),
    pay({ refundedAmountPkr: 199, refundedAt: '2026-10-06T00:00:00Z' }),
    pay({ approvedAt: '2026-09-30T20:00:00Z' }), // 1 Oct in Pakistan time
    pay({ approvedAt: '2026-09-30T18:00:00Z' }), // 30 Sep 23:00 PKT
    pay({ provider: 'manual', method: 'Bank transfer', planCode: 'parent_featured', audience: 'parent', amountPkr: 999 }),
  ]
  assert.equal(classify(rows[2]), 'deleted')
  assert.equal(classify(rows[3]), 'refunded')
  const s = summarise({ payments: rows, transfers: [{ gateway: 'paypro', transferredOn: '2026-10-07', amountPkr: 300 }], deductions: [], nowIso: '2026-10-08T07:00:00Z' })
  assert.deepEqual(s.totals.thisMonth, { count: 4, amount: 199 + 499 + 199 + 999 })
  assert.deepEqual(s.totals.lastMonth, { count: 1, amount: 199 })
  assert.deepEqual(s.totals.allTime, { count: 5, amount: 199 * 3 + 499 + 999 })
  assert.equal(s.refunded.length, 1)
  assert.equal(s.deleted.length, 1)
  assert.equal(countedInMonth(rows, '2026-10').length, 4)
  const oct = s.months.find((m) => m.month === '2026-10')!
  assert.equal(oct.collected, 199 + 499 + 199 + 999)
  // Bank columns follow the money: every approved PayPro payment in October.
  assert.equal(oct.receivedInBank, 300 + 999)
  assert.equal(oct.dueFromPaypro, 199 * 4 + 499 - 300)
  assert.equal(s.byType.find((t) => t.label === 'Parent plans')?.amount, 999)
  assert.equal(s.byMethod.find((t) => t.label === 'Bank transfer')?.count, 1)
})

test('Finance: method and type words', () => {
  assert.equal(methodLabel('EasyPaisa', null, 'paypro'), 'Easypaisa')
  assert.equal(methodLabel('JazzCash', null, 'paypro'), 'JazzCash')
  assert.equal(methodLabel('Visa Card', null, 'paypro'), 'Card')
  assert.equal(methodLabel(null, null, 'manual'), 'Bank transfer')
  assert.equal(typeLabel('verified', 'tutor'), 'Verification Fee')
  assert.equal(typeLabel('parent_featured', 'parent'), 'Parent plans')
  assert.equal(typeLabel('featured', 'tutor'), 'Featured')
})

test('payments to-do: started in the last 24 hours AND waiting over 1 hour', () => {
  const now = Date.parse('2026-10-08T12:00:00Z')
  const at = (h: number) => new Date(now - h * 3600_000).toISOString()
  assert.equal(isWaitingPayment({ status: 'pending', createdAt: at(0.5) }, now), false)
  assert.equal(isWaitingPayment({ status: 'pending', createdAt: at(2) }, now), true)
  assert.equal(isWaitingPayment({ status: 'pending', createdAt: at(23.9) }, now), true)
  assert.equal(isWaitingPayment({ status: 'pending', createdAt: at(25) }, now), false) // abandoned
  assert.equal(isWaitingPayment({ status: 'approved', createdAt: at(2) }, now), false)
})

test('funnel: each lost list is exactly the step before minus the step after', () => {
  const t = (id: string, m: boolean, o: boolean, p: boolean) => ({ id, mobileVerified: m, onboarded: o, paid: p })
  const s = funnelSets([t('a', false, false, false), t('b', true, false, false), t('c', true, true, false), t('d', true, true, true), t('e', false, true, true)])
  assert.deepEqual([s.signedUp.length, s.mobile.length, s.onboarded.length, s.paid.length], [5, 3, 2, 1])
  assert.equal(s.lostMobile.length, s.signedUp.length - s.mobile.length)
  assert.equal(s.lostOnboarding.length, s.mobile.length - s.onboarded.length)
  assert.equal(s.lostPayment.length, s.onboarded.length - s.paid.length)
})

const base: FlowFacts = {
  fullName: 'A', gender: null, city: null, area: null, avatarUrl: null, headline: null, bio: null,
  experienceYears: null, hourlyRate: null, jobTypes: [], degreesCount: 0, degreeDocCount: 0, degrees: [],
  cnicNumber: null, cnicImagePath: null, subjectCount: 0, selfieDone: false, availabilityCount: 0,
  phoneVerified: true, whatsapp: null, feePaid: false, noDegreeYet: false, isSeed: false, isTeamAccount: false,
  isBanned: false, isSuspended: false, underReview: false, verificationStatus: null, imported: false, claimedAt: null,
}

test('Stopped at: unconfirmed email and unverified mobile come before Gender (items 7–8)', () => {
  assert.equal(stoppedAtLabel(base), 'Gender')
  assert.equal(stoppedAtLabel({ ...base, phoneVerified: false }), MOBILE_NOT_VERIFIED)
  assert.equal(stoppedAtLabel({ ...base, phoneVerified: false }, { emailConfirmed: false }), EMAIL_NOT_CONFIRMED)
  assert.equal(stoppedAtLabel(base, { emailConfirmed: true }), 'Gender')
})

