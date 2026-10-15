// scripts/test-staff-targets.ts — monthly paid sign-up targets and the
// Follow-ups → Tutors groups (owner, 16 Oct 2026).
//   npm run test:stafftargets
// Pure rules (lib/staffTargetsCore, lib/staffOutreachCore) plus source checks
// that the route, the loader and the screens use them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  cumulativeByDay,
  daysInMonth,
  daysLeft,
  elapsedDays,
  firstPaidAt,
  isQualifyingPayment,
  mayManageTargets,
  monthKeyOf,
  monthRange,
  OWNER_ONLY_TARGETS,
  paceFor,
  paidInMonth,
  parseMonth,
  parseTargetValue,
  sortCards,
  targetLine,
  targetListFor,
  targetScope,
  todayYesterday,
  type PaymentFacts,
} from '../lib/staffTargetsCore'
import { inProgressIn, mayViewStaff, type CreditedAccount } from '../lib/staffSignupsCore'
import { parseTutorScope, tutorInScope } from '../lib/staffOutreachCore'
import type { AdminRole } from '../lib/adminAccessCore'

const read = (p: string) => readFileSync(p, 'utf8')
const PK = 5 * 3600_000
/** A Pakistan-time wall clock as a UTC instant. */
const pkt = (s: string) => Date.parse(`${s}Z`) - PK

const approved = (at: string, extra: Partial<PaymentFacts> = {}): PaymentFacts => ({
  planCode: 'verified',
  status: 'approved',
  approvedAt: new Date(pkt(at)).toISOString(),
  ...extra,
})

const acct = (id: string, staffId: string, role: 'tutor' | 'parent', paidAt: string | null, extra: Partial<CreditedAccount['at']> = {}): CreditedAccount => ({
  memberId: id,
  staffId,
  role,
  name: id,
  mobile: null,
  at: { signed_up: new Date(pkt('2026-10-01T10:00:00')).toISOString(), ...extra, paid: paidAt ? new Date(pkt(paidAt)).toISOString() : null },
})

// ------------------------------------------------------------ the paid rule

test('tutor: an approved, not refunded Verification Fee counts', () => {
  assert.equal(isQualifyingPayment(approved('2026-10-05T12:00:00'), 'tutor'), true)
  assert.equal(isQualifyingPayment(approved('2026-10-05T12:00:00', { status: 'pending' }), 'tutor'), false)
  assert.equal(isQualifyingPayment(approved('2026-10-05T12:00:00', { refundedAt: '2026-10-06T00:00:00Z' }), 'tutor'), false)
  assert.equal(isQualifyingPayment(approved('2026-10-05T12:00:00', { refundedAmountPkr: 199 }), 'tutor'), false)
  // A tutor Premium purchase is not the fee.
  assert.equal(isQualifyingPayment(approved('2026-10-05T12:00:00', { planCode: 'premium' }), 'tutor'), false)
})

test('a free grant writes no payment, so a tutor with only a grant has not paid', () => {
  assert.equal(firstPaidAt([], 'tutor'), null)
})

test('parent: an approved, not refunded plan purchase counts; the fee does not', () => {
  assert.equal(isQualifyingPayment(approved('2026-10-05T12:00:00', { planCode: 'parent_featured' }), 'parent'), true)
  assert.equal(isQualifyingPayment(approved('2026-10-05T12:00:00'), 'parent'), false)
  assert.equal(isQualifyingPayment(approved('2026-10-05T12:00:00', { planCode: 'parent_featured', refundedAt: 'x' }), 'parent'), false)
})

test('counted once, on the first qualifying payment', () => {
  const at = firstPaidAt([approved('2026-10-09T09:00:00'), approved('2026-10-03T09:00:00'), approved('2026-10-20T09:00:00')], 'tutor')
  assert.equal(at, new Date(pkt('2026-10-03T09:00:00')).toISOString())
  const accounts = [acct('a', 's1', 'tutor', '2026-10-03T09:00:00')]
  assert.equal(paidInMonth(accounts, '2026-10').length, 1)
})

