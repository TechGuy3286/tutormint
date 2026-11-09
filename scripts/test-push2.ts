/**
 * scripts/test-push2.ts — npm run test:push2
 *
 * Push 2 of "Fast admin, Number first, cost and email clean-up" (owner, 1 Nov 2026):
 * the email-change security notice, and the fast admin lists + Overview summary.
 * Pure rules + source scans; no DB, browser or network. Addresses are made up.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { oldAddressNotice } from '../lib/emailChangeCore'
import { render } from '../lib/notify/templates'
import { CRITICAL_TEMPLATES, LOCKED_ON, MEMBER_TEMPLATES } from '../lib/email/policyCore'

const read = (p: string) => readFileSync(p, 'utf8')

test('email change: a real old address gets one masked notice', () => {
  assert.deepEqual(oldAddressNotice('Old.Person@Gmail.com', 'ayesha.khan@yahoo.com'), {
    to: 'old.person@gmail.com',
    maskedNew: 'ay•••@yahoo.com',
  })
})

test('email change: no notice for the mobile placeholder, an erased account, the same address or none', () => {
  assert.equal(oldAddressNotice('923001234567@users.tutormint.org', 'a.b@gmail.com'), null)
  assert.equal(oldAddressNotice('erased-11111111@users.tutormint.org', 'a.b@gmail.com'), null)
  assert.equal(oldAddressNotice('a.b@gmail.com', 'A.B@gmail.com'), null)
  assert.equal(oldAddressNotice(null, 'a.b@gmail.com'), null)
  assert.equal(oldAddressNotice('not an address', 'a.b@gmail.com'), null)
})

test('email change notice: the owner\'s words, no link, no undo', () => {
  const m = render({ id: 'email_changed_notice', maskedNew: 'ay•••@yahoo.com', supportWhatsapp: '0321 5872222' })
  assert.match(m.text, /Your TutorMint email was changed to ay•••@yahoo\.com\. Not you\? WhatsApp support: 0321 5872222\./)
  // The only link is the standard footer every email carries; no button, no undo.
  const links = m.text.match(/https?:\/\/\S+/g) ?? []
  assert.deepEqual(links, ['https://www.tutormint.org/account/notifications/settings'])
  assert.ok(!/undo|reverse|cancel/i.test(m.text + m.html))
  // A security notice always goes (critical, cannot be switched off) and is a member email.
  assert.ok(CRITICAL_TEMPLATES.has('email_changed_notice'))
  assert.ok(LOCKED_ON.has('email_changed_notice'))
  assert.ok((MEMBER_TEMPLATES as readonly string[]).includes('email_changed_notice'))
})

test('email change notice is sent once, when the change completes, to the old address', () => {
  const src = read('lib/emailConfirm.ts')
  const fn = src.slice(src.indexOf('async function completePendingChange'), src.indexOf('export async function confirmEmailFromLink'))
  assert.match(fn, /oldAddressNotice\(got\?\.user\?\.email, e\)/)
  assert.equal((fn.match(/email_changed_notice/g) ?? []).length, 1)
  // The new address keeps its single confirmation; the notice is never sent at request time.
  const req = src.slice(src.indexOf('export async function requestEmailChange'), src.indexOf('async function completePendingChange'))
  assert.ok(!req.includes('email_changed_notice'))
})

// ------------------------------------------------- fast admin (push 2) ---

import {
  DIRTY_IGNORED_EVENTS,
  SUMMARY_MAX_AGE_MS,
  chipCountsFromList,
  navBadgesFrom,
  needsRebuild,
  poolCount,
  searchHaystack,
  sliceFromList,
  splitCounts,
  tally,
  tutorTabSection,
  updatedLabel,
  viewerCount,
  windowRange,
} from '../lib/adminSummaryCore'

const T0 = Date.parse('2026-11-01T10:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

test('rebuild: when nothing was built, when 10 minutes old, when something changed — never twice at once', () => {
  assert.equal(needsRebuild({ builtAt: null, startedAt: null, dirtyAt: null }, T0), true)
  const fresh = { builtAt: iso(T0 - 60_000), startedAt: iso(T0 - 90_000), dirtyAt: null }
  assert.equal(needsRebuild(fresh, T0), false)
  // Push 3: a change waits until the last build is 3 minutes old.
  assert.equal(needsRebuild({ ...fresh, dirtyAt: iso(T0 - 30_000) }, T0), false)
  assert.equal(needsRebuild({ builtAt: iso(T0 - 3 * 60_000), startedAt: iso(T0 - 4 * 60_000), dirtyAt: iso(T0 - 30_000) }, T0), true)
  assert.equal(needsRebuild({ ...fresh, dirtyAt: iso(T0 - 70_000) }, T0), false, 'a change before the build is already in it')
  assert.equal(needsRebuild({ ...fresh, builtAt: iso(T0 - SUMMARY_MAX_AGE_MS), startedAt: iso(T0 - SUMMARY_MAX_AGE_MS - 60_000) }, T0), true)
  assert.equal(needsRebuild(fresh, T0, true), true, 'Refresh forces it')
  // Another rebuild started 1 minute ago and has not finished: wait, even forced.
  const running = { builtAt: iso(T0 - 5 * 60_000), startedAt: iso(T0 - 60_000), dirtyAt: iso(T0) }
  assert.equal(needsRebuild(running, T0, true), false)
  // ...unless it started so long ago it must have died.
  assert.equal(needsRebuild({ ...running, startedAt: iso(T0 - 5 * 60_000 + 1) }, T0 + 5 * 60_000), true)
})

test('"Updated" line', () => {
  assert.equal(updatedLabel(null, T0), 'Not worked out yet')
  assert.equal(updatedLabel(iso(T0 - 20_000), T0), 'Updated just now')
  assert.equal(updatedLabel(iso(T0 - 4 * 60_000), T0), 'Updated 4 min ago')
  assert.equal(updatedLabel(iso(T0 - 130 * 60_000), T0), 'Updated 2 h ago')
})

test('sign-ins, searches and messages do not trigger a rebuild', () => {
  for (const e of ['login', 'search_performed', 'message_sent']) assert.ok(DIRTY_IGNORED_EVENTS.has(e))
  for (const e of ['register', 'payment_submitted', 'document_uploaded', 'application_submitted']) assert.ok(!DIRTY_IGNORED_EVENTS.has(e))
})

test('badges: the Owner sees the whole count, staff their own; the role switches still apply', () => {
  const t = tally([{ ownerId: 'a' }, { ownerId: 'a' }, { ownerId: 'b' }, { ownerId: null }])
  assert.deepEqual(t, { total: 4, byOwner: { a: 2, b: 1 } })
  assert.equal(viewerCount(t, { id: 'x', adminRole: 'owner' }), 4)
  assert.equal(viewerCount(t, { id: 'a', adminRole: 'operations' }), 2)
  assert.equal(viewerCount(t, { id: 'z', adminRole: 'admin' }), 0)
  // Only "act now" counts (owner, 9 Nov 2026): People = documents waiting +
  // Approved fee pending due; Applications = new, unseen; Paid tutors no badge.
  const b = { reports: 1, receipts: 2, peopleWaiting: 3, pipelineDue: 4, parentOverdue: 5, appsOverdue: t, appsNew: t, paidRed: t }
  const staff = navBadgesFrom(b, { id: 'a', adminRole: 'operations' }, { followUps: true, paidTutors: false, parentFollowUps: false })
  assert.deepEqual(staff, { '/admin/reports': 1, '/admin/payments': 2, '/admin/applications': 2, '/admin/users': 7 })
  const owner = navBadgesFrom(b, { id: 'o', adminRole: 'owner' }, { followUps: true, paidTutors: true, parentFollowUps: true })
  assert.equal(owner['/admin/users'], 7)
  assert.equal(owner['/admin/applications'], 4)
  assert.equal(owner['/admin/paid-tutors'], undefined)
})

test('lists: search never matches across two fields; sign-up day windows are Pakistan days', () => {
  const h = searchHaystack(['Ayesha', null, 'Lahore'])
  assert.equal(h, 'ayesha\nlahore')
  assert.ok(!h.includes('ayeshalahore'))
  const now = Date.parse('2026-11-01T20:00:00Z') // 2 Nov, 01:00 in Pakistan
  assert.equal(windowRange('today', now).since, '2026-11-01T19:00:00.000Z')
  assert.equal(windowRange('yesterday', now).since, '2026-10-31T19:00:00.000Z')
  assert.equal(windowRange('yesterday', now).until, '2026-11-01T19:00:00.000Z')
  assert.equal(tutorTabSection({ tab: 'todo', section: 'main' }), 'todo')
  assert.equal(tutorTabSection({ tab: 'sent', section: 'no_reply' }), 'no_reply')
  assert.equal(tutorTabSection({ tab: 'sent', section: 'main' }), 'sent')
})

test('lists: paging, chip and documents counts from the SQL answer', () => {
  assert.deepEqual(sliceFromList(['a', 'b'], 30, 25), { rows: ['a', 'b'], shown: 2, total: 30, more: 28, nextN: 50 })
  assert.equal(sliceFromList(['a'], 1, 25).nextN, null)
  const rc = { paid: { all: 10, paid: 4 } }
  assert.deepEqual(chipCountsFromList(rc, [{ param: 'paid', options: [{ key: 'all' }, { key: 'paid' }, { key: 'unpaid' }] }]), { paid: { all: 10, paid: 4, unpaid: 0 } })
  assert.equal(poolCount({ searched: 12, rowCounts: rc }, [{ param: 'paid' }], { paid: 'paid' }), 4)
  assert.equal(poolCount({ searched: 12, rowCounts: rc }, [], {}), 12)
  assert.deepEqual(splitCounts({ waiting: 3 }, ['all', 'waiting', 'approved'] as const, 9), { all: 9, waiting: 3, approved: 0 })
})

test('fast admin is wired: one badge read, the Overview and lists read the summary, the job is scheduled', () => {
  const layout = read('app/admin/layout.tsx')
  assert.match(layout, /readSummary\(\['badges'\]\)|readSummary\(\["badges"\]\)/)
  assert.match(layout, /navBadgesFrom\(/)
  assert.match(read('app/admin/page.tsx'), /readSummary\(/)
  assert.match(read('app/admin/users/PeopleTabs.tsx'), /listPage</)
  // Follow-ups merged into People (owner, 8 Nov 2026): the parent tab reads the stored list too.
  const fu = read('app/admin/users/FollowUpTabs.tsx')
  assert.ok((fu.match(/listPage</g) ?? []).length >= 2, 'the parent follow-ups tab')
  assert.ok(!read('app/admin/users/PeopleTabs.tsx').includes('loadTutorFollowUps('), 'no whole-list load on the page')
  assert.match(read('lib/activityLog.ts'), /markSummaryDirty\(/)
  assert.match(read('lib/auditLog.ts'), /markSummaryDirty\(/)
  const crons = JSON.parse(read('vercel.json')).crons as { path: string; schedule: string }[]
  assert.ok(crons.some((c) => c.path === '/api/cron/admin-summary' && c.schedule === '* * * * *'))
  // The lists are service-role only (RLS on, no policies, not granted to the keys members hold).
  const m218 = read('supabase/migrations/218_admin_summary_lists.sql')
  assert.match(m218, /enable row level security/i)
  assert.match(m218, /revoke all on (public\.)?admin_list_rows from anon, authenticated/i)
  const m219 = read('supabase/migrations/219_admin_list_page.sql')
  assert.match(m219, /revoke all on function public\.admin_list_page/i)
})

import { addRunToTally } from '../lib/adminSummaryCore'

test('job cost tally: adds runs per UTC day and keeps 14 days', () => {
  const d1 = Date.parse('2026-11-01T10:00:00Z')
  let t = addRunToTally(null, d1, 9_000, 2_000)
  t = addRunToTally(t, d1 + 60_000, 11_000, 3_000)
  assert.deepEqual(t['2026-11-01'], { runs: 2, wallMs: 20_000, cpuMs: 5_000 })
  for (let i = 1; i <= 20; i++) t = addRunToTally(t, d1 + i * 86_400_000, 1, 1)
  assert.equal(Object.keys(t).length, 14)
  assert.ok(!('2026-11-01' in t))
})
