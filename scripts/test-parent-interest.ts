/**
 * scripts/test-parent-interest.ts — PR-08 (owner, 18 Nov 2026): parent-interest
 * teasers for paid and unpaid tutors, the burst hold, caps, the paced backfill
 * and the WhatsApp queue's unpaid rows. INVENTED data only — no database.
 *
 *   npm run test:parentinterest
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  BACKFILL_TUTORS_PER_DAY,
  backfillPicks,
  burstOf,
  BURST_LIMIT,
  decideHold,
  EVENT_USABLE_DAYS,
  GET_VERIFIED_LINE,
  groupByParent,
  holdAfterBurst,
  interestTeaser,
  isHeld,
  parentCounts,
  unpaidApplyLine,
  usableEvents,
  type InterestEvent,
  type InterestParent,
} from '../lib/parentInterestCore'
import { INBOX_UNPAID_DAILY_CAP } from '../lib/interestInboxCore'
import {
  DAY_MS,
  newTuitionsTeaser,
  pendingWaItems,
  planForTutor,
  teaserBlock,
  TEASER_KINDS,
  waMessage,
  WEEKLY_TEASER_CAP,
  type SentLog,
  type TeaserEligibilityFacts,
  type WaItem,
} from '../lib/tutorTeasersCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// Wednesday 18 Nov 2026, 10:00 PKT (05:00 UTC).
const WED = Date.UTC(2026, 10, 18, 5, 0, 0)
const iso = (ms: number) => new Date(ms).toISOString()

const PHONE = /(\+?92|0)3\d{2}[\s-]?\d{7}/
const EMAIL = /@/

function ev(p: Partial<InterestEvent> & { id: string }): InterestEvent {
  return { tutorId: 't1', parentId: 'p1', kind: 'shortlist', createdAt: iso(WED - 3600_000), source: 'live', alertedAt: null, ...p }
}

const parentsMap = new Map([
  ['p1', { name: 'Javed Akhtar', city: 'Lahore', area: 'Gulberg' }],
  ['p2', { name: 'Sana Khan', city: 'Lahore', area: 'DHA' }],
  ['p3', { name: 'Ali Raza', city: 'Karachi', area: null }],
])

// ------------------------------------------------------------ wording ---

test('unpaid: grouped shortlist alert, blurred names, city, verify line', () => {
  const parents = groupByParent([ev({ id: 'e1', parentId: 'p1', createdAt: iso(WED - 7200_000) }), ev({ id: 'e2', parentId: 'p2' })], parentsMap)
  const t = interestTeaser(parents, false)!
  assert.equal(t.title, '❤️ 2 parents from Lahore shortlisted your profile: S**** K****, J**** A****')
  assert.equal(t.body, GET_VERIFIED_LINE)
  assert.equal(GET_VERIFIED_LINE, 'Get verified so parents can contact you.')
  assert.match(t.href, /step=verify/)
})

test('paid: the same alert without the verify line', () => {
  const parents = groupByParent([ev({ id: 'e1', parentId: 'p1' }), ev({ id: 'e2', parentId: 'p2', createdAt: iso(WED - 7200_000) })], parentsMap)
  const t = interestTeaser(parents, true)!
  assert.equal(t.title, '❤️ 2 parents from Lahore shortlisted your profile: J**** A****, S**** K****')
  assert.equal(t.body, null)
  assert.ok(!t.href.includes('verify'))
})

test('contact attempts: "tried to contact you" unpaid, "contacted you" paid; mixed kinds', () => {
  const one: InterestParent[] = [{ name: 'Ali Raza', city: 'Karachi', area: null, kinds: ['message'] }]
  assert.equal(interestTeaser(one, false)!.title, '❤️ 1 parent from Karachi tried to contact you: A**** R****')
  assert.equal(interestTeaser(one, true)!.title, '❤️ 1 parent from Karachi contacted you: A**** R****')
  const mixed = groupByParent(
    [ev({ id: 'a', parentId: 'p1', kind: 'shortlist' }), ev({ id: 'b', parentId: 'p3', kind: 'demo' }), ev({ id: 'c', parentId: 'p1', kind: 'message' })],
    parentsMap,
  )
  const t = interestTeaser(mixed, false)!
  assert.match(t.title, /^❤️ 2 parents showed interest in your profile: /) // two cities → no "from"
  assert.equal(t.body, `1 shortlisted you · 2 tried to contact you. ${GET_VERIFIED_LINE}`)
})

test('a parent counts once however many times; more than 3 names collapse', () => {
  const many = ['p1', 'p1', 'p1'].map((p, i) => ev({ id: `x${i}`, parentId: p }))
  assert.match(interestTeaser(groupByParent(many, parentsMap), true)!.title, /^❤️ 1 parent from Lahore/)
  const five: InterestParent[] = ['Aa Bb', 'Cc Dd', 'Ee Ff', 'Gg Hh', 'Ii Jj'].map((name) => ({ name, city: 'Lahore', area: null, kinds: ['shortlist'] }))
  assert.match(interestTeaser(five, true)!.title, /: A\*\*\*\* B\*\*\*\*, C\*\*\*\* D\*\*\*\*, E\*\*\*\* F\*\*\*\* and 2 more$/)
})

test('no events, no alert; no contact details ever, even from odd profile fields', () => {
  assert.equal(interestTeaser([], false), null)
  const odd: InterestParent[] = [{ name: 'Sana 03001234567 sana@example.com', city: 'House 12, Street 4', area: 'sana@example.com', kinds: ['shortlist'] }]
  const t = interestTeaser(odd, false)!
  const all = `${t.title} ${t.body}`
  assert.ok(!PHONE.test(all), all)
  assert.ok(!EMAIL.test(all), all)
  assert.ok(!/House|Street|\d{3}/.test(all), all)
})

// ------------------------------------------------------- who counts ---

test('staff, test, seed, team, hidden, merged and erased parents never count', () => {
  const base = { role: 'parent' }
  assert.equal(parentCounts(base), true)
  for (const extra of [{ staff: true }, { isTestName: true }, { isSeed: true }, { isTeam: true }, { hidden: true }, { mergedInto: 'x' }, { erased: true }, { role: 'tutor' }, { role: 'admin' }]) {
    assert.equal(parentCounts({ ...base, ...extra }), false, JSON.stringify(extra))
  }
  const events = [ev({ id: 'real', parentId: 'real' }), ev({ id: 'staff', parentId: 'staff' }), ev({ id: 'test', parentId: 'test' })]
  const ok = usableEvents(events, { nowMs: WED, countsParent: (id) => id === 'real', held: () => false })
  assert.deepEqual(ok.map((e) => e.id), ['real'])
})

test('usable: not alerted, not held, not too old, not the tutor themselves', () => {
  const events = [
    ev({ id: 'ok' }),
    ev({ id: 'alerted', alertedAt: iso(WED - DAY_MS) }),
    ev({ id: 'old', createdAt: iso(WED - (EVENT_USABLE_DAYS + 1) * DAY_MS) }),
    ev({ id: 'self', parentId: 't1' }),
    ev({ id: 'held', parentId: 'h' }),
  ]
  const ok = usableEvents(events, { nowMs: WED, countsParent: () => true, held: (id) => id === 'h' })
  assert.deepEqual(ok.map((e) => e.id), ['ok'])
})

// ------------------------------------------------------------ burst ---

test('burst: more than 20 shortlists (or attempts) inside one hour; exactly 20 is fine', () => {
  const at = (i: number, kind: 'shortlist' | 'message' | 'demo' = 'shortlist') => ({ kind, createdAt: iso(WED + i * 60_000) })
  assert.equal(burstOf(Array.from({ length: BURST_LIMIT }, (_, i) => at(i))), null)
  const b = burstOf(Array.from({ length: BURST_LIMIT + 1 }, (_, i) => at(i)))
  assert.ok(b && b.shortlists === 21)
  // 21 spread over more than an hour is not a burst.
  assert.equal(burstOf(Array.from({ length: 21 }, (_, i) => at(i * 4))), null)
  // Attempts (message + demo together) count on their own.
  const mixed = [...Array.from({ length: 11 }, (_, i) => at(i, 'message')), ...Array.from({ length: 10 }, (_, i) => at(i + 11, 'demo'))]
  assert.ok(burstOf(mixed)?.attempts === 21)
  // 15 shortlists + 15 attempts is neither.
  assert.equal(burstOf([...Array.from({ length: 15 }, (_, i) => at(i)), ...Array.from({ length: 15 }, (_, i) => at(i, 'message'))]), null)
})

test('hold flow: default held → Release / Keep held; a release bursts again → held again', () => {
  const burst = { windowStart: iso(WED), shortlists: 25, attempts: 0 }
  assert.equal(holdAfterBurst(null, burst), 'create')
  assert.equal(holdAfterBurst(null, null), null)
  const held = { status: 'held' as const, decidedAt: null }
  assert.equal(isHeld(held), true)
  assert.equal(holdAfterBurst(held, burst), null)
  const rel = decideHold(held, 'release')
  assert.deepEqual(rel, { status: 'released' })
  const released = { status: 'released' as const, decidedAt: iso(WED + 1000) }
  assert.equal(isHeld(released), false)
  assert.equal(holdAfterBurst(released, burst), null, 'the burst it was released for does not re-hold')
  assert.equal(holdAfterBurst(released, { ...burst, windowStart: iso(WED + DAY_MS) }), 'rehold')
  assert.deepEqual(decideHold(held, 'keep'), { status: 'kept' })
  assert.equal(isHeld({ status: 'kept', decidedAt: iso(WED) }), true)
  assert.ok('error' in decideHold(null, 'release'))
  assert.ok('error' in decideHold(released, 'release'))
  // Held events never reach a teaser.
  const out = usableEvents([ev({ id: 'a', parentId: 'burst' })], { nowMs: WED, countsParent: () => true, held: (id) => id === 'burst' })
  assert.equal(out.length, 0)
})

test('the held route is Owner-only, logged, and never changes the account', () => {
  const route = read('app/api/admin/held-activity/route.ts')
  assert.match(route, /refuseUnlessOwnerModeration/)
  const lib = read('lib/parentInterest.ts')
  assert.match(lib, /interest_hold\.release/)
  assert.match(lib, /interest_hold\.keep/)
  assert.ok(!/is_suspended|is_banned|\.delete\(/.test(lib), 'no suspension, no ban, nothing deleted')
  assert.match(read('lib/adminAccessCore.ts'), /heldActivity: \[\] as AdminRole\[\]/)
  const page = read('app/admin/whatsapp-updates/page.tsx')
  assert.match(page, /isOwner \? loadHeldActivity\(\)/)
})

// ----------------------------------------------------- eligibility ---

const tutor = (f: Partial<TeaserEligibilityFacts> = {}): TeaserEligibilityFacts => ({ role: 'tutor', feePaidAt: null, ...f })

test('unpaid tutors are eligible only with allowUnpaid; every exclusion still applies', () => {
  assert.equal(teaserBlock(tutor(), WED), 'not_paid', 'PR-06 callers unchanged')
  assert.equal(teaserBlock(tutor(), WED, { allowUnpaid: true }), null)
  const cases: [Partial<TeaserEligibilityFacts>, string][] = [
    [{ eraseRequested: true }, 'erase_requested'],
    [{ notInterested: true }, 'not_interested'],
    [{ suspended: true }, 'suspended'],
    [{ banned: true }, 'banned'],
    [{ selfPaused: true }, 'paused'],
    [{ staff: true }, 'staff'],
    [{ isTestName: true }, 'test'],
    [{ isSeed: true }, 'test'],
    [{ hidden: true }, 'test'],
    [{ unclaimedImport: true }, 'unclaimed'],
  ]
  for (const [f, why] of cases) assert.equal(teaserBlock(tutor(f), WED, { allowUnpaid: true }), why, JSON.stringify(f))
})

// --------------------------------------------------------------- caps ---

const interest = { text: { title: '❤️ 1 parent shortlisted your profile: J**** A****', body: null, href: '/tutor/dashboard' } }
const plan = (log: SentLog[], extra: Partial<Parameters<typeof planForTutor>[0]> = {}) =>
  planForTutor({ nowMs: WED, log, views: undefined, newTuitions: { count: 3, href: '/browse/tuitions' }, weekly: undefined, missing: null, ...extra })

test('parent interest counts toward the weekly cap, at most one a day, before new tuitions', () => {
  assert.ok((TEASER_KINDS as readonly string[]).includes('teaser_parent_interest'))
  // Wednesday, nothing sent: interest first, then new tuitions — Thursday's
  // views slot is kept free, so the week still ends at 3.
  const p = plan([], { interest })
  assert.deepEqual(p.map((x) => x.kind), ['teaser_parent_interest', 'teaser_new_tuitions'])
  // One sent earlier this week: interest goes, new tuitions waits (views still ahead).
  const one = [{ kind: 'teaser_new_tuitions', created_at: iso(WED - DAY_MS) }]
  assert.deepEqual(plan(one, { interest }).map((x) => x.kind), ['teaser_parent_interest'])
  // Already one interest today → no second one today.
  const today = [{ kind: 'teaser_parent_interest', created_at: iso(WED - 3600_000) }]
  assert.ok(!plan(today, { interest }).some((x) => x.kind === 'teaser_parent_interest'))
  // Cap reached this week → nothing.
  const full = Array.from({ length: WEEKLY_TEASER_CAP }, () => ({ kind: 'teaser_new_tuitions', created_at: iso(WED - DAY_MS - 3600_000) }))
  assert.deepEqual(plan(full, { interest }), [])
  // Instant application alerts do not count.
  const instants = Array.from({ length: 5 }, () => ({ kind: 'application_opened', created_at: iso(WED - 3600_000) }))
  assert.equal(plan(instants, { interest })[0].kind, 'teaser_parent_interest')
})

test('unpaid new-tuitions teaser says what stands before Apply; no weekly summary for unpaid', () => {
  assert.deepEqual(unpaidApplyLine(false), { body: 'Finish your profile to apply.', href: '/tutor/complete-profile' })
  assert.equal(unpaidApplyLine(true).body, 'Pay the Verification Fee to apply.')
  const t = newTuitionsTeaser(2, '/browse/tuitions', unpaidApplyLine(true))!
  assert.equal(t.body, 'Pay the Verification Fee to apply.')
  assert.ok(!/Rs|199|Premium|upgrade/i.test(`${t.title} ${t.body}`))
  const unpaid = plan([], { paid: false, unpaidApply: unpaidApplyLine(false) })
  assert.equal(unpaid[0].kind, 'teaser_new_tuitions')
  assert.equal(unpaid[0].text.body, 'Finish your profile to apply.')
  // Monday: the summary goes to paid tutors only.
  const MON = WED - 2 * DAY_MS
  const weekly = { views: 3, applications: 1, tuitions: 2 }
  const mk = (paid: boolean) => planForTutor({ nowMs: MON, log: [], views: undefined, newTuitions: { count: 0, href: '' }, weekly, missing: null, paid })
  assert.deepEqual(mk(true).map((x) => x.kind), ['teaser_weekly_summary'])
  assert.deepEqual(mk(false).map((x) => x.kind), [])
})

// ------------------------------------------------------------ backfill ---

test('backfill is paced: at most BACKFILL_TUTORS_PER_DAY tutors a day, newest first; live events never wait', () => {
  const by = new Map<string, InterestEvent[]>()
  for (let i = 0; i < 100; i++) by.set(`b${String(i).padStart(3, '0')}`, [ev({ id: `e${i}`, tutorId: `b${i}`, source: 'backfill', createdAt: iso(WED - (i + 1) * 3600_000) })])
  by.set('live', [ev({ id: 'L', tutorId: 'live', source: 'live' })])
  by.set('mixed', [ev({ id: 'M1', source: 'backfill' }), ev({ id: 'M2', source: 'live' })])
  const day1 = backfillPicks(by)
  assert.equal(day1.size, BACKFILL_TUTORS_PER_DAY)
  assert.ok(day1.has('b000') && !day1.has('b099'), 'newest first')
  assert.ok(!day1.has('live') && !day1.has('mixed'), 'tutors with live events are not part of the backfill pacing')
  // Day 2: day 1's tutors were alerted (their events stamped) → the next ones.
  for (const id of day1) by.delete(id)
  const day2 = backfillPicks(by)
  assert.equal(day2.size, BACKFILL_TUTORS_PER_DAY)
  assert.ok([...day2].every((id) => !day1.has(id)))
  // The runner only alerts a backfill-only tutor when picked.
  const runner = read('lib/tutorTeasers.ts')
  assert.match(runner, /\(!onlyBackfill \|\| picks\.has\(t\.id\)\)/)
  assert.match(read('lib/parentInterest.ts'), /BACKFILL_DONE_KEY/)
})

// ------------------------------------------------- WhatsApp unpaid rows ---

test('PR-10: unpaid rows moved to the Parent interest inbox, with the same 50-a-day cap', () => {
  assert.equal(INBOX_UNPAID_DAILY_CAP, 50)
  const wa = read('lib/waUpdates.ts')
  assert.doesNotMatch(wa, /unpaidQueueRows|loadUnpaidFacts|pickUnpaidRows/, 'the daily queue carries no unpaid rows')
  assert.match(read('lib/interestInbox.ts'), /applyCaps\(/)
})

test('unpaid WhatsApp message: counts only, no names, verify line, wording rules', () => {
  const items: WaItem[] = [
    { kind: 'parent_interest', eventIds: ['e1', 'e2'], shortlists: 2, contacts: 1, at: iso(WED) },
    { kind: 'profile_views', views: 4 },
  ]
  const msg = waMessage({ firstName: 'Ayesha', items, link: 'https://www.tutormint.org/tutor/complete-profile?step=verify', supportWhatsapp: '0321 5872222', unpaid: true })
  const lines = msg.split('\n')
  assert.equal(lines[0], 'Assalam o Alaikum Ayesha, 2 parents shortlisted your profile and 1 parent tried to contact you.')
  assert.match(lines[1], /Parents viewed your profile 4 times this week\. Get verified so parents can contact you\./)
  assert.equal(lines.at(-2), 'https://www.tutormint.org/tutor/complete-profile?step=verify')
  assert.ok(lines.indexOf(lines.at(-2)!) <= 3, 'at most three lines before the link')
  assert.ok(!/\*\*\*\*|Rs|199|best|largest|No\.1/i.test(msg))
  assert.ok(!/\p{Extended_Pictographic}/u.test(msg), 'no emoji')
})

test('an interest item is sent once: events a live send carried drop out; views once a week', () => {
  const items: WaItem[] = [
    { kind: 'parent_interest', eventIds: ['e1', 'e2'], shortlists: 2, contacts: 0, at: iso(WED) },
    { kind: 'profile_views', views: 2 },
  ]
  const sent = { id: 's1', createdAt: iso(WED - DAY_MS), undoneAt: null, kinds: ['parent_interest', 'profile_views'], applicationIds: [], interestEventIds: ['e1'], staffId: 'x', staffName: null }
  const left = pendingWaItems(items, [sent], WED)
  assert.deepEqual(left, [{ kind: 'parent_interest', eventIds: ['e2'], shortlists: 2, contacts: 0, at: iso(WED) }])
  const undone = { ...sent, undoneAt: iso(WED - 3600_000) }
  assert.equal(pendingWaItems(items, [undone], WED).length, 2, 'an undone send carried nothing')
})

test('routes record real parent attempts, including ones that cannot reach an unpaid tutor', () => {
  assert.match(read('app/api/shortlist/route.ts'), /recordParentInterest\(\{ parentId: user\.id, tutorId, kind: 'shortlist' \}\)/)
  const thread = read('app/api/messages/thread/route.ts')
  assert.match(thread, /kind: 'message'/)
  assert.match(thread, /tutor_unpaid/)
  const demo = read('app/api/demo/request/route.ts')
  assert.match(demo, /blocked: 'parent_gate'/)
  assert.match(demo, /blocked: 'cap'/)
  assert.match(demo, /blocked: locked \? 'tutor_unpaid' : null/)
  const lib = read('lib/parentInterest.ts')
  assert.match(lib, /role\.get\(p\.parentId\) !== 'parent' \|\| role\.get\(p\.tutorId\) !== 'tutor'/)
  assert.match(lib, /getViewAsContext/)
  assert.ok(!/console\.(log|error)/.test(lib), 'nothing logged')
})