test('a refund removes the sign-up from that month', () => {
  const before = [approved('2026-10-03T09:00:00')]
  const after = [approved('2026-10-03T09:00:00', { refundedAt: '2026-10-10T00:00:00Z' })]
  const month = (pays: PaymentFacts[]) => paidInMonth([acct('a', 's1', 'tutor', firstPaidAt(pays, 'tutor') ? '2026-10-03T09:00:00' : null)], '2026-10').length
  assert.equal(month(before), 1)
  assert.equal(month(after), 0)
  // A later, kept payment counts in ITS month instead.
  assert.equal(firstPaidAt([...after, approved('2026-11-02T09:00:00')], 'tutor'), new Date(pkt('2026-11-02T09:00:00')).toISOString())
})

test('the month is the Pakistan-time calendar month', () => {
  // 31 Oct 23:30 PKT is still October; 1 Nov 00:10 PKT is November.
  assert.equal(monthKeyOf(pkt('2026-10-31T23:30:00')), '2026-10')
  assert.equal(monthKeyOf(pkt('2026-11-01T00:10:00')), '2026-11')
  const r = monthRange('2026-10')
  assert.equal(r.start, pkt('2026-10-01T00:00:00'))
  assert.equal(r.end, pkt('2026-11-01T00:00:00'))
  assert.equal(paidInMonth([acct('a', 's', 'tutor', '2026-10-31T23:59:00')], '2026-10').length, 1)
  assert.equal(paidInMonth([acct('a', 's', 'tutor', '2026-11-01T00:00:00')], '2026-10').length, 0)
})

// ------------------------------------------------------------ pace

test('days in month, elapsed and days left (first and last day)', () => {
  assert.equal(daysInMonth('2026-10'), 31)
  assert.equal(daysInMonth('2026-02'), 28)
  assert.equal(daysInMonth('2028-02'), 29)
  // First day, 06:00 PKT: a quarter-day elapsed, 31 days left (today included).
  const d1 = pkt('2026-10-01T06:00:00')
  assert.equal(elapsedDays('2026-10', d1), 0.25)
  assert.equal(daysLeft('2026-10', d1), 31)
  // Last day: 1 day left.
  const d31 = pkt('2026-10-31T12:00:00')
  assert.equal(daysLeft('2026-10', d31), 1)
  assert.equal(elapsedDays('2026-10', d31), 30.5)
  // A past month: nothing left, all elapsed. A future month: every day left.
  assert.equal(daysLeft('2026-09', d31), 0)
  assert.equal(elapsedDays('2026-09', d31), 30)
  assert.equal(daysLeft('2026-11', d31), 30)
  assert.equal(elapsedDays('2026-11', d31), 0)
})

test('status: on pace ≥ 100% of expected, slightly behind 80–99%, behind < 80%', () => {
  // Day 16 of 31 at 00:00 → 15 days elapsed; target 31 → expected 15.
  const now = pkt('2026-10-16T00:00:00')
  assert.equal(paceFor(31, 15, '2026-10', now).status, 'on_pace')
  assert.equal(paceFor(31, 12, '2026-10', now).status, 'slightly_behind') // 80%
  assert.equal(paceFor(31, 13, '2026-10', now).status, 'slightly_behind')
  assert.equal(paceFor(31, 11, '2026-10', now).status, 'behind') // 73%
  assert.equal(paceFor(31, 15, '2026-10', now).expected, 15)
})

test('needed per day = (target − paid) ÷ days left including today', () => {
  const now = pkt('2026-10-16T09:00:00') // 16 days left (16th…31st)
  const p = paceFor(40, 18, '2026-10', now)
  assert.equal(p.daysLeft, 16)
  assert.equal(p.neededPerDay, 1.4) // 22 / 16 = 1.375 → rounded up to 1.4
  assert.equal(p.pct, 45)
  // Last day: everything still needed falls on today.
  assert.equal(paceFor(40, 37, '2026-10', pkt('2026-10-31T10:00:00')).neededPerDay, 3)
  // First day.
  assert.equal(paceFor(31, 0, '2026-10', pkt('2026-10-01T01:00:00')).neededPerDay, 1)
})

