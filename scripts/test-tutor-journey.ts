/**
 * scripts/test-tutor-journey.ts — npm run test:tutorjourney
 *
 * Tutor journey (owner, 23 Oct 2026):
 *   A  Follow-ups → Tutors To do / Sent — 3 days to due again, "No reply after
 *      3 messages", a new step finished resets, Waiting on us stays in To do,
 *      the badge counts overdue To do only; sender-only 10-second Undo; the
 *      reason → template choice.
 *   B  The Activity tab — the backfill lines, newest first, "from records";
 *      no phone, CNIC or email on it or in what it logs; notes withdrawn,
 *      never deleted.
 *   C  Paid tutors — the red rules at exactly 1 day and exactly 7 days, and
 *      the badge per city owner.
 *   D  Convert account type — Owner only, the password re-check, the block
 *      for paid or approved accounts and its override, the hidden profile's
 *      301 and the sitemap, records left intact both ways.
 *   …and no price or superlative in any new template.
 * Pure rules + source scans. No browser, DB or network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DUE_AGAIN_DAYS,
  fuBadgeCount,
  progressKey,
  tabCounts,
  tabState,
  unansweredCount,
  undoProblem,
  UNDO_MS,
  type ContactRecord,
} from '../lib/tutorFollowUpTabsCore'
import {
  fillFollowUp,
  followReasonFor,
  FU_NEW_DEFAULTS,
  FU_REUSED_DEFAULTS,
  FU_TEMPLATES,
  REASON_TEMPLATE,
  templateWarnings,
  type FollowReason,
} from '../lib/followUpTemplatesCore'
import { buildJourney, countByKind, hasPii, journeyCounts, noteProblem, scrubPii, withdrawProblem, JOURNEY_LIVE_AT, type RawLine } from '../lib/journeyCore'
import { forwardOverdue, noContact, paidBadgeCount, redReasons, sortRows, toRow, type PaidApp, type PaidTutorFacts } from '../lib/paidTutorsCore'
import { convertBlockers, convertDecision, convertedTutorRedirect, convertTarget, postedAsParent } from '../lib/convertAccountCore'
import { SCREEN_ACCESS } from '../lib/adminAccessCore'
import { canApprove } from '../lib/adminAccessCore'
import type { TutorFollowFacts } from '../lib/tutorFollowUpCore'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-23T12:00:00.000Z')
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()
const read = (p: string) => readFileSync(p, 'utf8')

// ---------------------------------------------------------------- A: tabs

const P = progressKey({ stoppedStep: 'photo', completion: 40, feePaid: false, docsApproved: false })
const base = (contacts: ContactRecord[], extra: Partial<Parameters<typeof tabState>[0]> = {}) =>
  tabState({ joinedAt: ago(10), progress: P, waitingOnUs: false, contacts, ...extra }, NOW)

test('A: a message moves the tutor to Sent, due again exactly 3 days later', () => {
  const s = base([{ at: ago(1), progress: P }])
  assert.equal(s.tab, 'sent')
  assert.equal(s.section, 'sent')
  assert.equal(s.dueAt, new Date(Date.parse(ago(1)) + DUE_AGAIN_DAYS * DAY).toISOString())
  assert.equal(base([{ at: ago(3 - 1 / 1440), progress: P }]).tab, 'sent', 'just under 3 days: still Sent')
  assert.equal(base([{ at: ago(3), progress: P }]).tab, 'todo', 'exactly 3 days: due again')
})

test('A: after 3 messages with no progress the tutor stops being due ("No reply")', () => {
  const three = [ago(9), ago(6), ago(3.5)].map((at) => ({ at, progress: P }))
  const s = base(three)
  assert.equal(s.tab, 'sent')
  assert.equal(s.section, 'no_reply')
  assert.equal(s.overdue, false)
  assert.equal(s.dueAt, null)
  assert.equal(base(three.slice(1)).section, 'todo', 'two unanswered, last one over 3 days ago: To do')
  // Calls and notes (no snapshot) never count towards the three.
  assert.equal(unansweredCount([...three.slice(1), { at: ago(0.5), progress: null }], P), 2)
})

test('A: a new step finished resets the count but does not skip the 3-day wait (owner, 23 Oct 2026)', () => {
  // The real case: messaged at 53%, made progress to 73% two hours later.
  const at53 = progressKey({ stoppedStep: 'cnic_photos', completion: 53, feePaid: false, docsApproved: false })
  const at73 = progressKey({ stoppedStep: 'selfie', completion: 73, feePaid: false, docsApproved: false })
  const messaged = [{ at: ago(2 / 24), progress: at53 }]
  const twoHours = tabState({ joinedAt: ago(10), progress: at73, waitingOnUs: false, contacts: messaged }, NOW)
  assert.equal(twoHours.tab, 'sent', 'stays in Followed up after progress')
  assert.equal(twoHours.unanswered, 0, 'the count started again')
  assert.equal(twoHours.dueAt, new Date(Date.parse(messaged[0].at) + DUE_AGAIN_DAYS * DAY).toISOString(), 'due 3 days after the message')
  // Just before 3 days: still Followed up. At 3 days (still stuck): To do.
  assert.equal(tabState({ joinedAt: ago(10), progress: at73, waitingOnUs: false, contacts: [{ at: ago(2.9), progress: at53 }] }, NOW).tab, 'sent')
  const due = tabState({ joinedAt: ago(10), progress: at73, waitingOnUs: false, contacts: [{ at: ago(3), progress: at53 }] }, NOW)
  assert.equal(due.tab, 'todo')
  assert.equal(due.overdue, false, 'due today, not overdue yet')
  assert.equal(tabState({ joinedAt: ago(10), progress: at73, waitingOnUs: false, contacts: [{ at: ago(4.5), progress: at53 }] }, NOW).overdue, true)
  // Three messages at the old progress, then progress: the count is 0, not
  // "No reply", and the wait still holds for 3 days after the last one.
  const three = [ago(9), ago(6), ago(1)].map((at) => ({ at, progress: P }))
  const later = progressKey({ stoppedStep: 'selfie', completion: 47, feePaid: false, docsApproved: false })
  const s = tabState({ joinedAt: ago(10), progress: later, waitingOnUs: false, contacts: three }, NOW)
  assert.equal(s.unanswered, 0)
  assert.equal(s.section, 'sent', 'Followed up, not "No reply"')
  // When the wait is up they get the message for their NEW reason: the reason
  // is worked out from where they are now, not from the last message.
  const stuckAtSelfie = { rejected: [], docsWaiting: false, startedPayment: null, feePaid: false, docsApproved: false, stoppedStep: 'selfie' as const }
  assert.equal(followReasonFor({ ...stuckAtSelfie, stoppedStep: 'cnic_photos' }), 'no_cnic')
  assert.equal(followReasonFor(stuckAtSelfie), 'no_photo')
})

test('A: Waiting on us stays in To do with the action, and is never in the badge', () => {
  const s = base([], { waitingOnUs: true, reviewHref: '/admin/users/x#documents', joinedAt: ago(30) })
  assert.equal(s.tab, 'todo')
  assert.deepEqual(s.action, { label: 'Documents to review', href: '/admin/users/x#documents' })
  assert.equal(s.overdue, false)
  // Even after 3 messages it is not "No reply": it is waiting on us.
  assert.equal(base([ago(5), ago(4), ago(3.5)].map((at) => ({ at, progress: P })), { waitingOnUs: true }).tab, 'todo')
})

test('A: the badge counts overdue To do items only', () => {
  const never = base([], { joinedAt: ago(2) }) // never contacted, joined 2 days ago: overdue
  const fresh = base([], { joinedAt: ago(0.5) }) // joined today: due, not overdue
  const dueOneDay = base([{ at: ago(4), progress: P }]) // due since 1 day: exactly 1 day is not overdue
  const dueMore = base([{ at: ago(4.5), progress: P }]) // due for 1.5 days: overdue
  const sent = base([{ at: ago(1), progress: P }])
  const waiting = base([], { waitingOnUs: true, joinedAt: ago(20) })
  assert.equal(never.overdue, true)
  assert.equal(fresh.overdue, false)
  assert.equal(dueOneDay.overdue, false)
  assert.equal(dueMore.overdue, true)
  assert.equal(fuBadgeCount([never, fresh, dueOneDay, dueMore, sent, waiting]), 2)
  assert.deepEqual(tabCounts([never, sent, waiting]), { todo: 2, sent: 1, noReply: 0 })
})

test('A: Undo is the sender only, for 10 seconds in the browser', () => {
  assert.equal(UNDO_MS, 10_000)
  const row = { staffId: 'me', createdAt: new Date(NOW - 5_000).toISOString(), undoneAt: null }
  assert.equal(undoProblem(row, 'me', NOW), null)
  assert.equal(undoProblem(row, 'someone-else', NOW), 'not_yours')
  assert.equal(undoProblem({ ...row, createdAt: new Date(NOW - 120_000).toISOString() }, 'me', NOW), 'too_late')
  assert.equal(undoProblem({ ...row, undoneAt: ago(0) }, 'me', NOW), 'already_undone')
  assert.equal(undoProblem(null, 'me', NOW), 'not_found')
  // The record stays: Undo stamps it.
  const lib = read('lib/followUps.ts')
  assert.ok(lib.includes('undoTutorFollowUp') && !/\.from\('member_follow_ups'\)\s*\.delete\(/.test(lib))
  const route = read('app/api/admin/follow-ups/tutor/route.ts')
  assert.ok(route.includes('undoTutorFollowUp') && route.includes('SCREEN_ACCESS.unpaidSignups'))
})

const facts = (o: Partial<TutorFollowFacts> = {}): TutorFollowFacts => ({
  feePaid: false,
  completion: 40,
  stoppedStep: 'tagline',
  docsApproved: false,
  rejected: [],
  startedPayment: null,
  lastContactAt: null,
  ...o,
})

test('A: the WhatsApp template is chosen by the reason the tutor is stuck', () => {
  const cases: [Partial<TutorFollowFacts>, FollowReason, string | null][] = [
    [{ rejected: [{ doc: 'selfie', reason: 'Face not clear' }] }, 'reupload', 'fu_reupload'],
    [{ docsWaiting: true }, 'waiting', null],
    [{ startedPayment: { planCode: 'verified', startedAt: ago(0.2) } }, 'payment', 'payment_not_finished'],
    [{ docsApproved: true, stoppedStep: 'verify' }, 'fee_due', 'fee_not_paid'],
    [{ stoppedStep: 'mobile' }, 'no_mobile', 'signup_mobile_unverified'],
    [{ stoppedStep: 'cnic_photos' }, 'no_cnic', 'fu_no_cnic'],
    [{ stoppedStep: 'cnic_number' }, 'no_cnic', 'fu_no_cnic'],
    [{ stoppedStep: 'selfie' }, 'no_photo', 'fu_no_photo'],
    [{ stoppedStep: 'photo' }, 'no_photo', 'fu_no_photo'],
    [{ feePaid: true, stoppedStep: 'tagline' }, 'paid_unfinished', 'fu_paid_unfinished'],
    [{ stoppedStep: 'tagline' }, 'profile', 'profile_completion_nudge'],
  ]
  for (const [o, reason, key] of cases) {
    const r = followReasonFor(facts(o))
    assert.equal(r, reason, JSON.stringify(o))
    assert.equal(REASON_TEMPLATE[r], key)
  }
  // Existing stored templates are reused, not duplicated: their keys are the
  // ones already in the database.
  for (const t of FU_TEMPLATES.filter((x) => !x.isNew)) assert.ok(!t.key.startsWith('fu_'), t.key)
})

test('A: a filled message carries the link and the support number from settings', () => {
  const v = {
    firstName: 'Rida',
    completion: 61.6,
    nextStep: 'add your profile photo',
    continueLink: 'https://www.tutormint.org/tutor/dashboard',
    payLink: 'https://www.tutormint.org/pay/choose?plan=verified',
    document: 'selfie',
    reason: '',
    supportWhatsapp: '0300 1234567',
  }
  const t = fillFollowUp(FU_NEW_DEFAULTS.fu_reupload, v)
  assert.ok(t.includes('Assalam o Alaikum Rida') && t.includes('your selfie.') && !t.includes('{reason}'))
  assert.ok(t.includes('WhatsApp us on 0300 1234567'))
  const reused = fillFollowUp(FU_REUSED_DEFAULTS.profile_completion_nudge, v)
  assert.ok(reused.endsWith('Need help? WhatsApp us on 0300 1234567.') && reused.includes('\n\nhttps://www.tutormint.org/tutor/dashboard'))
  assert.ok(fillFollowUp(FU_NEW_DEFAULTS.fu_no_photo, v).includes('62% complete'))
  // A template that already names the number is not given a second line.
  const pay = fillFollowUp(FU_REUSED_DEFAULTS.payment_not_finished, { ...v, supportWhatsapp: '0321 5872222' }, 'pay')
  assert.equal(pay.match(/5872222/g)?.length, 1)
})

test('No price or superlative in any new template', () => {
  for (const [k, body] of Object.entries(FU_NEW_DEFAULTS)) {
    assert.deepEqual(templateWarnings(body), [], k)
    assert.ok(!/\b(rs|pkr|rupee)/i.test(body) && !/\d{3,}/.test(body), `${k} names no amount`)
  }
  const mig = read('supabase/migrations/196_tutor_journey.sql')
  for (const k of Object.keys(FU_NEW_DEFAULTS)) assert.ok(mig.includes(`'${k}'`), `${k} seeded`)
  const email = read('lib/notify/templates.ts')
  const block = email.slice(email.indexOf("case 'account_type_changed'"), email.indexOf("case 'sms_alert'"))
  assert.deepEqual(templateWarnings(block.replace(/\$\{[^}]+\}/g, '')), [])
})

// --------------------------------------------------------------- B: activity

const line = (id: string, at: string, kind: RawLine['kind'] = 'step', text = 'x'): RawLine => ({ id, at, kind, text, by: null })

test('B: the Activity tab is newest first, steady on ties, and marks lines from records', () => {
  const before = new Date(Date.parse(JOURNEY_LIVE_AT) - DAY).toISOString()
  const after = new Date(Date.parse(JOURNEY_LIVE_AT) + DAY).toISOString()
  const out = buildJourney([line('a', before, 'paid'), line('b', after, 'note'), line('c', before, 'applied'), line('b', after), line('bad', 'not a date')])
  assert.deepEqual(out.map((l) => l.id), ['b', 'c', 'a'])
  assert.deepEqual(out.map((l) => l.fromRecords), [false, true, true])
  assert.deepEqual(countByKind(out), { applied: 1, paid: 1 })
})

test('B: the summary counts applications, forwarded, waiting and hired', () => {
  const apps = [
    { jobId: 'j1', stage: 'applied', createdAt: ago(3) },
    { jobId: 'j2', stage: 'applied', createdAt: ago(3) },
    { jobId: 'j3', stage: 'contacted', createdAt: ago(3) },
    { jobId: 'j4', stage: 'hired', createdAt: ago(3) },
    { jobId: 'j5', stage: 'not_selected', createdAt: ago(3) },
  ]
  assert.deepEqual(journeyCounts(apps, new Set(['j2'])), { applications: 5, forwarded: 3, waitingToForward: 1, hired: 1 })
})

test('B: no phone, CNIC or email on the Activity tab or in its logs', () => {
  for (const pii of ['0300 1234567', '+92 300 1234567', '923001234567', '35202-1234567-1', '3520212345671', 'someone@example.com']) {
    assert.ok(hasPii(`call me on ${pii}`), pii)
    assert.ok(!scrubPii(`x ${pii} y`).includes(pii.replace(/\D/g, '').slice(-7) || pii), pii)
    assert.ok(noteProblem(`Spoke, number ${pii}`), pii)
    assert.ok(withdrawProblem(`wrong ${pii}`), pii)
  }
  assert.ok(!hasPii('Applied to TM-1303') && !hasPii('Called, will upload tonight') && !hasPii('Paid: Verification Fee'))
  assert.equal(noteProblem('Called, will upload the CNIC tonight'), null)
  // Every line passes through the scrub.
  assert.ok(!buildJourney([line('n', ago(1), 'note', 'Note: call 0300 1234567')])[0].text.includes('1234567'))
  // The loader selects no contact column and logs no note text.
  const lib = read('lib/journey.ts')
  for (const col of ['phone_number', 'whatsapp', 'email', 'cnic_number', 'staff_email', 'amount_pkr']) {
    assert.ok(!new RegExp(`select\\([^)]*\\b${col}\\b`).test(lib), `journey selects ${col}`)
  }
  const audit = lib.slice(lib.indexOf("action: 'member.note'"), lib.indexOf("action: 'member.note'") + 120)
  assert.ok(!audit.includes('body'), 'the note text is not in the audit log')
  const page = read('app/admin/users/[id]/activity/page.tsx')
  assert.ok(!/phone|email|cnic_number|msisdn/i.test(page.replace(/\/\/.*$/gm, '').replace(/No phone, CNIC number or email[^.]*\./g, '')))
})

test('B: notes are withdrawn, never deleted or edited', () => {
  const mig = read('supabase/migrations/196_tutor_journey.sql')
  assert.ok(mig.includes('create trigger member_notes_guard') && mig.includes("before update or delete on public.member_notes"))
  assert.ok(mig.includes('a member note cannot be edited') && mig.includes('member notes are never deleted'))
  assert.ok(mig.includes('a withdrawn note needs a reason'))
  for (const f of ['lib/journey.ts', 'app/api/admin/members/notes/route.ts']) assert.ok(!/\.delete\(/.test(read(f)), f)
  const lib = read('lib/journey.ts')
  assert.ok(lib.includes("withdrawn_reason: reason.trim()") && lib.includes(".is('withdrawn_at', null)"))
  assert.equal(withdrawProblem('  '), 'Say why the note is withdrawn.')
})

// ------------------------------------------------------------- C: paid tutors

const app = (o: Partial<PaidApp> = {}): PaidApp => ({ jobId: 'j', stage: 'applied', createdAt: ago(0.5), stageChangedAt: null, jobCreatedAt: ago(2), forwarded: false, ...o })
const tutor = (o: Partial<PaidTutorFacts> = {}): PaidTutorFacts => ({
  id: 't',
  name: 'Tutor',
  city: 'Lahore',
  paidAt: ago(2),
  apps: [],
  lastContactAt: ago(1),
  profileFinished: true,
  ownerId: 'aqsa',
  ...o,
})

test('C: waiting to forward turns red only after MORE than 1 day', () => {
  assert.equal(forwardOverdue(app({ createdAt: ago(1) }), NOW), false, 'exactly 1 day')
  assert.equal(forwardOverdue(app({ createdAt: new Date(NOW - DAY - 1).toISOString() }), NOW), true, '1 day and a moment')
  assert.equal(forwardOverdue(app({ createdAt: ago(3), forwarded: true }), NOW), false, 'in a live forward')
  assert.equal(forwardOverdue(app({ createdAt: ago(3), stage: 'contacted' }), NOW), false)
  assert.equal(forwardOverdue(app({ createdAt: ago(31), jobCreatedAt: ago(31) }), NOW), false, 'an Older tuition never counts')
})

test('C: no contact turns red at exactly 7 days', () => {
  assert.equal(noContact({ lastContactAt: ago(7), paidAt: ago(20) }, NOW), true, 'exactly 7 days')
  assert.equal(noContact({ lastContactAt: new Date(NOW - 7 * DAY + 1).toISOString(), paidAt: ago(20) }, NOW), false, 'just under 7 days')
  assert.equal(noContact({ lastContactAt: null, paidAt: ago(7) }, NOW), true, 'never contacted: from the day they paid')
  assert.equal(noContact({ lastContactAt: null, paidAt: ago(3) }, NOW), false)
})

test('C: red rows sort first and the badge counts the viewer’s cities (all for the Owner)', () => {
  const red1 = toRow(tutor({ id: 'r1', lastContactAt: ago(8), ownerId: 'aqsa' }), NOW)
  const red2 = toRow(tutor({ id: 'r2', apps: [app({ createdAt: ago(2) })], ownerId: 'nabeel' }), NOW)
  const fine = toRow(tutor({ id: 'ok', ownerId: 'aqsa' }), NOW)
  assert.deepEqual(redReasons(red2, NOW), ['waiting_to_forward'])
  assert.deepEqual(sortRows([fine, red1, red2]).map((r) => r.id).slice(0, 2).sort(), ['r1', 'r2'])
  assert.equal(sortRows([fine, red1, red2])[2].id, 'ok')
  assert.equal(paidBadgeCount([red1, red2, fine], { id: 'aqsa', adminRole: 'operations' }), 1)
  assert.equal(paidBadgeCount([red1, red2, fine], { id: 'owner', adminRole: 'owner' }), 2)
  assert.equal(paidBadgeCount([red1, red2, fine], { id: 'nobody', adminRole: 'tuitions_staff' }), 0)
})

// --------------------------------------------------------------- D: convert

test('D: only the site Owner sees or uses Convert', () => {
  assert.deepEqual(SCREEN_ACCESS.convertAccount, [])
  for (const r of ['admin', 'operations', 'tuitions_staff', 'partner'] as const) assert.equal(canApprove(r), false, r)
  assert.equal(canApprove('owner'), true)
  const route = read('app/api/admin/members/convert/route.ts')
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'))
  const post = route.slice(route.indexOf('export async function POST'))
  assert.ok(get.includes('refuseUnlessOwnerApproval'), 'GET refuses non-owners')
  assert.ok(post.includes('refuseUnlessOwnerApproval'), 'POST refuses non-owners')
  const page = read('app/admin/users/[id]/page.tsx')
  assert.ok(/canApprove\(actor\.adminRole\) && \(profile\.role === 'tutor' \|\| profile\.role === 'parent'\) && \(\s*<ConvertAccountCard/.test(page))
})

test('D: the change asks for the password again, like a bank payment', () => {
  const post = read('app/api/admin/members/convert/route.ts').split('export async function POST')[1]
  const fresh = post.indexOf('requireFreshAuth(gate.actor.id)')
  assert.ok(fresh > 0 && fresh < post.indexOf('convertAccount('), 'password re-check before the change')
  assert.ok(post.indexOf('refuseUnlessOwnerApproval') < fresh)
})

test('D: blocked for paid or approved accounts, unless confirmed again — with words, never numbers', () => {
  const blocked = { paid: [{ plan: 'Verification Fee', date: '3 Oct 2026' }], approvedDocs: ['CNIC', 'Selfie'] }
  assert.deepEqual(convertBlockers(blocked), ['Verification Fee paid on 3 Oct 2026', 'CNIC approved', 'Selfie approved'])
  const d = convertDecision({ role: 'tutor', reason: 'Signed up as tutor by mistake', facts: blocked, override: false })
  assert.equal(d.ok, false)
  assert.ok(!d.ok && d.needsOverride)
  assert.ok(!d.ok && !/\bRs\b|\d{5}/.test(d.message))
  assert.equal(convertDecision({ role: 'tutor', reason: 'Signed up as tutor by mistake', facts: blocked, override: true }).ok, true)
  assert.equal(convertDecision({ role: 'parent', reason: 'Wrong type', facts: { paid: [], approvedDocs: [] }, override: false }).ok, true)
  assert.equal(convertDecision({ role: 'parent', reason: ' ', facts: { paid: [], approvedDocs: [] }, override: false }).ok, false, 'a reason is required')
  assert.equal(convertDecision({ role: 'admin', reason: 'x y z', facts: { paid: [], approvedDocs: [] }, override: true }).ok, false)
  // Payments are read, never changed.
  const lib = read('lib/convertAccount.ts')
  assert.ok(!/from\('payments'\)\s*\.(update|delete|insert|upsert)/.test(lib.replace(/\s+/g, ' ')))
})

test('D: a hidden tutor profile 301s to Browse tutors for the city and leaves the sitemap', () => {
  assert.equal(convertedTutorRedirect('Lahore'), '/browse/tutors?city=Lahore')
  assert.equal(convertedTutorRedirect(null), '/browse/tutors')
  const proxy = read('proxy.ts')
  const at = proxy.indexOf('convertedTutorRedirectPath(request.nextUrl.pathname)')
  assert.ok(at > 0 && proxy.slice(at, at + 400).includes('NextResponse.redirect(target, 301)'))
  // The sitemap and search read tutor_directory, which lists role = 'tutor' only.
  assert.ok(read('supabase/migrations/154_search_pause_roles.sql').includes("(p.role = 'tutor'::user_role)"))
  assert.ok(read('supabase/migrations/196_tutor_journey.sql').includes("and p.role <> 'tutor'"))
})

test('D: convert and reverse leave every record intact', () => {
  assert.equal(convertTarget(convertTarget('tutor')), 'tutor')
  assert.equal(convertTarget(convertTarget('parent')), 'parent')
  assert.equal(postedAsParent('tutor'), true)
  assert.equal(postedAsParent('parent'), false)
  const lib = read('lib/convertAccount.ts').replace(/\s+/g, ' ')
  assert.ok(!/\.delete\(/.test(lib), 'nothing is deleted')
  for (const t of ['jobs', 'applications', 'member_follow_ups', 'user_documents', 'subscriptions'])
    assert.ok(!lib.includes(`from('${t}')`), `${t} untouched`)
  // Reversing a Tutor → Parent change shows the same tutor profile again.
  assert.ok(lib.includes('converted_to_parent_at: null'))
  assert.ok(lib.includes("action: 'member.convert_role'"))
})
