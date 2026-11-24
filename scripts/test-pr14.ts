// PR-14 (owner, 21 Nov 2026): one true count everywhere, tutor Featured on sale
// (matched tuitions through the WhatsApp updates queue), PayPro callback rate
// limit. Pure rules only, invented data — nothing here reads a database.
//   npx tsx --test scripts/test-pr14.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  COUNT_DEFS,
  COUNT_KEYS,
  actorCounts,
  compareSources,
  countAll,
  countRows,
  countSpan,
  daySpan,
  firstFeePayments,
  memberCounts,
  spanDays,
  type CountFacts,
} from '../lib/countsCore'
import { ACTION_GROUPS, INSIGHTS_DAY_VERSION, PARENT_FUNNEL, SHARED_ACTION_COUNT, TUTOR_FUNNEL, emptyDay, mergePeriod } from '../lib/insightsCore'
import { signedUpIn } from '../lib/staffOutreachCore'
import { OVERVIEW_ITEMS } from '../lib/overviewItemsCore'
import {
  FEATURED_MATCH_MAX,
  areaAllows,
  featuredItemState,
  featuredItemsDue,
  featuredMatchMessage,
  pickFeaturedMatches,
  type FeaturedJob,
  type MatchRules,
} from '../lib/featuredMatchesCore'
import { PAUSED_UPGRADE_CODES, upgradeBlocked, upgradeRefusal } from '../lib/upgradesPausedCore'
import { buyButtonLabel, buyButtonState, type RunningPlan } from '../lib/planPurchaseCore'
import { siteLinksIn } from '../lib/waLinkCore'

// 21 Nov 2026, 10:00 PKT (05:00 UTC), a Saturday.
const NOW = Date.parse('2026-11-21T05:00:00Z')
const iso = (s: string) => new Date(Date.parse(s)).toISOString()

// ================================================================ Part A ===