test('target reached: needed per day is 0 and the status is on pace', () => {
  const p = paceFor(10, 12, '2026-10', pkt('2026-10-05T10:00:00'))
  assert.equal(p.reached, true)
  assert.equal(p.neededPerDay, 0)
  assert.equal(p.status, 'on_pace')
  assert.equal(p.pct, 120)
})

test('no target: no status, no needed-per-day', () => {
  const p = paceFor(null, 3, '2026-10', pkt('2026-10-05T10:00:00'))
  assert.equal(p.status, null)
  assert.equal(p.neededPerDay, null)
  assert.equal(p.pct, null)
  assert.equal(paceFor(0, 3, '2026-10', pkt('2026-10-05T10:00:00')).status, null)
})

test('a finished month with the target missed has no needed-per-day', () => {
  const p = paceFor(40, 20, '2026-09', pkt('2026-10-05T10:00:00'))
  assert.equal(p.daysLeft, 0)
  assert.equal(p.neededPerDay, null)
  assert.equal(p.status, 'behind')
})

test('today vs yesterday compares the same time of day', () => {
  const now = pkt('2026-10-16T12:00:00')
  const accts = [
    acct('t1', 's', 'tutor', '2026-10-16T09:00:00'),
    acct('t2', 's', 'parent', '2026-10-16T11:00:00'),
    acct('y1', 's', 'tutor', '2026-10-15T08:00:00'),
    acct('y2', 's', 'tutor', '2026-10-15T20:00:00'), // after noon: not in the same-time count
  ]
  const r = todayYesterday(accts, now)
  assert.equal(r.today, 2)
  assert.equal(r.yesterday, 2)
  assert.deepEqual(r.change, { direction: 'up', pct: 100 })
})

test('cumulative chart and target line', () => {
  const now = pkt('2026-10-03T12:00:00')
  const accts = [acct('a', 's', 'tutor', '2026-10-01T09:00:00'), acct('b', 's', 'parent', '2026-10-03T09:00:00')]
  const c = cumulativeByDay(accts, '2026-10', now)
  assert.equal(c.length, 31)
  assert.deepEqual(c.slice(0, 4), [1, 1, 2, null])
  const line = targetLine(31, '2026-10')
  assert.equal(line[0], 1)
  assert.equal(line[30], 31)
})

test('cards sort by % of target, highest first; no target last', () => {
  const now = pkt('2026-10-16T09:00:00')
  const cards = sortCards([
    { name: 'A', pace: paceFor(40, 10, '2026-10', now) },
    { name: 'B', pace: paceFor(20, 18, '2026-10', now) },
    { name: 'C', pace: paceFor(null, 5, '2026-10', now) },
  ])
  assert.deepEqual(cards.map((c) => c.name), ['B', 'A', 'C'])
})

// ------------------------------------------------------------ the list + history

test('month history keeps its own targets; the current month uses the stored list', () => {
  const now = pkt('2026-10-16T09:00:00')
  const stored = new Set(['aseer', 'mahnoor'])
  const sept = new Map([['zubia', 30], ['qasim', 25]])
  assert.deepEqual([...targetListFor('2026-09', now, stored, sept)].sort(), ['qasim', 'zubia'])
  assert.deepEqual([...targetListFor('2026-10', now, stored, new Map())].sort(), ['aseer', 'mahnoor'])
  assert.deepEqual([...targetListFor('2026-11', now, stored, new Map())].sort(), ['aseer', 'mahnoor'])
})

test('a month value from the URL is checked', () => {
  const now = pkt('2026-10-16T09:00:00')
  assert.equal(parseMonth('2026-09', now), '2026-09')
  assert.equal(parseMonth('2026-13', now), '2026-10')
  assert.equal(parseMonth("'; drop", now), '2026-10')
})

