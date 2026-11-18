/**
 * scripts/test-tutor-teasers.ts — PR-06 (owner, 18 Nov 2026): paid-tutor
 * teasers in the bell and the staff WhatsApp updates queue. Pure rules plus
 * source scans, on INVENTED data only. Nothing touches a database.
 *
 *   npm run test:teasers
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DAY_MS,
  TEASER_START_DAYS,
  WA_WEEKLY_CAP,
  WEEKLY_TEASER_CAP,
  allZero,
  applicationOpenedText,
  blurName,
  dailyTeaserAllowed,
  jobMatches,
  mayUndoWaSend,
  newTuitionsTeaser,
  pendingWaItems,
  pkDateKey,
  pkWeekStartMs,
  pkWeekday,
  planForTutor,
  safePlace,
  teaserBlock,
  teaserEligible,
  tipDue,
  tuitionsListHref,
  viewsTeaser,
  viewsTip,
  waKinds,
  waMessage,
  waRowState,
  weeklySummaryTeaser,
  type MatchJob,
  type MatchTutor,
  type SentLog,
  type TeaserEligibilityFacts,
  type WaItem,
  type WaSend,
} from '@/lib/tutorTeasersCore'
import { matchVisibilityCities } from '@/lib/matchChip'
import { genderApplyBlocked } from '@/lib/genderPref'
import { checkWording, SUPPORT_LINE, type Proposal } from '@/lib/templateProposals'
import { SCREEN_ACCESS, roleSatisfies, roleMayWrite } from '@/lib/adminAccessCore'
import { navBadgesFrom, type BadgesPayload } from '@/lib/adminSummaryCore'
import { inviteAllowed } from '@/lib/upgradesPausedCore'
import { ctaFor } from '@/lib/notificationActions'

// Pakistan time = UTC+5. 08:00 PKT = 03:00 UTC.
const pkt = (y: number, m: number, d: number, h = 8, min = 0) => Date.UTC(y, m - 1, d, h - 5, min)
const MON = pkt(2026, 11, 16)
const TUE = pkt(2026, 11, 17)
const WED = pkt(2026, 11, 18)
const THU = pkt(2026, 11, 19)
const FRI = pkt(2026, 11, 20)
const iso = (ms: number) => new Date(ms).toISOString()

const paidTutor = (over: Partial<TeaserEligibilityFacts> = {}): TeaserEligibilityFacts => ({
  role: 'tutor',
  feePaidAt: iso(WED - 10 * DAY_MS),
  ...over,
})

// ------------------------------------------------------------- Pakistan time ---

test('Pakistan weekdays and week start (Monday 00:00 PKT)', () => {
  assert.equal(pkWeekday(MON), 1)
  assert.equal(pkWeekday(THU), 4)
  assert.equal(pkWeekStartMs(WED), pkt(2026, 11, 16, 0))
  // Sunday 23:30 PKT still belongs to the week that began the Monday before.
  assert.equal(pkWeekStartMs(pkt(2026, 11, 22, 23, 30)), pkt(2026, 11, 16, 0))
  // Monday 00:30 PKT (still Sunday in UTC) starts a new week.
  assert.equal(pkWeekStartMs(pkt(2026, 11, 23, 0, 30)), pkt(2026, 11, 23, 0))
  assert.equal(pkDateKey(pkt(2026, 11, 18, 2)), '2026-11-18') // 02:00 PKT is 21:00 UTC the day before
})

// ------------------------------------------------------------------ eligibility ---

test('eligibility: paid tutors only, starting 2 days after payment', () => {
  assert.equal(teaserBlock(paidTutor(), WED), null)
  assert.equal(teaserBlock(paidTutor({ feePaidAt: null }), WED), 'not_paid')
  assert.equal(teaserBlock(paidTutor({ role: 'parent' }), WED), 'not_tutor')
  assert.equal(teaserBlock(paidTutor({ feePaidAt: iso(WED - 1 * DAY_MS) }), WED), 'too_soon')
  assert.equal(teaserBlock(paidTutor({ feePaidAt: iso(WED - TEASER_START_DAYS * DAY_MS + 60_000) }), WED), 'too_soon')
  assert.equal(teaserBlock(paidTutor({ feePaidAt: iso(WED - TEASER_START_DAYS * DAY_MS) }), WED), null, 'exactly 2 days is in')
})

test('eligibility: every exclusion', () => {
  const cases: [Partial<TeaserEligibilityFacts>, string][] = [
    [{ eraseRequested: true }, 'erase_requested'],
    [{ erased: true }, 'erase_requested'],
    [{ notInterested: true }, 'not_interested'],
    [{ suspended: true }, 'suspended'],
    [{ banned: true }, 'banned'],
    [{ selfPaused: true }, 'paused'],
    [{ staff: true }, 'staff'],
    [{ role: 'admin' }, 'staff'],
    [{ isTestName: true }, 'test'],
    [{ hidden: true }, 'test'],
    [{ isSeed: true }, 'test'],
    [{ isTeam: true }, 'test'],
    [{ mergedInto: 'invented-merge-target' }, 'test'],
  ]
  for (const [over, why] of cases) {
    assert.equal(teaserBlock(paidTutor(over), WED), why, JSON.stringify(over))
    assert.equal(teaserEligible(paidTutor(over), WED), false)
  }
})

// --------------------------------------------------------------- weekly cap ---

const log = (kind: string, ms: number): SentLog => ({ kind, created_at: iso(ms) })
const someViews = { parents: [{ name: 'Invented Parent', area: 'Model Town', city: 'Lahore' }], otherVisitors: 2 }
const plan = (nowMs: number, l: SentLog[], over: Partial<Parameters<typeof planForTutor>[0]> = {}) =>
  planForTutor({
    nowMs,
    log: l,
    views: someViews,
    newTuitions: { count: 3, href: '/browse/tuitions?city=Lahore' },
    weekly: { views: 4, applications: 1, tuitions: 6 },
    missing: null,
    ...over,
  })

test('weekly cap: never more than 3 teasers in a Pakistan week', () => {
  const sent: SentLog[] = []
  for (let d = 0; d < 7; d++) {
    const now = MON + d * DAY_MS
    for (const x of plan(now, sent)) sent.push(log(x.kind, now))
  }
  assert.ok(sent.length <= WEEKLY_TEASER_CAP, `sent ${sent.length}`)
  assert.equal(sent.length, 3)
  // Monday summary and Thursday views always got their slot.
  assert.deepEqual(sent.map((s) => s.kind).sort(), ['teaser_new_tuitions', 'teaser_profile_views', 'teaser_weekly_summary'])
})

test('weekly cap: the daily tuitions teaser leaves room for the Thursday views teaser', () => {
  assert.equal(dailyTeaserAllowed(0, TUE), true)
  assert.equal(dailyTeaserAllowed(1, TUE), true)
  assert.equal(dailyTeaserAllowed(2, TUE), false, 'one slot kept for Thursday')
  assert.equal(dailyTeaserAllowed(2, FRI), true, 'after Thursday the slot is free')
  assert.equal(dailyTeaserAllowed(3, FRI), false)
  // A week with no summary (all zero): tuitions Mon + Tue, views Thu = 3.
  const sent: SentLog[] = []
  for (let d = 0; d < 7; d++) {
    const now = MON + d * DAY_MS
    for (const x of plan(now, sent, { weekly: { views: 0, applications: 0, tuitions: 0 } })) sent.push(log(x.kind, now))
  }
  assert.equal(sent.length, 3)
  assert.ok(sent.some((s) => s.kind === 'teaser_profile_views'))
})

test('weekly cap: a new week starts on Monday; the application-opened alert is not counted', () => {
  const lastWeek = [log('teaser_weekly_summary', MON - 7 * DAY_MS), log('teaser_new_tuitions', MON - 6 * DAY_MS), log('teaser_profile_views', MON - 4 * DAY_MS)]
  assert.ok(plan(MON, lastWeek).length > 0)
  const opened = Array.from({ length: 5 }, (_, i) => log('application_opened', MON + i * 3_600_000))
  const out = plan(MON + 6 * 3_600_000, opened)
  assert.ok(out.some((x) => x.kind === 'teaser_weekly_summary'))
})

test('the same teaser never twice in a day, the weekly ones never twice a week', () => {
  const first = plan(MON, [])
  const again = plan(MON + 3_600_000, first.map((x) => log(x.kind, MON)))
  assert.equal(again.length, 0)
  const thuOnce = plan(THU, [log('teaser_profile_views', THU - 3_600_000)])
  assert.ok(!thuOnce.some((x) => x.kind === 'teaser_profile_views'))
})

// --------------------------------------------------------- nothing when 0 ---

test('no teaser when the data is 0', () => {
  assert.equal(viewsTeaser({ parents: [], otherVisitors: 0 }), null)
  assert.equal(newTuitionsTeaser(0, '/x'), null)
  assert.equal(newTuitionsTeaser(-1, '/x'), null)
  assert.equal(newTuitionsTeaser(Number.NaN, '/x'), null)
  assert.equal(weeklySummaryTeaser({ views: 0, applications: 0, tuitions: 0 }), null)
  assert.ok(allZero({ views: 0, applications: 0, tuitions: 0 }))
  assert.ok(weeklySummaryTeaser({ views: 0, applications: 1, tuitions: 0 }))
  // A quiet Tuesday: no new tuitions → nothing at all.
  assert.deepEqual(plan(TUE, [], { newTuitions: { count: 0, href: '/x' } }), [])
  // A Monday with all-zero numbers and no tuitions → nothing.
  assert.deepEqual(plan(MON, [], { weekly: { views: 0, applications: 0, tuitions: 0 }, newTuitions: { count: 0, href: '/x' } }), [])
})

test('0 views: one tip instead, at most once every 2 weeks', () => {
  const zero = { views: { parents: [], otherVisitors: 0 }, newTuitions: { count: 0, href: '/x' } }
  const a = plan(THU, [], zero)
  assert.deepEqual(a.map((x) => x.kind), ['teaser_views_tip'])
  // The next Thursday (7 days later): no tip yet.
  assert.deepEqual(plan(THU + 7 * DAY_MS, [log('teaser_views_tip', THU)], zero), [])
  // 14 days later: due again.
  assert.deepEqual(plan(THU + 14 * DAY_MS, [log('teaser_views_tip', THU)], zero).map((x) => x.kind), ['teaser_views_tip'])
  assert.equal(tipDue(null, THU), true)
  assert.equal(tipDue(iso(THU - 13 * DAY_MS), THU), false)
  assert.equal(tipDue(iso(THU - 14 * DAY_MS), THU), true)
  // The tip names a real missing item, else suggests sharing.
  const t1 = viewsTip({ label: 'Add your availability', href: '/tutor/dashboard/settings?open=availability' })
  assert.match(t1.body ?? '', /^Add your availability\. /)
  assert.equal(t1.href, '/tutor/dashboard/settings?open=availability')
  assert.match(viewsTip(null).body ?? '', /Share your profile link/)
  // Only visitors (no parents): the teaser counts them, never names anyone.
  const v = viewsTeaser({ parents: [], otherVisitors: 4 })
  assert.equal(v?.title, '👀 4 visitors viewed your profile this week')
  assert.equal(v?.body, null)
})

// ---------------------------------------------------- blurring and privacy ---

test('name blurring: first letter of first and last name, four stars', () => {
  assert.equal(blurName('Sana Khan'), 'S**** K****')
  assert.equal(blurName('ayesha bibi malik'), 'A**** M****')
  assert.equal(blurName('Zainab'), 'Z****')
  assert.equal(blurName('  '), 'A parent')
  assert.equal(blurName(null), 'A parent')
  assert.equal(blurName('Dr. Imran 03001234567 Ali'), 'D**** A****', 'digits never survive')
  // The star count never reveals the length.
  assert.equal(blurName('Al Bo').length, blurName('Alexandra Bartholomew').length)
})

test('the views teaser shows blurred names and the area only — never a phone, email or address', () => {
  const t = viewsTeaser({
    parents: [
      { name: 'Sana Khan', area: 'Gulberg', city: 'Lahore' },
      { name: 'Ahmed Mirza', area: 'Gulberg', city: 'Lahore' },
    ],
    otherVisitors: 4,
  })
  assert.ok(t)
  assert.equal(t.title, '👀 2 parents from Gulberg viewed your profile this week')
  assert.equal(t.body, 'S**** K**** (Gulberg), A**** M**** (Gulberg) and 4 other visitors.')
  const leaky = viewsTeaser({
    parents: [
      { name: 'Invented Person', area: 'House 12, Street 4, 03001234567', city: 'Lahore' },
      { name: 'Second Person someone@example.com', area: null, city: 'Karachi' },
      { name: 'Third Person', area: 'DHA', city: null },
      { name: 'Fourth Person', area: 'Clifton', city: null },
    ],
    otherVisitors: 0,
  })
  const text = `${leaky?.title} ${leaky?.body}`
  assert.doesNotMatch((leaky?.body ?? '').replace(/ and \d+ more parents?\.$/, ''), /\d/, 'no digits in the names/places — no phone, no house number')
  assert.doesNotMatch(text, /0300|1234567|House|Street/, 'an address-like area is not shown at all')
  assert.doesNotMatch(text, /@|example\.com/, 'no email')
  assert.doesNotMatch(text, /Invented|Person/, 'no real names')
  assert.match(leaky?.body ?? '', /^I\*\*\*\* P\*\*\*\* \(Lahore\), /, 'falls back to the city')
  assert.match(leaky?.body ?? '', /and 1 more parent\.$/, 'three names, then a count')
  assert.equal(viewsTeaser({ parents: [{ name: 'A B', area: 'X1', city: 'Y2' }], otherVisitors: 0 })?.title, '👀 1 parent viewed your profile this week')
  assert.equal(safePlace('12-B'), null)
  assert.equal(safePlace('Phase 5'), null)
  assert.equal(safePlace('Gulberg III'), 'Gulberg III')
})

// -------------------------------------------------- matching tuitions filter ---

const RULES = {
  visibility: (jt: string | null, jc: string | null, tt: readonly string[], tc: readonly string[]) => matchVisibilityCities(jt, jc, tt, tc),
  genderBlocked: (p: string | null, g: string | null) => genderApplyBlocked(p, g),
}
const tutor = (over: Partial<MatchTutor> = {}): MatchTutor => ({ masterIds: [11, 12], cities: ['Lahore'], jobTypes: ['Home Tutor'], gender: 'female', ...over })
const job = (over: Partial<MatchJob> = {}): MatchJob => ({ id: 'j1', masterIds: [12], city: 'Lahore', jobType: 'Home Tutor', genderPreference: null, createdAt: iso(WED), ...over })

test('matching tuitions: subjects, city/areas and Job Type', () => {
  assert.equal(jobMatches(job(), tutor(), RULES), true)
  assert.equal(jobMatches(job({ masterIds: [99] }), tutor(), RULES), false, 'no shared subject')
  assert.equal(jobMatches(job({ masterIds: [] }), tutor(), RULES), false)
  assert.equal(jobMatches(job(), tutor({ masterIds: [] }), RULES), false)
  assert.equal(jobMatches(job({ city: 'Karachi' }), tutor(), RULES), false, 'another city, in person')
  assert.equal(jobMatches(job({ city: 'Karachi' }), tutor({ cities: ['Lahore', 'Karachi'] }), RULES), true, 'a second city from the tutor areas')
  assert.equal(jobMatches(job({ jobType: 'School Teacher' }), tutor(), RULES), false, 'a Job Type the tutor does not offer')
  assert.equal(jobMatches(job({ city: 'Karachi', jobType: 'Online Tutor' }), tutor({ jobTypes: ['Home Tutor', 'Online Tutor'] }), RULES), true, 'online is city-agnostic')
})

test('matching tuitions: the gender rule', () => {
  assert.equal(jobMatches(job({ genderPreference: 'female' }), tutor({ gender: 'female' }), RULES), true)
  assert.equal(jobMatches(job({ genderPreference: 'male' }), tutor({ gender: 'female' }), RULES), false, 'a mismatched gender never counts')
  assert.equal(jobMatches(job({ genderPreference: 'male' }), tutor({ gender: null }), RULES), true, 'an unset tutor gender is not a mismatch')
  assert.equal(jobMatches(job({ genderPreference: null }), tutor({ gender: 'male' }), RULES), true)
})

test('the new-tuitions teaser links to the filtered list', () => {
  assert.equal(tuitionsListHref('Lahore', null), '/browse/tuitions?city=Lahore')
  assert.equal(tuitionsListHref('Lahore', 12), '/browse/tuitions?city=Lahore&subject=12')
  assert.equal(tuitionsListHref(null, null), '/tutor/dashboard/jobs')
  const t = newTuitionsTeaser(3, '/browse/tuitions?city=Lahore')
  assert.equal(t?.title, '📚 3 new tuitions in your areas in the last 24 hours')
  assert.equal(newTuitionsTeaser(1, '/x')?.title, '📚 1 new tuition in your areas in the last 24 hours')
})

// ------------------------------------------------------- application opened ---

test('application opened: the tuition title and area, nothing about the parent', () => {
  const t = applicationOpenedText({ title: 'O Level Physics Tutor', area: 'Gulberg', city: 'Lahore' })
  assert.equal(t.title, 'A parent opened your application for O Level Physics Tutor, Gulberg')
  assert.equal(t.href, '/tutor/dashboard/applications')
  assert.equal(applicationOpenedText({ title: null, area: null, city: 'Lahore' }).title, 'A parent opened your application for a tuition, Lahore')
  // Its own kind, outside the weekly cap.
  assert.equal(inviteAllowed('application_opened'), true)
  for (const k of ['teaser_profile_views', 'teaser_views_tip', 'teaser_new_tuitions', 'teaser_weekly_summary']) assert.equal(inviteAllowed(k), true, k)
})

test('application opened: recorded once, on the parent’s own tuition page, never under View as', () => {
  const page = readFileSync('app/(site)/parent/dashboard/job/[jobId]/page.tsx', 'utf8')
  assert.match(page, /recordParentApplicationViews\(/)
  assert.match(page, /getViewAsContext\(\)/)
  assert.match(page, /job\.parent_id !== userId\) notFound\(\)/, 'only the tuition’s own parent reaches the page')
  const io = readFileSync('lib/tutorTeasers.ts', 'utf8')
  assert.match(io, /onConflict: 'application_id', ignoreDuplicates: true/, 'first view only')
  assert.match(io, /kind: APPLICATION_OPENED_KIND/)
  const mig = readFileSync('supabase/migrations/235_tutor_teasers.sql', 'utf8')
  const table = mig.slice(mig.indexOf('create table if not exists public.application_parent_views'), mig.indexOf(');', mig.indexOf('create table if not exists public.application_parent_views')))
  assert.doesNotMatch(table, /parent_id|viewer|ip|device/i, 'no parent id, IP or device stored')
})

// ------------------------------------------------------------------- queue ---

const opened = (id: string, ms: number): WaItem => ({ kind: 'application_opened', applicationId: id, at: iso(ms), jobTitle: 'Home Tutor', area: 'Gulberg', city: 'Lahore' })
const sendAt = (ms: number, over: Partial<WaSend> = {}): WaSend => ({ id: `s${ms}`, createdAt: iso(ms), undoneAt: null, kinds: ['application_opened'], applicationIds: [], staffId: 'staff-1', staffName: 'Invented Staff', ...over })
const base = { eligible: true, optedIn: true, hasNumber: true }

test('queue: application opens (today or yesterday) and the Monday summary', () => {
  const items: WaItem[] = [opened('a1', WED - 3_600_000), opened('a2', WED - 30 * 3_600_000), opened('old', WED - 3 * DAY_MS), { kind: 'weekly_summary', numbers: { views: 1, applications: 0, tuitions: 0 } }]
  const p = pendingWaItems(items, [], WED)
  assert.deepEqual(p.map((i) => (i.kind === 'application_opened' ? i.applicationId : i.kind)), ['a1', 'a2'], 'summary only on Monday; old opens drop off')
  const mon = pendingWaItems([{ kind: 'weekly_summary', numbers: { views: 1, applications: 0, tuitions: 0 } }], [], MON)
  assert.equal(mon.length, 1)
  assert.equal(pendingWaItems([{ kind: 'weekly_summary', numbers: { views: 0, applications: 0, tuitions: 0 } }], [], MON).length, 0, 'all-zero summary never queued')
  // An open already sent is not offered again.
  assert.equal(pendingWaItems([opened('a1', WED - 3_600_000)], [sendAt(WED - 1_800_000, { applicationIds: ['a1'] })], WED).length, 0)
  // …unless that send was undone.
  assert.equal(pendingWaItems([opened('a1', WED - 3_600_000)], [sendAt(WED - 1_800_000, { applicationIds: ['a1'], undoneAt: iso(WED - 1_700_000) })], WED).length, 1)
})

test('queue: at most 2 a tutor a week', () => {
  const pending = [opened('a3', FRI - 3_600_000)]
  assert.equal(waRowState({ ...base, pending, sends: [] }, FRI), 'to_send')
  assert.equal(waRowState({ ...base, pending, sends: [sendAt(MON)] }, FRI), 'to_send')
  assert.equal(WA_WEEKLY_CAP, 2)
  assert.equal(waRowState({ ...base, pending, sends: [sendAt(MON), sendAt(WED)] }, FRI), 'hidden', 'third in a week is never offered')
  assert.equal(waRowState({ ...base, pending, sends: [sendAt(MON), sendAt(WED, { undoneAt: iso(WED + 1000) })] }, FRI), 'to_send', 'an undone send does not count')
  assert.equal(waRowState({ ...base, pending, sends: [sendAt(MON - 3 * DAY_MS), sendAt(MON - 2 * DAY_MS)] }, FRI), 'to_send', 'last week does not count')
  assert.equal(waRowState({ ...base, pending: [], sends: [] }, FRI), 'hidden', 'nothing to send')
  assert.equal(waRowState({ ...base, pending, sends: [sendAt(FRI - 60_000)] }, FRI), 'sent_today')
})

test('queue: opt-out, no number and every never-list tutor are left out', () => {
  const pending = [opened('a1', WED - 3_600_000)]
  assert.equal(waRowState({ ...base, optedIn: false, pending, sends: [] }, WED), 'hidden')
  assert.equal(waRowState({ ...base, hasNumber: false, pending, sends: [] }, WED), 'hidden')
  assert.equal(waRowState({ ...base, eligible: false, pending, sends: [] }, WED), 'hidden')
  const io = readFileSync('lib/waUpdates.ts', 'utf8')
  assert.match(io, /filter\(\(t\) => t\.block === null\)/, 'the queue starts from eligible tutors only')
  assert.match(io, /optedIn: t\.whatsappUpdates/)
})

test('queue: the message follows the WhatsApp wording rules', () => {
  const both = waMessage({ firstName: '{first_name}', items: [opened('a1', WED), { kind: 'weekly_summary', numbers: { views: 4, applications: 2, tuitions: 7 } }], link: '{link}', supportWhatsapp: '{support_whatsapp}' })
  const one = waMessage({ firstName: '{first_name}', items: [opened('a1', WED)], link: '{link}', supportWhatsapp: '{support_whatsapp}' })
  const summary = waMessage({ firstName: '{first_name}', items: [{ kind: 'weekly_summary', numbers: { views: 1, applications: 0, tuitions: 3 } }], link: '{link}', supportWhatsapp: '{support_whatsapp}' })
  const p = (body: string): Proposal => ({ key: 'wa_update', kind: 'whatsapp', title: 'WhatsApp update', recipient: 'tutor', body, allowed: ['first_name', 'link', 'support_whatsapp'], links: ['link'] }) as unknown as Proposal
  for (const body of [both, one, summary]) {
    assert.deepEqual(checkWording(p(body)), [], body)
    assert.equal(body.split('\n').pop(), SUPPORT_LINE)
  }
  assert.match(one, /^Assalam o Alaikum \{first_name\}, a parent opened your application for Home Tutor, Gulberg\.$/m)
  assert.match(both, /Your week: 4 profile views, 2 applications sent, 7 new tuitions in your areas\./)
  // Real values: one full link on its own line, no emoji, no price.
  const real = waMessage({ firstName: 'Invented', items: [opened('a1', WED)], link: 'https://www.tutormint.org/tutor/dashboard/applications', supportWhatsapp: '0300 0000000' })
  assert.ok(real.split('\n').includes('https://www.tutormint.org/tutor/dashboard/applications'))
  assert.doesNotMatch(real, /\p{Extended_Pictographic}/u)
  assert.doesNotMatch(real, /\bRs\b|PKR|rupee|Premium|Featured|upgrade/i)
  assert.deepEqual(waKinds([opened('a', 1), opened('b', 2)]), ['application_opened'])
})

test('queue: Send is logged with staff and time; Undo the same day by the sender', () => {
  const s = { createdAt: iso(WED - 3_600_000), undoneAt: null, staffId: 'staff-1' }
  assert.equal(mayUndoWaSend(s, { id: 'staff-1', adminRole: 'backend_support' }, WED), null)
  assert.match(mayUndoWaSend(s, { id: 'staff-2', adminRole: 'backend_support' }, WED) ?? '', /Only the person who sent it/)
  assert.equal(mayUndoWaSend(s, { id: 'owner-1', adminRole: 'owner' }, WED), null, 'the Owner may undo')
  assert.match(mayUndoWaSend(s, { id: 'staff-1', adminRole: 'backend_support' }, THU) ?? '', /on the day it was sent/)
  assert.match(mayUndoWaSend({ ...s, undoneAt: iso(WED) }, { id: 'staff-1', adminRole: 'backend_support' }, WED) ?? '', /already undone/)
  const io = readFileSync('lib/waUpdates.ts', 'utf8')
  assert.match(io, /staff_id: actor\.id/)
  assert.match(io, /staff_name: await staffName/)
  assert.match(io, /action: 'whatsapp_update\.send'/)
  assert.match(io, /action: 'whatsapp_update\.undo'/)
  assert.match(io, /undone_at: new Date\(\)\.toISOString\(\), undone_by: actor\.id/)
  assert.doesNotMatch(io, /\.delete\(/, 'nothing is deleted')
  assert.match(io, /waSendHref\(/, 'WhatsApp links only through lib/waLinkCore')
  assert.doesNotMatch(io + readFileSync('components/admin/WaUpdateRow.tsx', 'utf8'), /wa\.me\/|api\.whatsapp\.com/)
})

// ----------------------------------------------------------- access, badge ---

test('access: Owner, Project Manager and Backend Support only', () => {
  const list = SCREEN_ACCESS.waUpdates
  assert.equal(roleSatisfies('owner', list), true)
  assert.equal(roleSatisfies('partner', list), true)
  assert.equal(roleMayWrite('partner', list), true, 'the Project Manager may send')
  assert.equal(roleSatisfies('backend_support', list), true)
  for (const r of ['admin', 'operations', 'tuitions_staff', 'supervisor'] as const) assert.equal(roleSatisfies(r, list), false, r)
  const route = readFileSync('app/api/admin/whatsapp-updates/route.ts', 'utf8')
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.waUpdates\)/)
  const page = readFileSync('app/admin/whatsapp-updates/page.tsx', 'utf8')
  assert.match(page, /requireAdminRole\(\.\.\.SCREEN_ACCESS\.waUpdates\)/)
})

test('badge: today’s count, only for roles that open the page', () => {
  const b = { reports: 0, receipts: 0, peopleWaiting: 0, parentOverdue: 0, appsOverdue: { total: 0, byOwner: {} }, paidRed: { total: 0, byOwner: {} }, waUpdates: 5 } as BadgesPayload
  assert.equal(navBadgesFrom(b, { id: 'x', adminRole: 'backend_support' }, { followUps: false, waUpdates: true })['/admin/whatsapp-updates'], 5)
  assert.equal(navBadgesFrom(b, { id: 'x', adminRole: 'operations' }, { followUps: false, waUpdates: false })['/admin/whatsapp-updates'] ?? 0, 0)
})

// ----------------------------------------------------- honesty and opt-in ---

test('no upsell, no price, no superlative in any teaser', () => {
  const texts = [
    viewsTeaser({ parents: [{ name: 'Sana Khan', area: 'Gulberg', city: 'Lahore' }], otherVisitors: 1 }),
    viewsTip(null),
    viewsTip({ label: 'Add your availability', href: '/x' }),
    newTuitionsTeaser(2, '/x'),
    weeklySummaryTeaser({ views: 1, applications: 1, tuitions: 1 }),
    applicationOpenedText({ title: 'Home Tutor', area: 'DHA', city: 'Karachi' }),
  ]
  for (const t of texts) {
    const s = `${t?.title} ${t?.body ?? ''} ${t?.href}`
    assert.doesNotMatch(s, /premium|featured|upgrade|membership|\bRs\b|PKR|rupee|\bbest\b|\btop\b|largest|leading|No\.?\s?1/i, s)
  }
  for (const kind of ['teaser_profile_views', 'teaser_views_tip', 'teaser_new_tuitions', 'application_opened']) {
    const c = ctaFor({ kind, href: '/x' })
    assert.ok(!c || c.kind === 'link', `${kind} never an upgrade button`)
  }
})

test('opt-in: default on, changed only by the tutor, logged', () => {
  const mig = readFileSync('supabase/migrations/235_tutor_teasers.sql', 'utf8')
  assert.match(mig, /whatsapp_updates boolean not null default true/)
  const route = readFileSync('app/api/tutor/whatsapp-updates/route.ts', 'utf8')
  assert.match(route, /supabase\.auth\.getUser\(\)/)
  assert.match(route, /\.eq\('id', who\.userId\)/)
  assert.match(route, /event: 'whatsapp_updates_changed'/)
  const page = readFileSync('app/(site)/tutor/dashboard/settings/page.tsx', 'utf8')
  assert.match(page, /<WhatsAppUpdatesCard \/>/)
  const card = readFileSync('components/tutor/WhatsAppUpdatesCard.tsx', 'utf8')
  assert.match(card, /Send me updates on WhatsApp/)
})

test('nothing logs a name, phone or email', () => {
  for (const f of ['lib/tutorTeasers.ts', 'lib/waUpdates.ts', 'app/api/admin/whatsapp-updates/route.ts', 'app/api/tutor/whatsapp-updates/route.ts']) {
    const src = readFileSync(f, 'utf8')
    assert.doesNotMatch(src, /console\.(log|error|warn|info)\(/, f)
  }
})
