// scripts/test-self-pause.ts — owner, 8 Oct 2026.
// "Pause my account" and the "Paid today" Overview card. Offline: the pure
// rules plus source scans of where they are enforced.
//   npx tsx --test scripts/test-self-pause.ts
// The database behaviour (pause hides + signs out, sign-in restores, a
// staff-suspended account stays suspended) is covered by the opt-in live test
// scripts/test-self-pause-live.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { pauseConfirmText, pauseRefusal, shouldRestoreOnSignIn, type PauseFacts } from '../lib/selfPauseCore'
import { directoryBlockers } from '../lib/tutorListingStatus'
import { feePayersSince, pkDayStartMs } from '../lib/overviewItemsCore'
import { pkMonthStartMs } from '../lib/feePayersCore'

const base: PauseFacts = { role: 'tutor', isSuspended: false, isBanned: false, pausedByUserAt: null }

test('who may self-pause: tutors and parents, never a staff-suspended or banned account', () => {
  assert.equal(pauseRefusal(base), null)
  assert.equal(pauseRefusal({ ...base, role: 'parent' }), null)
  assert.ok(pauseRefusal({ ...base, isSuspended: true }))
  assert.ok(pauseRefusal({ ...base, isBanned: true }))
  assert.ok(pauseRefusal({ ...base, role: 'admin' }))
  assert.ok(pauseRefusal({ ...base, pausedByUserAt: '2026-10-08T00:00:00Z' }))
})

test('sign-in restores a self-pause, never a staff suspension or ban', () => {
  const paused = { ...base, pausedByUserAt: '2026-10-08T00:00:00Z' }
  assert.equal(shouldRestoreOnSignIn(paused), true)
  assert.equal(shouldRestoreOnSignIn({ ...paused, isSuspended: true }), false)
  assert.equal(shouldRestoreOnSignIn({ ...paused, isBanned: true }), false)
  assert.equal(shouldRestoreOnSignIn(base), false)
})

test('the confirmation tells a paid-plan tutor the plan keeps running', () => {
  assert.ok(pauseConfirmText({ paidPlan: false }).en.startsWith('Your profile will be hidden and you will be signed out. Sign in any time to bring it back.'))
  assert.ok(!pauseConfirmText({ paidPlan: false }).en.includes('plan days'))
  assert.ok(pauseConfirmText({ paidPlan: true }).en.endsWith('Your plan days keep running while paused.'))
  assert.ok(pauseConfirmText({ paidPlan: true }).ur.length > 20)
})

test('a self-paused tutor is out of the directory (TS mirror and the view)', () => {
  assert.deepEqual(directoryBlockers({ role: 'tutor', pausedByUser: true }), ['paused_by_user'])
  assert.deepEqual(directoryBlockers({ role: 'tutor', pausedByUser: false }), [])
  const mig = readFileSync('supabase/migrations/151_self_pause.sql', 'utf8')
  assert.ok(mig.includes('AND p.paused_by_user_at IS NULL'))
  assert.ok(mig.includes('add column if not exists paused_by_user_at timestamptz'))
  assert.ok(!/is_suspended\s*=/.test(mig.split('create or replace view')[0]), 'the self-pause never writes a staff state')
})

test('pausing hides, pauses a parent’s open tuitions, logs, and signs out everywhere', () => {
  const lib = readFileSync('lib/selfPause.ts', 'utf8')
  assert.ok(lib.includes(".update({ paused_by_user_at: now })"))
  assert.ok(lib.includes(".update({ status: 'paused', paused_at: now, self_paused_at: now, pause_source: 'self' })"))
  assert.ok(lib.includes(".eq('status', 'open')"))
  assert.ok(lib.includes("rpc('revoke_user_sessions'"))
  assert.ok(lib.includes("action: 'member.self_pause'") && lib.includes("action: 'member.self_restore'"))
  assert.ok(!/is_suspended:\s*(true|false)/.test(lib), 'never touches the staff suspension')
  const route = readFileSync('app/api/account/pause/route.ts', 'utf8')
  assert.ok(route.includes('supabase.auth.getUser()') && route.includes('auth.signOut('))
})