test('target values: whole numbers 0…10000; empty leaves as is', () => {
  assert.deepEqual(parseTargetValue('40'), { ok: true, value: 40 })
  assert.deepEqual(parseTargetValue(0), { ok: true, value: 0 })
  assert.deepEqual(parseTargetValue(''), { ok: true, value: null })
  assert.deepEqual(parseTargetValue(null), { ok: true, value: null })
  assert.equal(parseTargetValue('-1').ok, false)
  assert.equal(parseTargetValue('2.5').ok, false)
  assert.equal(parseTargetValue('10001').ok, false)
})

test('no-target staff are left out of the team totals', () => {
  const lib = read('lib/staffTargets.ts')
  // The team's paid number and target come from the cards (target-list staff)…
  assert.ok(lib.includes('const teamPaid = allCards.reduce('))
  assert.ok(lib.includes('const teamTarget = listIds.reduce('))
  // …and the chart's team line from target-list staff's accounts only.
  assert.ok(lib.includes('accounts.filter((a) => list.has(a.staffId))'))
  // No target = everyone NOT on the list.
  assert.ok(lib.includes('.filter((id) => !list.has(id))'))
})

// ------------------------------------------------------------ permissions

const ROLES: AdminRole[] = ['owner', 'partner', 'admin', 'operations', 'tuitions_staff']