test('A: one set of Pakistan-time windows', () => {
  assert.equal(new Date(countSpan('today', NOW).start).toISOString(), '2026-11-20T19:00:00.000Z', '00:00 PKT')
  assert.equal(new Date(countSpan('yesterday', NOW).start).toISOString(), '2026-11-19T19:00:00.000Z')
  assert.equal(countSpan('yesterday', NOW).end, countSpan('today', NOW).start)
  assert.equal(new Date(countSpan('last7', NOW).start).toISOString(), '2026-11-14T19:00:00.000Z', 'today and the six full days before')
  assert.equal(new Date(countSpan('month', NOW).start).toISOString(), '2026-10-31T19:00:00.000Z', '1 Nov 00:00 PKT')
  assert.deepEqual(spanDays(countSpan('last7', NOW)), ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'])
  assert.equal(spanDays(countSpan('month', NOW)).length, 21)
  assert.equal(daySpan('2026-11-21').start, countSpan('today', NOW).start, 'a stored Insights day starts where Today starts')
  // "Signed up, not paid" Last 7 days now uses the same window (was a rolling 168 h).
  assert.equal(signedUpIn('2026-11-14T19:30:00Z', 'week', NOW), true, '00:30 PKT six days ago')
  assert.equal(signedUpIn('2026-11-14T18:30:00Z', 'week', NOW), false, 'the seventh day back is out')
})

test('A: the member rule (People) and the actor rule (staff actions)', () => {
  assert.equal(memberCounts(null), true)
  for (const r of ['staff', 'team', 'seed', 'test', 'merged', 'deleted', 'erase_requested'] as const) assert.equal(memberCounts(r), false, r)
  assert.equal(actorCounts(null), true)
  assert.equal(actorCounts('staff'), true, 'staff actions count')
  assert.equal(actorCounts('team'), true, 'staff post through the team account')
  for (const r of ['seed', 'test', 'merged', 'deleted', 'erase_requested'] as const) assert.equal(actorCounts(r), false, r)
})

const m = (id: string, role: 'tutor' | 'parent', createdAt: string, extra: Partial<CountFacts['members'][number]> = {}) => ({
  id, role, createdAt: iso(createdAt), phoneVerifiedAt: null, onboardedAt: null, excluded: null, ...extra,
}) as CountFacts['members'][number]

const FACTS: CountFacts = {
  members: [
    m('t1', 'tutor', '2026-11-21T01:00:00Z', { phoneVerifiedAt: iso('2026-11-21T01:05:00Z'), onboardedAt: iso('2026-11-21T02:00:00Z') }),
    m('t2', 'tutor', '2026-11-20T10:00:00Z', { phoneVerifiedAt: iso('2026-11-20T10:01:00Z') }),
    m('t3', 'tutor', '2026-11-21T02:00:00Z', { excluded: 'erase_requested', phoneVerifiedAt: iso('2026-11-21T02:01:00Z') }),
    m('t4', 'tutor', '2026-11-16T10:00:00Z', { excluded: 'test' }),
    m('p1', 'parent', '2026-11-21T03:00:00Z', { phoneVerifiedAt: iso('2026-11-21T03:01:00Z') }),
    m('team', 'parent', '2025-01-01T00:00:00Z', { excluded: 'team' }),
    m('tp', 'parent', '2025-01-01T00:00:00Z', { excluded: 'test' }),
  ],
  feePaid: firstFeePayments([
    { userId: 't1', approvedAt: iso('2026-11-21T04:00:00Z'), refunded: false },
    { userId: 't1', approvedAt: iso('2026-11-21T04:30:00Z'), refunded: false },
    { userId: 't2', approvedAt: iso('2026-11-20T12:00:00Z'), refunded: true },
    { userId: 't3', approvedAt: iso('2026-11-21T03:00:00Z'), refunded: false },
  ]),
  plans: [{ id: 'pay1', memberId: 't1', at: iso('2026-11-21T04:40:00Z') }],
  jobs: [
    { id: 'j1', posterId: 'team', createdAt: iso('2026-11-21T01:00:00Z') },
    { id: 'j2', posterId: 'p1', createdAt: iso('2026-11-21T03:30:00Z') },
    { id: 'j3', posterId: 'tp', createdAt: iso('2026-11-21T03:40:00Z') },
    { id: 'j4', posterId: 'staff-profile-not-a-member', createdAt: iso('2026-11-20T09:00:00Z') },
  ],
  applications: [
    { id: 'a1', tutorId: 't1', createdAt: iso('2026-11-21T03:00:00Z') },
    { id: 'a2', tutorId: 't4', createdAt: iso('2026-11-21T03:00:00Z') },
  ],
  forwards: [{ id: 'f1', tutorId: 't1', createdAt: iso('2026-11-21T04:00:00Z') }],
  uploads: [
    { id: 'u1', memberId: 't1', createdAt: iso('2026-11-21T01:10:00Z') },
    { id: 'u2', memberId: 't1', createdAt: iso('2026-11-21T01:11:00Z') },
    { id: 'u3', memberId: 't3', createdAt: iso('2026-11-21T02:10:00Z') },
  ],
  reveals: [{ tutorId: 't1', createdAt: iso('2026-11-21T04:10:00Z') }],
}

test('A: the shared counts — each account once, the right rule for each', () => {
  const today = countAll(FACTS, countSpan('today', NOW))
  assert.equal(today.tutor_signups, 1, 't1 only (t3 erase-requested)')
  assert.equal(today.parent_signups, 1)
  assert.equal(today.signups, today.tutor_signups + today.parent_signups, 'New sign-ups = New tutors + New parents')
  assert.equal(today.mobile_verified, 2, 't1 and p1')
  assert.equal(today.tutor_mobile_verified, 1)
  assert.equal(today.tutor_onboarded, 1)
  assert.equal(today.documents_uploaded, 2, 'each upload, members only')
  assert.equal(today.paid_fee, 1, 't1 once, on the first fee; t3 erase-requested')
  assert.equal(countRows('paid_fee', FACTS, countSpan('today', NOW))[0].at, iso('2026-11-21T04:00:00Z'))
  assert.equal(today.paid_plan, 1)
  assert.equal(today.tuitions_posted, 2, 'the team post and the parent post count; the test poster does not')
  assert.equal(today.applications, 1, 'test tutor left out')
  assert.equal(today.forwarded, 1)
  assert.equal(today.contact_viewed, 1)
  const yesterday = countAll(FACTS, countSpan('yesterday', NOW))
  assert.equal(yesterday.paid_fee, 0, 'a refunded fee never counts')
  assert.equal(yesterday.tuitions_posted, 1, 'a staff profile poster counts')
  const week = countAll(FACTS, countSpan('last7', NOW))
  assert.equal(week.tutor_signups, 2)
})

test('A: daily counts add up to the period (Insights merges days)', () => {
  const days = spanDays(countSpan('last7', NOW))
  const week = countAll(FACTS, countSpan('last7', NOW))
  for (const k of COUNT_KEYS) {
    const sum = days.reduce((n, d) => n + countRows(k, FACTS, daySpan(d)).length, 0)
    // Today's day span reaches midnight; nothing in the fixture is after NOW.
    assert.equal(sum, week[k], k)
  }
})

test('A: check:counts compares every source and names the one that differs', () => {
  assert.deepEqual(compareSources([{ screen: 'a', values: { signups: 3 } }, { screen: 'b', values: { signups: 3, paid_fee: 1 } }]), [])
  const bad = compareSources([{ screen: 'Overview', values: { tutor_signups: 116 } }, { screen: 'Insights', values: { tutor_signups: 123 } }])
  assert.equal(bad.length, 1)
  assert.equal(bad[0].key, 'tutor_signups')
  assert.deepEqual(bad[0].values.map((v) => v.screen), ['Overview', 'Insights'])
})

test('A: Insights uses the shared counts and no label means two numbers', () => {
  assert.equal(INSIGHTS_DAY_VERSION, 3, 'PR-22 rebuilt the days')
  const labels = ACTION_GROUPS.flatMap((g) => g.items)
  for (const [action, key] of Object.entries(SHARED_ACTION_COUNT)) {
    assert.ok(COUNT_KEYS.includes(key!), key)
    if (action !== 'paid') assert.equal(labels.find((i) => i.key === action)?.label, COUNT_DEFS[key!].label, `${action} shows the shared label`)
  }
  assert.equal(SHARED_ACTION_COUNT.signed_up, 'signups', '"Signed up" is accounts, never the sign-up event')
  assert.equal(SHARED_ACTION_COUNT.tuition_posted, 'tuitions_posted', 'staff posts count')
  // Every label shown for a count is unique across Insights, the funnels and the Overview funnel.
  const all = [
    ...labels.map((l) => l.label),
    ...TUTOR_FUNNEL.map((s) => s.label),
    ...PARENT_FUNNEL.map((s) => s.label),
    ...(['funnel-signed-up', 'funnel-mobile', 'funnel-onboarded', 'funnel-paid'] as const).map((k) => OVERVIEW_ITEMS[k].title),
  ]
  // "Tutors signed up" is on both cohort funnels ON PURPOSE: it is the one
  // shared New tutors count (check:counts compares them). Nothing else repeats.
  assert.equal(TUTOR_FUNNEL[0].label, OVERVIEW_ITEMS['funnel-signed-up'].title)
  const others = all.filter((l) => l !== TUTOR_FUNNEL[0].label)
  assert.equal(new Set(others).size, others.length, `duplicate label in ${others.join(', ')}`)
  for (const s of [...TUTOR_FUNNEL.slice(1), ...PARENT_FUNNEL.slice(1)]) assert.match(s.label, /^Then: /)
})

test('A: Insights periods carry New tutors, New parents and the held-parent note', () => {
  const d1 = emptyDay('2026-11-20', 'x')
  d1.newTutors = ['t2']
  d1.newParents = []
  d1.heldParents = ['h1']
  const d2 = emptyDay('2026-11-21', 'x')
  d2.newTutors = ['t1']
  d2.newParents = ['p1']
  d2.heldParents = ['h1', 'h2']
  const p = mergePeriod('2026-11-20', '2026-11-21', [d1, d2])
  assert.equal(p.totals.newTutors, 2)
  assert.equal(p.totals.newParents, 1)
  assert.equal(p.totals.newSignups, 3)
  assert.equal(p.totals.heldParents, 2, 'each held parent once')
})

test('A: every screen reads lib/counts (no private copy of a shared count)', () => {
  const read = (f: string) => readFileSync(f, 'utf8')
  assert.match(read('lib/overviewItems.ts'), /countRows\('tuitions_posted'/)
  assert.match(read('lib/overviewItems.ts'), /countRows\('paid_fee'/)
  assert.doesNotMatch(read('lib/overviewItems.ts'), /testAccountIds/)
  assert.match(read('lib/siteVisits.ts'), /countOne\('paid_fee'/)
  assert.match(read('lib/paidSignups.ts'), /countRows\('paid_fee'/)
  assert.match(read('lib/insights.ts'), /countAll\(countFacts, span\)/)
  assert.doesNotMatch(read('lib/insightsCore.ts'), /registered: 'signed_up'/)
})

// ================================================================ Part B ===

const RULES: MatchRules = {
  visibility: (jobType, jobCity, _types, cities) => {
    if ((jobType ?? '').toLowerCase().includes('online')) return 'online'
    return cities.some((c) => c.toLowerCase() === (jobCity ?? '').toLowerCase()) ? 'same_city' : 'exclude'
  },
  genderBlocked: (pref, g) => !!pref && pref !== 'any' && !!g && pref !== g,
}
const isOnline = (t: string | null) => (t ?? '').toLowerCase().includes('online')
const tutor = { masterIds: [10, 20], cities: ['Lahore'], jobTypes: ['Home Tutor', 'Online Tutor'], gender: 'female' }
const areas = new Map([['lahore', ['DHA', 'Gulberg']]])
let seq = 0
const job = (p: Partial<FeaturedJob> = {}): FeaturedJob => {
  seq += 1
  return {
    id: `job-${String(seq).padStart(3, '0')}`,
    masterIds: [10],
    city: 'Lahore',
    area: 'DHA',
    jobType: 'Home Tutor',
    genderPreference: null,
    createdAt: new Date(NOW - seq * 60_000).toISOString(),
    title: `Tuition ${seq}`,
    url: `https://www.tutormint.org/tuitions/lahore/tuition-${seq}`,
    ...p,
  }
}
const pick = (jobs: FeaturedJob[], sent = new Set<string>()) => pickFeaturedMatches({ jobs, tutor, areas, alreadySent: sent, nowMs: NOW, rules: RULES, isOnline })

test('B: matching — subjects/levels, city and areas, gender, online, the last 24 hours', () => {
  const ok = job()
  const otherSubject = job({ masterIds: [99] })
  const otherCity = job({ city: 'Karachi', area: 'Clifton' })
  const otherArea = job({ area: 'Johar Town' })
  const noArea = job({ area: null })
  const maleOnly = job({ genderPreference: 'male' })
  const online = job({ city: 'Karachi', area: 'Clifton', jobType: 'Online Tutor' })
  const old = job({ createdAt: new Date(NOW - 25 * 3600_000).toISOString() })
  const ids = pick([ok, otherSubject, otherCity, otherArea, noArea, maleOnly, online, old]).map((j) => j.id)
  assert.deepEqual(ids, [ok.id, noArea.id, online.id])
  assert.equal(areaAllows({ city: 'Lahore', area: 'Johar Town' }, tutor, new Map(), isOnline, 'Home Tutor'), true, 'no areas chosen → the whole city')
})

test('B: at most 5, newest first; nothing already sent; none → no item', () => {
  const many = Array.from({ length: 8 }, () => job())
  const got = pick(many)
  assert.equal(got.length, FEATURED_MATCH_MAX)
  assert.deepEqual(got.map((j) => j.id), [...many].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map((j) => j.id))
  assert.equal(pick(many, new Set(many.map((j) => j.id))).length, 0, 'everything already sent')
  assert.deepEqual(pick([job({ masterIds: [99] })]), [], 'no match → skipped')
})

test('B: the message — plain English, each title and its own tutormint.org link, no price or emoji', () => {
  const t = [job(), job({ area: null, city: 'Lahore' })]
  const msg = featuredMatchMessage({ firstName: 'Ayesha', tuitions: t, supportWhatsapp: '0321 5872222' })
  assert.match(msg, /^Hi Ayesha, 2 new tuitions on TutorMint match your profile:/)
  for (const j of t) {
    assert.ok(msg.includes(j.title))
    assert.ok(msg.split('\n').includes(j.url), 'each link on its own line')
  }
  assert.equal(siteLinksIn(msg).length, 2)
  assert.doesNotMatch(msg, /Rs\.?\s?\d|PKR|\p{Extended_Pictographic}/u)
  assert.doesNotMatch(msg, /[؀-ۿ]/, 'English only')
  assert.match(msg, /Need help\? WhatsApp 0321 5872222$/)
  assert.match(featuredMatchMessage({ firstName: '', tuitions: [t[0]], supportWhatsapp: 'x' }), /^Hi, a new tuition on TutorMint matches/)
})

test('B: once a Pakistan day from 08:00; Send / Undo state', () => {
  assert.equal(featuredItemsDue(Date.parse('2026-11-21T02:30:00Z'), null), false, '07:30 PKT')
  assert.equal(featuredItemsDue(Date.parse('2026-11-21T03:00:00Z'), null), true, '08:00 PKT')
  assert.equal(featuredItemsDue(Date.parse('2026-11-21T03:00:00Z'), '2026-11-21'), false, 'already made today')
  assert.equal(featuredItemsDue(Date.parse('2026-11-21T03:00:00Z'), '2026-11-20'), true)
  assert.equal(featuredItemState({ sentAt: null, undoneAt: null }), 'to_send')
  assert.equal(featuredItemState({ sentAt: 'x', undoneAt: null }), 'sent')
  assert.equal(featuredItemState({ sentAt: 'x', undoneAt: 'y' }), 'to_send', 'an Undo puts it back')
})

test('B: caps not affected — Featured items never touch whatsapp_update_sends', () => {
  const src = readFileSync('lib/featuredMatches.ts', 'utf8')
  assert.doesNotMatch(src, /from\('whatsapp_update_sends'\)/)
  assert.match(src, /from\('featured_match_items'\)/)
  // The caps read only whatsapp_update_sends (lib/waUpdates loadFacts, lib/interestInbox).
  assert.doesNotMatch(readFileSync('lib/interestInbox.ts', 'utf8'), /featured_match_items/)
  const sql = readFileSync('supabase/migrations/241_pr14_featured_match_items.sql', 'utf8')
  assert.match(sql, /featured_match_items_one_a_day/)
  assert.match(sql, /revoke all on public\.featured_match_items from anon, authenticated/)
  // The route keeps the same gate (Owner, Project Manager, Backend Support — Mohsin's account included).
  assert.match(readFileSync('app/api/admin/whatsapp-updates/route.ts', 'utf8'), /checkAdminRole\(\.\.\.SCREEN_ACCESS\.waUpdates\)/)
  // The retired Featured WhatsApp address still redirects.
  assert.match(readFileSync('app/admin/users/featured-whatsapp/page.tsx', 'utf8'), /permanentRedirect\(RETIRED_ADMIN_PAGES/)
})

test('B: tutor Featured is on sale — Upgrade button, same rules as PR-13', () => {
  assert.deepEqual([...PAUSED_UPGRADE_CODES], [])
  assert.equal(upgradeBlocked('featured', 999), false)
  assert.equal(upgradeRefusal('featured', 999), null)
  const end = '2026-12-21T00:00:00Z'
  const premium: RunningPlan = { code: 'premium', rank: 2, expiresAt: end }
  const base = { signedIn: true, viewerAudience: 'tutor' as const, cardAudience: 'tutor' as const, feePaid: true, current: null as RunningPlan, plan: { code: 'featured', rank: 3 }, blocked: upgradeBlocked('featured', 999) }
  assert.equal(buyButtonState(base), 'upgrade')
  assert.equal(buyButtonLabel('upgrade', 'Featured'), 'Upgrade to Featured')
  assert.equal(buyButtonState({ ...base, current: premium }), 'upgrade', 'Premium → Featured replaces with a fresh 30 days')
  assert.equal(buyButtonState({ ...base, current: { code: 'featured', rank: 3, expiresAt: end } }), 'extend')
  assert.equal(buyButtonState({ ...base, feePaid: false }), 'pay_fee_first')
  assert.equal(buyButtonState({ ...base, signedIn: false, viewerAudience: null as never }), 'sign_in')
})

// ================================================================ Part C ===

test('C: the PayPro callback is rate-limited before anything is logged', () => {
  const src = readFileSync('app/paypro/uis/route.ts', 'utf8')
  const limit = src.indexOf("rateLimit('paypro_callback', callerIp(request))")
  assert.ok(limit > 0, 'limited per address')
  assert.ok(limit < src.indexOf('recordGatewayEvent('), 'refused before the gateway log')
  assert.ok(limit < src.indexOf('console.warn('), 'refused before the console line')
  assert.match(src, /status: 429/)
  assert.match(src, /'text\/plain; charset=utf-8'/)
  const rl = readFileSync('lib/rateLimit.ts', 'utf8')
  assert.match(rl, /paypro_callback: \{ windowSeconds: 3600, max: 20 \}/)
  // One Finance alert per order, ever: finance_alerts is upserted on (kind, ref) ignoring duplicates.
  assert.match(readFileSync('lib/financeAlerts.ts', 'utf8'), /onConflict: 'kind,ref', ignoreDuplicates: true/)
  assert.match(readFileSync('lib/payments/payproReconcile.ts', 'utf8'), /kind: 'paypro_late',\s*ref: row\.provider_ref/)
})
