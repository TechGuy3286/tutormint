/**
 * scripts/test-interest-inbox.ts — PR-10 (owner, 19 Nov 2026): the central
 * Parent interest inbox. INVENTED data only — no database.
 *   1. one row per tutor, several parents and actions summed up honestly;
 *   2. hottest first (demo > message > shortlist > view), then newest;
 *   3. held, staff and test activity never used;
 *   4. the 3-day no-repeat rule and "New activity since sent";
 *   5. one Sent log shared by the inbox and the parent page;
 *   6. the message: blurred names, city/area, no contact details, wording rules;
 *   7. auto-assignment to the city owner, else the Owner; own rows by default;
 *   8. caps (one a day, two a week, 50 unpaid a day) and "waiting beyond cap";
 *   9. access, routes, badge and Overview wiring;
 *  10. the Approved-today chip drops at once after a follow-up (server time).
 *
 *   npm run test:interestinbox
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  applyCaps,
  assigneeFor,
  demoDetail,
  hotOrder,
  inboxLinkPath,
  inboxMessage,
  inboxTab,
  INBOX_UNPAID_DAILY_CAP,
  INBOX_WINDOW_DAYS,
  INTEREST_TODO_KEY,
  messageParents,
  NO_REPEAT_DAYS,
  PAID_CLOSING,
  parentLeftOut,
  pendingActivity,
  sendCounts,
  staffFilter,
  summarise,
  summaryLine,
  UNPAID_CLOSING,
  usableActivity,
  withinNoRepeat,
  type InboxActivity,
  type InboxKind,
  type InboxSend,
} from '../lib/interestInboxCore'
import { parentCounts, VERIFY_HREF } from '../lib/parentInterestCore'
import { DAY_MS, WA_WEEKLY_CAP } from '../lib/tutorTeasersCore'
import { checkWording, type Proposal } from '../lib/templateProposals'
import { roleMayWrite, roleSatisfies, SCREEN_ACCESS } from '../lib/adminAccessCore'
import { navBadgesFrom, type BadgesPayload } from '../lib/adminSummaryCore'
import { OVERVIEW_ITEMS, OVERVIEW_ITEM_KEYS } from '../lib/overviewItemsCore'
import { chipCountShift } from '../lib/pipelineRowUpdateCore'
import { pipeCardFrom, withContacts } from '../lib/tutorPipelineCardCore'
import { FU_APPROVED_TODAY } from '../lib/tutorPipelineCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const HOUR = 3_600_000
// Wed 18 Nov 2026, 10:00 PKT.
const NOW = Date.parse('2026-11-18T05:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

let n = 0
const act = (p: Partial<InboxActivity> & { kind: InboxKind }): InboxActivity => ({ id: `a${++n}`, tutorId: 't1', parentId: 'p1', at: iso(NOW - HOUR), ...p })
const send = (p: Partial<InboxSend> = {}): InboxSend => ({
  id: `s${++n}`,
  createdAt: iso(NOW - DAY_MS),
  undoneAt: null,
  channel: 'interest',
  activityAt: iso(NOW - DAY_MS - HOUR),
  unpaid: true,
  staffId: 'staff-1',
  staffName: 'Invented Staff',
  sentFrom: 'inbox',
  ...p,
})
const realParent = { counts: true, held: false }

// ------------------------------------------- 1. one row per tutor, honest ---

test('one row per tutor: several parents and actions, each parent counted once per kind', () => {
  const acts = [
    act({ parentId: 'p1', kind: 'demo', at: iso(NOW - 2 * HOUR) }),
    act({ parentId: 'p1', kind: 'shortlist', at: iso(NOW - 3 * HOUR) }),
    act({ parentId: 'p2', kind: 'view', at: iso(NOW - HOUR) }),
    act({ parentId: 'p2', kind: 'view', at: iso(NOW - 5 * HOUR) }), // same parent viewing twice = 1 view
    act({ parentId: 'p3', kind: 'view', at: iso(NOW - 6 * HOUR) }),
  ]
  const s = summarise(acts)!
  assert.equal(s.parents, 3)
  assert.deepEqual(s.counts, { demo: 1, message: 0, shortlist: 1, view: 2 })
  assert.equal(s.hottest, 'demo')
  assert.equal(s.lastAt, iso(NOW - HOUR))
  assert.equal(summaryLine(s, 'Lahore'), '3 parents · 1 demo request · 1 shortlist · 2 views · Lahore')
  assert.equal(summarise([]), null, 'no activity → no row')
  // The loader groups by tutor: one row each.
  const lib = read('lib/interestInbox.ts')
  assert.match(lib, /byTutor\.set\(a\.tutorId/)
})

// ------------------------------------------------------- 2. hottest first ---

test('hottest first: demo > message > shortlist > view, then the most recent', () => {
  const row = (tutorId: string, kind: InboxKind, hoursAgo: number) => ({ tutorId, summary: summarise([act({ tutorId, kind, at: iso(NOW - hoursAgo * HOUR) })])! })
  const rows = [row('view-new', 'view', 1), row('short', 'shortlist', 5), row('demo-old', 'demo', 20), row('msg', 'message', 2), row('demo-new', 'demo', 3)]
  assert.deepEqual(rows.sort(hotOrder).map((r) => r.tutorId), ['demo-new', 'demo-old', 'msg', 'short', 'view-new'])
})

// --------------------------------------- 3. held, staff and test left out ---

test('held, staff and test activity is never used; the window is 30 days; never the tutor on themselves', () => {
  const facts: Record<string, { counts: boolean; held: boolean }> = {
    real: realParent,
    held: { counts: true, held: true },
    staff: { counts: parentCounts({ role: 'parent', staff: true }), held: false },
    test: { counts: parentCounts({ role: 'parent', isTestName: true }), held: false },
  }
  const acts = [
    act({ id: 'ok', parentId: 'real', kind: 'demo' }),
    act({ id: 'h', parentId: 'held', kind: 'demo' }),
    act({ id: 's', parentId: 'staff', kind: 'demo' }),
    act({ id: 't', parentId: 'test', kind: 'shortlist' }),
    act({ id: 'old', parentId: 'real', kind: 'view', at: iso(NOW - (INBOX_WINDOW_DAYS + 1) * DAY_MS) }),
    act({ id: 'future', parentId: 'real', kind: 'view', at: iso(NOW + HOUR) }),
    act({ id: 'self', parentId: 't1', tutorId: 't1', kind: 'view' }),
    act({ id: 'unknown', parentId: 'nobody', kind: 'view' }),
  ]
  const out = usableActivity(acts, { nowMs: NOW, parent: (id) => facts[id] })
  assert.deepEqual(out.map((a) => a.id), ['ok'])
  // The parent page says why a parent is left out.
  assert.equal(parentLeftOut(facts.held), 'held')
  assert.equal(parentLeftOut(facts.staff), 'not_counted')
  assert.equal(parentLeftOut(facts.test), 'not_counted')
  assert.equal(parentLeftOut(facts.real), null)
  const panel = read('components/admin/ParentInterestPanel.tsx') + read('lib/interestInbox.ts')
  assert.match(panel, /Activity held — not used for tutor messages/)
  // The loader never releases or changes a hold and never withdraws a request.
  const lib = read('lib/interestInbox.ts')
  assert.doesNotMatch(lib, /interest_holds'\)\.(update|upsert|insert)|\.delete\(|demo_requests'\)\.update/)
})

// ---------------------------------- 4. no-repeat and New activity since sent ---

test('the 3-day no-repeat rule and "New activity since sent"', () => {
  const acts = [act({ kind: 'shortlist', at: iso(NOW - 2 * DAY_MS) })]
  assert.equal(inboxTab(acts, []).tab, 'to_send')
  const s = send({ createdAt: iso(NOW - DAY_MS), activityAt: iso(NOW - 2 * DAY_MS) })
  assert.equal(inboxTab(acts, [s]).tab, 'sent', 'nothing new since the send')
  assert.ok(withinNoRepeat(s, NOW))
  // Not offered again after 3 days for the same old activity either.
  assert.equal(NO_REPEAT_DAYS, 3)
  assert.equal(inboxTab(acts, [send({ createdAt: iso(NOW - 4 * DAY_MS), activityAt: iso(NOW - 5 * DAY_MS) })]).tab, 'new_since_sent', 'activity after what that send covered')
  assert.equal(inboxTab(acts, [send({ createdAt: iso(NOW - 4 * DAY_MS), activityAt: iso(NOW - 2 * DAY_MS) })]).tab, 'sent')
  assert.ok(!withinNoRepeat(send({ createdAt: iso(NOW - 4 * DAY_MS) }), NOW))
  // New activity inside the 3 days → its own tab, carrying only the new part.
  const fresh = act({ kind: 'demo', parentId: 'p9', at: iso(NOW - HOUR) })
  const t = inboxTab([...acts, fresh], [s])
  assert.equal(t.tab, 'new_since_sent')
  assert.deepEqual(pendingActivity([...acts, fresh], t.last).map((a) => a.id), [fresh.id])
  // An undone send carried nothing; a daily-channel send is not an interest send.
  assert.equal(inboxTab(acts, [{ ...s, undoneAt: iso(NOW - HOUR) }]).tab, 'to_send')
  assert.equal(inboxTab(acts, [{ ...s, channel: 'daily' }]).tab, 'to_send')
})

// ------------------------------------------------ 5. one shared Sent log ---

test('one Sent log: a send from the parent page is Sent in the inbox too', () => {
  const acts = [act({ kind: 'demo', at: iso(NOW - 2 * DAY_MS) })]
  const fromParentPage = send({ sentFrom: 'parent_page', activityAt: iso(NOW - 2 * DAY_MS) })
  assert.equal(inboxTab(acts, [fromParentPage]).tab, 'sent')
  // Both places render rows from the same loader and post to the same route.
  const lib = read('lib/interestInbox.ts')
  assert.match(lib, /export async function loadParentInterestPanel[^]*buildInbox\(admin, nowMs\)/)
  assert.match(lib, /from\('whatsapp_update_sends'\)[^]*channel: 'interest',[^]*sent_from: opts\.from/)
  const row = read('components/admin/InterestInboxRow.tsx')
  assert.match(row, /'\/api\/admin\/interest-inbox'/)
  assert.match(read('components/admin/ParentInterestPanel.tsx'), /from="parent_page"/)
  assert.match(read('app/admin/whatsapp-updates/page.tsx'), /from="inbox"/)
  // One live send a tutor a day, enforced by the database too.
  assert.match(read('supabase/migrations/238_parent_interest_inbox.sql'), /unique index if not exists whatsapp_update_sends_one_live_a_day[^]*where undone_at is null/)
  assert.match(lib, /error\?\.code === '23505'/)
})

// ------------------------------------------------------------ 6. message ---

const P = (name: string | null, city: string | null, area: string | null, kinds: InboxKind[], lastAt = iso(NOW)) => ({ name, city, area, kinds, lastAt })
const wording = (body: string): Proposal =>
  ({ key: 'interest_inbox', kind: 'whatsapp', title: 'Parent interest', recipient: 'tutor', body, allowed: ['first_name', 'link', 'support_whatsapp'], links: ['link'] }) as unknown as Proposal

test('message: one parent, unpaid — the spec wording, blurred name, verify link', () => {
  const msg = inboxMessage({ firstName: 'Ayesha', parents: [P('Sana Khan', 'Lahore', null, ['demo'])], paid: false, link: 'https://www.tutormint.org/tutor/complete-profile?step=verify', supportWhatsapp: '0321 5872222' })
  const lines = msg.split('\n')
  assert.equal(lines[0], 'Assalam o Alaikum Ayesha, a parent from Lahore requested a demo on TutorMint (S**** K****).')
  assert.equal(lines[1], UNPAID_CLOSING)
  assert.equal(lines[2], 'https://www.tutormint.org/tutor/complete-profile?step=verify')
  assert.equal(lines[3], 'Need help? WhatsApp 0321 5872222')
  assert.equal(inboxLinkPath(false, ['demo'], VERIFY_HREF), VERIFY_HREF)
})

test('message: several parents and kinds combined; paid closes with "Open TutorMint to reply"', () => {
  const parents = messageParents(
    [
      act({ parentId: 'p2', kind: 'view', at: iso(NOW - HOUR) }),
      act({ parentId: 'p1', kind: 'shortlist', at: iso(NOW - 3 * HOUR) }),
      act({ parentId: 'p1', kind: 'demo', at: iso(NOW - 2 * HOUR) }),
      act({ parentId: 'p3', kind: 'message', at: iso(NOW - 4 * HOUR) }),
      act({ parentId: 'p4', kind: 'view', at: iso(NOW - 5 * HOUR) }),
    ],
    (id) => ({ p1: { name: 'Javed Akhtar', city: 'Lahore', area: 'Gulberg' }, p2: { name: 'Sana Khan', city: 'Lahore', area: null }, p3: { name: 'Ali Raza', city: 'Karachi', area: null }, p4: { name: 'Hina', city: 'Multan', area: null } })[id],
  )
  assert.deepEqual(parents.map((p) => p.kinds), [['demo', 'shortlist'], ['message'], ['view'], ['view']], 'hottest parent first')
  const msg = inboxMessage({ firstName: 'Bilal', parents, paid: true, link: 'https://www.tutormint.org/messages', supportWhatsapp: '0321 5872222' })
  const lines = msg.split('\n')
  assert.equal(lines[0], 'Assalam o Alaikum Bilal, 4 parents showed interest in you on TutorMint.')
  assert.equal(
    lines[1],
    'A parent from Gulberg, Lahore requested a demo and shortlisted you (J**** A****). A parent from Karachi messaged you (A**** R****). A parent from Lahore viewed your profile (S**** K****). And 1 more parent.',
  )
  assert.equal(lines[2], PAID_CLOSING)
  assert.equal(inboxLinkPath(true, ['demo', 'view'], VERIFY_HREF), '/messages')
  assert.equal(inboxLinkPath(true, ['view'], VERIFY_HREF), '/tutor/dashboard')
  // Unpaid wording for a blocked message attempt.
  assert.match(inboxMessage({ firstName: 'X', parents: [P('Ali Raza', 'Karachi', null, ['message'])], paid: false, link: 'L', supportWhatsapp: 'S' }), /tried to message you/)
})

test('message: never a phone, email or address; follows the WhatsApp wording rules', () => {
  const odd = [P('Sana 03001234567 sana@example.com', 'House 12, Street 4', 'sana@example.com', ['shortlist']), P(null, null, null, ['view'])]
  for (const paid of [true, false]) {
    const msg = inboxMessage({ firstName: '{first_name}', parents: odd, paid, link: '{link}', supportWhatsapp: '{support_whatsapp}' })
    const body = msg.replace(/\{support_whatsapp\}/, '')
    assert.ok(!/(\+?92|0)3\d{2}[\s-]?\d{7}/.test(body), body)
    assert.ok(!/@/.test(body), body)
    assert.ok(!/House|Street|\d{3}/.test(body), body)
    assert.ok(!/\p{Extended_Pictographic}/u.test(msg), 'no emoji')
    assert.ok(!/\bRs\b|PKR|199|Premium|Featured|upgrade|best|largest|No\.1|leading/i.test(msg), 'no price, upsell or superlative')
    assert.match(msg, /\(S\*\*\*\* S\*\*\*\*\)/, 'only the blurred name')
    assert.doesNotMatch(msg, /\(A parent\)/, 'a parent with no name gets no blurred tag')
    // The paid closing is the owner's exact PR-10 wording, "Open TutorMint to
    // reply:" — one action (open the link; the reply happens in TutorMint), so
    // the template rule against "reply + link" is the only flag allowed.
    const flags = checkWording(wording(msg)).filter((f) => !(paid && /Asks for a reply and has a link/.test(f)))
    assert.deepEqual(flags, [], msg)
    const lines = msg.split('\n')
    assert.ok(lines.indexOf('{link}') <= 3, 'at most three lines before the link')
  }
  const one = inboxMessage({ firstName: '{first_name}', parents: [P('Sana Khan', 'Lahore', 'DHA', ['view'])], paid: false, link: '{link}', supportWhatsapp: '{support_whatsapp}' })
  assert.deepEqual(checkWording(wording(one)), [], one)
  // The page and the Overview never carry an unmasked parent phone.
  const lib = read('lib/interestInbox.ts')
  assert.match(lib, /maskedPhone: act\.phoneBy\.get\(pid\)/)
  assert.match(lib, /maskPhoneDisplay\(/)
  assert.doesNotMatch(lib, /console\.(log|error)/)
})

// ------------------------------------------------------ 7. assignment ---

test('auto-assignment: the city owner of the tutor’s city, else the Owner; own rows by default', () => {
  const owners = new Map([
    ['lahore', 'staff-lhr'],
    ['karachi', 'staff-khi'],
  ])
  assert.equal(assigneeFor('Lahore', owners, 'owner-1'), 'staff-lhr')
  assert.equal(assigneeFor('  karachi ', owners, 'owner-1'), 'staff-khi')
  assert.equal(assigneeFor('Quetta', owners, 'owner-1'), 'owner-1', 'unassigned city → the Owner')
  assert.equal(assigneeFor(null, owners, 'owner-1'), 'owner-1')
  // The staff filter: own rows by default; "All" only for roles that see all.
  assert.deepEqual(staffFilter(true, 'me', undefined), { mode: 'one', staffId: 'me' })
  assert.deepEqual(staffFilter(true, 'me', 'all'), { mode: 'all' })
  assert.deepEqual(staffFilter(true, 'me', 'staff-lhr'), { mode: 'one', staffId: 'staff-lhr' })
  assert.deepEqual(staffFilter(false, 'me', 'all'), { mode: 'one', staffId: 'me' }, 'a city owner never sees others’ rows')
  assert.deepEqual(staffFilter(false, 'me', 'staff-lhr'), { mode: 'one', staffId: 'me' })
  // The send route refuses another staff member's row for those roles.
  assert.match(read('lib/interestInbox.ts'), /if \(!opts\.seesAll && row\.assigneeId !== actor\.id\) return \{ ok: false, status: 403/)
})

// ------------------------------------------------------------- 8. caps ---

test('caps: one a day and two a week (any channel), 50 unpaid a day; parent interest ranks first', () => {
  const r = (tutorId: string, unpaid: boolean, today = 0, week = 0) => ({ tutorId, unpaid, today, week })
  const rows = [r('sent-today', false, 1, 1), r('week-full', true, 0, WA_WEEKLY_CAP), ...Array.from({ length: 60 }, (_, i) => r(`u${i}`, true)), r('paid', false)]
  const w = applyCaps(rows, { unpaidSentToday: 5 })
  assert.equal(w.get('sent-today'), 'sent_today')
  assert.equal(w.get('week-full'), 'week_cap')
  const readyUnpaid = [...w.entries()].filter(([k, v]) => k.startsWith('u') && v === null).length
  assert.equal(readyUnpaid, INBOX_UNPAID_DAILY_CAP - 5, '50 a day, counting today’s unpaid sends')
  assert.equal(w.get('u0'), null, 'hottest rows take the cap first')
  assert.equal(w.get('u59'), 'daily_cap', 'the rest wait beyond today’s cap')
  assert.equal(w.get('paid'), null, 'paid tutors are not under the unpaid cap')
  assert.equal(INBOX_UNPAID_DAILY_CAP, 50)
  // Sends of both channels count toward the caps.
  const c = sendCounts([send({ createdAt: iso(NOW - HOUR), channel: 'daily' }), send({ createdAt: iso(NOW - DAY_MS) }), send({ createdAt: iso(NOW - HOUR), undoneAt: iso(NOW) })], NOW)
  assert.deepEqual(c, { today: 1, week: 2 })
  // The page shows how many wait beyond the cap.
  assert.match(read('app/admin/whatsapp-updates/page.tsx'), /waiting beyond today&apos;s cap/)
  // PR-08 unpaid sends made earlier today on the daily channel still count.
  assert.match(read('lib/interestInbox.ts'), /channel === 'daily' && kinds\.some\(\(k\) => k === 'parent_interest' \|\| k === 'profile_views'\)/)
})

// ------------------------------------------- 9. access, badge, Overview ---

test('access: city owners (Manager, Tuitions staff) open the inbox for their own rows; Today tab unchanged', () => {
  for (const role of ['owner', 'partner', 'backend_support', 'supervisor', 'tuitions_staff'] as const) assert.equal(roleSatisfies(role, SCREEN_ACCESS.interestInbox), true, role)
  for (const role of ['admin', 'operations'] as const) assert.equal(roleSatisfies(role, SCREEN_ACCESS.interestInbox), false, role)
  assert.equal(roleMayWrite('partner', SCREEN_ACCESS.interestInbox), true)
  for (const role of ['supervisor', 'tuitions_staff'] as const) {
    assert.equal(roleSatisfies(role, SCREEN_ACCESS.interestInboxAll), false, role)
    assert.equal(roleSatisfies(role, SCREEN_ACCESS.waUpdates), false, `${role} never sees the Today tab or Held activity`)
  }
  const route = read('app/api/admin/interest-inbox/route.ts')
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.interestInbox\)/)
  // PR-12: every row by role (Owner/Partner) or by the per-account grant (lib/staffAllRows).
  assert.match(route, /seesAllRows\(gate\.actor, SCREEN_ACCESS\.interestInboxAll\)/)
  assert.match(route, /undoWaSend\(b\.id, gate\.actor\)/, 'Undo: the sender or the Owner, the same day')
})

test('badge: the inbox adds to WhatsApp updates — every ready row, or a city owner’s own', () => {
  const b = {
    reports: 0,
    receipts: 0,
    peopleWaiting: 0,
    parentOverdue: 0,
    appsOverdue: { total: 0, byOwner: {} },
    paidRed: { total: 0, byOwner: {} },
    waUpdates: 2,
    interestInbox: { total: 9, byOwner: { 'staff-lhr': 4 } },
  } as BadgesPayload
  const href = '/admin/whatsapp-updates'
  assert.equal(navBadgesFrom(b, { id: 'bs', adminRole: 'backend_support' }, { followUps: false, waUpdates: true, interestAll: true, interestOwn: true })[href], 11)
  assert.equal(navBadgesFrom(b, { id: 'staff-lhr', adminRole: 'supervisor' }, { followUps: false, waUpdates: false, interestAll: false, interestOwn: true })[href], 4)
  assert.equal(navBadgesFrom(b, { id: 'x', adminRole: 'operations' }, { followUps: false })[href] ?? 0, 0)
  assert.match(read('app/admin/layout.tsx'), /interestOwn: roleSatisfies\(actor\.adminRole, SCREEN_ACCESS\.interestInbox\)/)
  assert.match(read('lib/adminSummary.ts'), /interestInbox: inbox \?\? prev\?\.interestInbox/)
})

test('Overview: "Parent interest to send" with the demo count, opens the inbox, hidden at 0', () => {
  assert.ok((OVERVIEW_ITEM_KEYS as readonly string[]).includes(INTEREST_TODO_KEY))
  assert.equal(OVERVIEW_ITEMS[INTEREST_TODO_KEY].title, 'Parent interest to send')
  assert.equal(OVERVIEW_ITEMS[INTEREST_TODO_KEY].screen, 'interestInbox')
  assert.equal(demoDetail(3), '3 demo requests')
  assert.equal(demoDetail(1), '1 demo request')
  assert.equal(demoDetail(0), null)
  const page = read('app/admin/page.tsx')
  const todo = page.slice(page.indexOf('const TODO_KEYS'), page.indexOf('const STEP_KEYS'))
  assert.ok(todo.includes("'todo-interest'"))
  assert.match(page, /k === INTEREST_TODO_KEY \? INBOX_HREF/)
  assert.match(page, /\.filter\(\(r\) => r\.count > 0\)/)
  // The Overview row moves at once after Send/Undo (refreshWaBadge).
  assert.match(read('lib/waUpdates.ts'), /\[INTEREST_TODO_KEY\]: \{ \.\.\.item, count: inbox\.ready, extra: demoDetail\(inbox\.readyDemo\) \}/)
})

test('the daily queue keeps paid application/summary news only; both share the caps and Undo', () => {
  const wa = read('lib/waUpdates.ts')
  assert.doesNotMatch(wa, /unpaidQueueRows|loadUnpaidFacts/)
  assert.match(wa, /const row = t \? buildRow\(t, f, nowMs\) : null/)
})

// ---------------------------------------------- 10. Approved today ---

test('Approved today drops at once after a follow-up, judged at the server’s time', () => {
  const at = NOW
  const fresh = pipeCardFrom({
    name: 'Invented Tutor',
    feePaid: false,
    completion: 90,
    mobileOk: true,
    docs: {
      statuses: { cnic: { status: 'approved', reason: null, hasUpload: true }, profilePic: { status: 'approved', reason: null, hasUpload: true }, selfie: { status: 'none', reason: null, hasUpload: false } },
      oldestUploadAt: null,
      approvedAt: iso(at - HOUR),
    },
    contacts: [],
    notInterested: false,
    paused: false,
    lastActiveAt: iso(at),
    support: null,
    nowMs: at,
  })
  const after = withContacts(fresh, [{ at: iso(at - 60_000), kind: 'whatsapp', stage: 'approved', docsApproved: null, staffName: 'Staff A' }], at)
  const view = { stage: 'approved', fu: FU_APPROVED_TODAY, ni: false }
  assert.equal(chipCountShift(fresh, after, view, at).fu[FU_APPROVED_TODAY], -1)
  // A day later on the wall clock the same move is still judged at `at`.
  assert.equal(chipCountShift(fresh, after, view, at).fu.not, -1)
})