test('Set targets is Owner only: 403 for every other role, and the Owner is alerted', () => {
  for (const r of ROLES) assert.equal(mayManageTargets(r), r === 'owner', r)
  const route = read('app/api/admin/team-activity/targets/route.ts')
  const post = route.slice(route.indexOf('export async function POST'))
  // The Owner check comes before either write.
  const guard = post.indexOf('refuseUnlessOwnerTargets(')
  assert.ok(guard > 0)
  assert.ok(guard < post.indexOf('setOnTargetList('))
  assert.ok(guard < post.indexOf('saveTargets('))
  const guardLib = read('lib/ownerGuard.ts')
  assert.match(guardLib, /refuseUnlessOwnerTargets[\s\S]*alertOwnerBlocked\([\s\S]*OWNER_ONLY_TARGETS[\s\S]*status: 403/)
  const alerts = read('lib/ownerAlerts.ts')
  assert.ok(alerts.includes('params.problem === OWNER_ONLY_TARGETS'))
  assert.match(OWNER_ONLY_TARGETS, /Only the Owner/)
  // The panel is rendered for the Owner only.
  assert.ok(read('lib/staffTargets.ts').includes("if (viewer.adminRole === 'owner') {"))
})

test('every target change is written to Audit', () => {
  const lib = read('lib/staffTargets.ts')
  assert.ok(lib.includes("action: 'staff.targets_set'"))
  assert.ok(lib.includes("action: 'staff.target_list'"))
})

test('who sees what', () => {
  assert.equal(targetScope('owner', false), 'everyone')
  assert.equal(targetScope('partner', false), 'everyone')
  assert.equal(targetScope('admin', false), 'everyone')
  assert.equal(targetScope('tuitions_staff', true), 'target_self')
  assert.equal(targetScope('tuitions_staff', false), 'self')
  assert.equal(targetScope('operations', false), 'self')
})

test('target-list staff cannot fetch other staff data (403)', () => {
  const me = { id: 'aseer', adminRole: 'tuitions_staff' }
  assert.equal(mayViewStaff(me, 'aseer'), true)
  assert.equal(mayViewStaff(me, 'mahnoor'), false)
  assert.equal(mayViewStaff({ id: 'x', adminRole: 'admin' }, 'mahnoor'), true)
  const route = read('app/api/admin/team-activity/targets/route.ts')
  assert.match(route, /if \(staff && !mayViewTargetStaff\(gate\.actor, staff\)\)[\s\S]*status: 403/)
  // The board itself never hands a non-"everyone" viewer another person's card.
  const lib = read('lib/staffTargets.ts')
  assert.ok(lib.includes("board.cards = allCards.filter((c) => c.staffId === viewer.id)"))
  assert.ok(lib.includes("board.inProgress = allInProgress.filter((r) => r.staffId === viewer.id)"))
  // The accounts lists keep their own 403 (lib/staffSignups loadSignupList).
  assert.ok(read('lib/staffSignups.ts').includes("You can only see your own sign-ups."))
})

test('in progress: earlier steps, not paid yet, both roles', () => {
  const r = monthRange('2026-10')
  const accts = [
    acct('t-unpaid', 's', 'tutor', null, { onboarded: new Date(pkt('2026-10-04T10:00:00')).toISOString() }),
    acct('t-paid', 's', 'tutor', '2026-10-06T10:00:00', { onboarded: new Date(pkt('2026-10-04T10:00:00')).toISOString() }),
    acct('p-unpaid', 's', 'parent', null, { posted: new Date(pkt('2026-10-05T10:00:00')).toISOString() }),
    acct('p-paid', 's', 'parent', '2026-10-07T10:00:00', { posted: new Date(pkt('2026-10-05T10:00:00')).toISOString() }),
  ]
  assert.deepEqual(inProgressIn(accts, 'tutor', 'onboarded', r).map((a) => a.memberId), ['t-unpaid'])
  assert.deepEqual(inProgressIn(accts, 'parent', 'posted', r).map((a) => a.memberId), ['p-unpaid'])
})

test('the tab shows no amounts and keeps the footer line', () => {
  const tab = read('app/admin/team-activity/PaidTab.tsx')
  assert.ok(tab.includes('Only paid sign-ups count as results.'))
  assert.ok(!/amount_pkr|price_pkr|Rs\s?\d/.test(tab))
  // The old wide tables are gone.
  assert.ok(!tab.includes('<table'))
})

// ------------------------------------------------------------ Follow-ups

test('Follow-ups → Tutors groups', () => {
  const now = pkt('2026-10-16T12:00:00')
  const day = 86_400_000
  const t = (daysAgo: number, f: Partial<{ feeStamped: boolean; feeApproved: boolean; onboarded: boolean }> = {}) => ({
    joinedAt: new Date(now - daysAgo * day).toISOString(),
    feeStamped: false,
    feeApproved: false,
    onboarded: false,
    ...f,
  })
  // Last 30 days unpaid (the default).
  assert.equal(tutorInScope(t(3), 'recent', now), true)
  assert.equal(tutorInScope(t(45), 'recent', now), false)
  assert.equal(tutorInScope(t(3, { feeStamped: true }), 'recent', now), false)
  // Older than 30 days, unpaid.
  assert.equal(tutorInScope(t(45), 'older', now), true)
  assert.equal(tutorInScope(t(3), 'older', now), false)
  assert.equal(tutorInScope(t(45, { feeStamped: true }), 'older', now), false)
  // Paid, profile not finished — any join date.
  assert.equal(tutorInScope(t(60, { feeStamped: true, feeApproved: true }), 'paid_unfinished', now), true)
  assert.equal(tutorInScope(t(2, { feeStamped: true, feeApproved: true }), 'paid_unfinished', now), true)
  assert.equal(tutorInScope(t(2, { feeStamped: true, feeApproved: true, onboarded: true }), 'paid_unfinished', now), false)
  // A free grant (stamped, no approved payment) is not "paid" here.
  assert.equal(tutorInScope(t(2, { feeStamped: true }), 'paid_unfinished', now), false)
  assert.equal(parseTutorScope('older'), 'older')
  assert.equal(parseTutorScope('nonsense'), 'recent')
  const page = read('app/admin/follow-ups/page.tsx')
  assert.ok(page.includes('loadUnpaidSignups(new Date(), scope)'))
  assert.ok(read('app/admin/follow-ups/UnpaidSignupRow.tsx').includes('Still to do:'))
})