test('every sign-in path restores, and the login route keeps suspended members on /suspended', () => {
  for (const f of ['app/api/auth/login/route.ts', 'app/api/auth/reset/route.ts', 'app/api/auth/callback/route.ts']) {
    assert.ok(readFileSync(f, 'utf8').includes('restoreSelfPauseOnSignIn('), f)
  }
  const lib = readFileSync('lib/selfPause.ts', 'utf8')
  assert.ok(lib.includes(".eq('is_suspended', false)") && lib.includes(".eq('is_banned', false)"))
  const form = readFileSync('app/(site)/login/LoginForm.tsx', 'utf8')
  assert.ok(form.indexOf("if (data.suspended) return go('/suspended')") < form.indexOf('if (data.restored) toast.success'))
})

test('messages and demo requests to a paused member are refused with the plain line', () => {
  const msg = readFileSync('lib/messaging.ts', 'utf8')
  assert.equal((msg.match(/memberUnavailable\(/g) ?? []).length, 2, 'start a thread + send a message')
  const demo = readFileSync('app/api/demo/request/route.ts', 'utf8')
  assert.ok(demo.includes('memberUnavailable(tutorId)'))
  assert.ok(readFileSync('lib/selfPauseCore.ts', 'utf8').includes("'This member is not available right now.'"))
})

test('Paid today: since 00:00 Pakistan time, once per tutor, no refunds or deleted accounts', () => {
  const now = Date.parse('2026-10-08T12:00:00Z') // 17:00 PKT
  assert.equal(new Date(pkDayStartMs(now)).toISOString(), '2026-10-07T19:00:00.000Z')
  const rows = [
    { userId: 'a', approvedAt: '2026-10-07T19:30:00Z', refundedAmountPkr: null, refundedAt: null }, // 00:30 PKT today
    { userId: 'a', approvedAt: '2026-10-08T08:00:00Z', refundedAmountPkr: null, refundedAt: null }, // same tutor again
    { userId: 'b', approvedAt: '2026-10-07T18:59:00Z', refundedAmountPkr: null, refundedAt: null }, // 23:59 PKT yesterday
    { userId: 'c', approvedAt: '2026-10-08T09:00:00Z', refundedAmountPkr: 199, refundedAt: '2026-10-08T10:00:00Z' }, // refunded
    { userId: null, approvedAt: '2026-10-08T09:00:00Z', refundedAmountPkr: null, refundedAt: null }, // deleted account
    { userId: 'd', approvedAt: '2026-10-02T09:00:00Z', refundedAmountPkr: null, refundedAt: null }, // this month, this week
    { userId: 'e', approvedAt: '2026-09-29T09:00:00Z', refundedAmountPkr: null, refundedAt: null }, // last month, over 7 days ago
  ]
  const r = feePayersSince(rows, now, pkMonthStartMs(now))
  assert.deepEqual(r.today.map((x) => x.userId), ['a'])
  assert.equal(r.today[0].at, '2026-10-08T08:00:00Z')
  assert.equal(r.month, 3) // a, b, d
  assert.equal(r.week, 3) // a, b, d (not e)
  assert.deepEqual(feePayersSince([], now, pkMonthStartMs(now)), { today: [], month: 0, week: 0 })
})

test('the Overview shows Paid today (never hidden at 0) from the list it opens', () => {
  const page = readFileSync('app/admin/page.tsx', 'utf8')
  assert.ok(page.includes("'paid-today'") && !page.includes('paid-this-month'))
  assert.ok(page.includes("value: k === 'revenue' ? pkr(l.amount ?? 0) : String(l.rows.length)"))
  const items = readFileSync('lib/overviewItems.ts', 'utf8')
  assert.ok(items.includes("extra: `${month} this month · ${week} in the last 7 days`"))
  assert.ok(items.includes("{ label: 'Review documents', href: `/admin/tutors/${r.userId}` }"))
})
