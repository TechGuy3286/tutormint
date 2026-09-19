/**
 * scripts/test-staffactivity.ts — npm run test:staffactivity
 *
 * The pure staff-activity tally (PR29 §2): metric mapping and the
 * today / last-7-days / total windows, computed without a database.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  tallyStaffActivity,
  STAFF_METRIC_ACTIONS,
  emptyStaffCounts,
  type AuditRow,
} from '../lib/staffActivityCore'

// A fixed "now": 2026-09-18 12:00 UTC (17:00 Karachi). Karachi midnight today is
// 2026-09-17 19:00 UTC. Week-ago is 2026-09-11 12:00 UTC.
const NOW = Date.parse('2026-09-18T12:00:00Z')

test('metric actions cover every mapped action, no duplicates', () => {
  assert.ok(STAFF_METRIC_ACTIONS.includes('job.post'))
  assert.ok(STAFF_METRIC_ACTIONS.includes('tutor.approve'))
  assert.ok(STAFF_METRIC_ACTIONS.includes('parent.verify.reject'))
  assert.ok(STAFF_METRIC_ACTIONS.includes('payment.approve'))
  assert.ok(STAFF_METRIC_ACTIONS.includes('member.message'))
  assert.equal(new Set(STAFF_METRIC_ACTIONS).size, STAFF_METRIC_ACTIONS.length)
})

test('job.post rolls up to "posted", across the three windows', () => {
  const rows: AuditRow[] = [
    { actorId: 'a', action: 'job.post', createdAt: '2026-09-18T17:30:00Z' }, // today (after Karachi midnight)
    { actorId: 'a', action: 'job.post', createdAt: '2026-09-15T09:00:00Z' }, // this week, not today
    { actorId: 'a', action: 'job.post', createdAt: '2026-08-01T09:00:00Z' }, // total only
  ]
  const c = tallyStaffActivity(rows, NOW).get('a')!
  assert.deepEqual(c.posted, { today: 1, week: 2, total: 3 })
})

test('approvals and rejections map from both tutor and parent actions', () => {
  const rows: AuditRow[] = [
    { actorId: 'a', action: 'tutor.approve', createdAt: '2026-09-18T17:00:00Z' },
    { actorId: 'a', action: 'parent.verify.approve', createdAt: '2026-09-18T17:00:00Z' },
    { actorId: 'a', action: 'tutor.hold', createdAt: '2026-09-18T17:00:00Z' },
    { actorId: 'a', action: 'tutor.suspend', createdAt: '2026-09-18T17:00:00Z' },
    { actorId: 'a', action: 'parent.verify.reject', createdAt: '2026-09-18T17:00:00Z' },
    { actorId: 'a', action: 'payment.approve', createdAt: '2026-09-18T17:00:00Z' },
    { actorId: 'a', action: 'member.message', createdAt: '2026-09-18T17:00:00Z' },
  ]
  const c = tallyStaffActivity(rows, NOW).get('a')!
  assert.equal(c.approved.total, 2)
  assert.equal(c.rejected.total, 3)
  assert.equal(c.payments.total, 1)
  assert.equal(c.messages.total, 1)
})

test('unmapped actions, missing actor and bad dates are ignored', () => {
  const rows: AuditRow[] = [
    { actorId: 'a', action: 'blog.publish', createdAt: '2026-09-18T17:00:00Z' }, // not a staff metric
    { actorId: null, action: 'job.post', createdAt: '2026-09-18T17:00:00Z' }, // no actor
    { actorId: 'a', action: 'job.post', createdAt: 'not-a-date' }, // bad date
  ]
  const map = tallyStaffActivity(rows, NOW)
  assert.equal(map.has('a'), false, 'no valid rows for a → not in the map')
})

test('two actors are tallied independently', () => {
  const rows: AuditRow[] = [
    { actorId: 'a', action: 'job.post', createdAt: '2026-09-18T17:00:00Z' },
    { actorId: 'b', action: 'payment.approve', createdAt: '2026-09-18T17:00:00Z' },
  ]
  const map = tallyStaffActivity(rows, NOW)
  assert.equal(map.get('a')!.posted.total, 1)
  assert.equal(map.get('b')!.payments.total, 1)
  assert.equal(map.get('a')!.payments.total, 0)
})

test('emptyStaffCounts is all zeroes', () => {
  const e = emptyStaffCounts()
  assert.equal(e.posted.total, 0)
  assert.equal(e.messages.today, 0)
})
