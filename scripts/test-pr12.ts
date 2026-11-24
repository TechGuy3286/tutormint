// PR-12 (owner, 20 Nov 2026): Insights rules, PayPro ended, the non-refundable
// fee notice, no "middleman / no commission / no agent" wording, Backend Support
// access + the per-account "every row" grant, and the inbox stored-copy diff.
// Pure and source checks only — invented data, no network.
//   npm run test:pr12
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { roleMayWrite, roleSatisfies, SCREEN_ACCESS, type AdminRole } from '../lib/adminAccessCore'
import { parseAllRowsStaff, seesAllRowsFrom } from '../lib/staffAllRowsCore'
import { NON_REFUNDABLE_NOTICE, NON_REFUNDABLE_TICK, DOUBLE_CHARGE_LINE, NON_REFUNDABLE_RECEIPT_LINE, nonRefundableTicked } from '../lib/nonRefundableCore'
import {
  countedRole,
  daysToBuild,
  deviceOf,
  emptyDay,
  mergePeriod,
  pkDayOf,
  resolvePeriod,
  trackerAction,
  INSIGHTS_MAX_DAYS,
  type MemberFacts,
} from '../lib/insightsCore'
import { inboxSnapshotDiff } from '../lib/interestInboxCore'
import { contradictionViolations } from '../lib/ai/platformFacts'
import { SITE_TAGLINE } from '../lib/siteIdentity'
import { paymentCheckOutcome } from '../lib/tutorFollowUpCore'

const src = (p: string) => readFileSync(p, 'utf8')
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|mjs)$/.test(name)) out.push(p.replace(/\\/g, '/'))
  }
  return out
}
const SHIPPED = [...walk('app'), ...walk('components'), ...walk('lib')]

// ------------------------------------------------------------- Part B ---
test('B: no shipped file reads a PAYPRO_* environment variable', () => {
  const offenders = SHIPPED.filter((f) => /process\.env\.PAYPRO_|process\.env\[['"]PAYPRO_/.test(src(f)))
  assert.deepEqual(offenders, [])
})

test('B: the PayPro client is gone — no order, status or test-email gate left', () => {
  const s = src('lib/payments/paypro.ts')
  for (const gone of ['createPayproOrder', 'getPayproOrderStatus', 'pproVisibleFor', 'checkoutVisibleFor', 'PAYPRO_TEST_EMAILS', 'https.request']) {
    assert.ok(!new RegExp(`\\b${gone}\\b`).test(s.replace(/^\/\/.*$/gm, '')), `${gone} removed`)
  }
  assert.match(s, /export function payProIdFromRow/)
})

test('B: the callback logs and ignores — never activates, never changes a payment', () => {
  const s = src('app/paypro/uis/route.ts')
  assert.doesNotMatch(s, /activatePayment|confirmPayproOrder|\.update\(|\.insert\(/)
  assert.match(s, /recordGatewayEvent\('paypro', 'callback'/)
  assert.match(s, /recordLatePayproNotice/)
  const r = src('lib/payments/payproReconcile.ts')
  assert.doesNotMatch(r, /activatePayment|getPayproOrderStatus|from\('payments'\)\.update/)
})

test('B: checkout refuses card and keeps bank transfer; the cron and return page no longer call PayPro', () => {
  const co = src('app/api/payments/checkout/route.ts')
  assert.match(co, /if \(!wantsTransfer\) \{\s*\n\s*return NextResponse\.json\(\{ error: PAYPRO_CLOSED_MESSAGE, code: 'use_transfer' \}, \{ status: 409 \}\)/)
  assert.doesNotMatch(co, /startPayproCheckout|pproVisibleFor/)
  assert.match(co, /const provider = wantsTransfer \? manual : getProvider\(\)/)
  assert.doesNotMatch(src('app/api/cron/every-5-min/route.ts'), /confirmPayproOrder|markPayproOrderBlocked|pproConfigured/)
  assert.doesNotMatch(src('app/(site)/pay/return/page.tsx'), /confirmPayproOrder|click2pay/)
  assert.doesNotMatch(src('app/api/payments/bank-qr/route.ts'), /checkoutVisibleFor/)
})

test('B: the Owner status check says PayPro has ended', () => {
  const o = paymentCheckOutcome({ activated: false, alreadyActive: false, accepted: false, ggosOk: false, reason: 'paypro_ended' }, 'now')
  assert.equal(o.state, 'not_paid')
  assert.match(o.message, /PayPro has ended/)
})

// ------------------------------------------------------------- Part C ---
test('C: the notice wording is exact and carries no amount', () => {
  assert.equal(
    NON_REFUNDABLE_NOTICE,
    'The verification fee is non-refundable. It covers the cost of checking your documents and running the platform. Paying is your choice — you can use TutorMint without paying.',
  )
  assert.equal(NON_REFUNDABLE_TICK, 'I understand the fee is non-refundable')
  assert.equal(DOUBLE_CHARGE_LINE, 'If you are charged twice, or money is taken but the payment fails, contact us on WhatsApp and we will return the extra amount.')
  assert.equal(NON_REFUNDABLE_RECEIPT_LINE, 'This fee is non-refundable.')
  for (const s of [NON_REFUNDABLE_NOTICE, DOUBLE_CHARGE_LINE]) assert.doesNotMatch(s, /Rs\.?\s?\d|\d{3}/)
  assert.equal(nonRefundableTicked('1'), true)
  for (const v of [null, '', '0', 'true', 1, 'on']) assert.equal(nonRefundableTicked(v), false)
})

test('C: the payment page shows the notice above Submit with a required tick', () => {
  const s = src('app/(site)/pay/choose/PayChoice.tsx')
  // PR-13: a monthly plan shows its own wording (NON_REFUNDABLE_PLAN_NOTICE).
  const notice = s.indexOf('{isFee ? NON_REFUNDABLE_NOTICE : NON_REFUNDABLE_PLAN_NOTICE}')
  const submit = s.indexOf('onClick={() => void send()}')
  assert.ok(notice > 0 && submit > notice, 'notice sits above the Submit button')
  assert.match(s, /type="checkbox"[\s\S]{0,200}checked=\{ack\}/)
  assert.match(s, /disabled=\{sending \|\| !file \|\| !ack\}/)
  assert.match(s, /form\.set\(NON_REFUNDABLE_FIELD, '1'\)/)
})

test('C: the receipt route refuses an unticked upload and stores the tick time', () => {
  const s = src('app/api/payments/receipt/route.ts')
  assert.match(s, /if \(!nonRefundableTicked\(form\.get\(NON_REFUNDABLE_FIELD\)\)\)/)
  assert.match(s, /non_refundable_ack_at: nonRefundableAckAt/)
  assert.ok(s.indexOf('nonRefundableTicked(') < s.indexOf("from('payments')"), 'checked before any payment row is written')
})

test('C: Terms, FAQ, the receipt email and the in-app message carry the wording', () => {
  const terms = src('app/(site)/terms/page.tsx')
  assert.match(terms, /heading: 'Fees and refunds'/)
  assert.match(terms, /\{NON_REFUNDABLE_NOTICE\}/)
  assert.match(terms, /\{DOUBLE_CHARGE_LINE\}/)
  assert.match(src('lib/faqContent.ts'), /a: `\$\{NON_REFUNDABLE_NOTICE\} \$\{DOUBLE_CHARGE_LINE\}`/)
  assert.match(src('lib/notify/templates.ts'), /'This fee is non-refundable\.'/)
  assert.match(src('lib/payments/activate.ts'), /This fee is non-refundable\./)
})

// ------------------------------------------------------------- Part D ---
const BANNED = /\bmiddle ?m[ae]n\b|\bno commission\b|\bzero commission\b|\bcommission[- ]free\b|\bno agents?\b|\bwithout (?:an )?agents?\b|\bagent[- ]free\b|koi agent|commission nahi|ایجنٹ|کمیشن|مڈل ?مین/i
// Files allowed to NAME the phrases: the rules that forbid them.
const ALLOWED = new Set(['lib/ai/platformFacts.ts', 'lib/ai/blogCopy.ts', 'lib/ai/factsSheet.ts'])

test('D: no shipped page, template or metadata says middleman / no commission / no agent (English, Roman Urdu, Urdu)', () => {
  const hits: string[] = []
  for (const f of SHIPPED) {
    if (ALLOWED.has(f)) continue
    src(f)
      .split('\n')
      .forEach((line, i) => {
        if (BANNED.test(line) && !/Commission of Pakistan|Exchange Commission/.test(line)) hits.push(`${f}:${i + 1}`)
      })
  }
  assert.deepEqual(hits, [])
})

test('D: the new tagline and homepage line', () => {
  assert.equal(SITE_TAGLINE, 'Free to join. Verified tutors. Contact tutors directly.')
  const home = src('app/(site)/page.tsx')
  assert.match(home, /Free Profile &bull; Verified Tutors &bull; Contact Directly &bull; Live Demo/)
  assert.match(home, /مفت پروفائل &bull; تصدیق شدہ ٹیوٹرز &bull; براہِ راست رابطہ &bull; لائیو ڈیمو/)
})

test('D: the AI writing check flags the phrases', () => {
  for (const s of ['TutorMint has no middleman.', 'Free to join, no commission.', 'There is no agent in between.']) {
    assert.ok(contradictionViolations(s).some((v) => /academies and agents/.test(v.why)), s)
  }
  assert.equal(contradictionViolations('Parents contact tutors directly.').filter((v) => /academies and agents/.test(v.why)).length, 0)
})

// ------------------------------------------------------------- Part E ---
const OWNER: AdminRole = 'owner'
const PARTNER: AdminRole = 'partner'
const BS: AdminRole = 'backend_support'

test('E: Applications, WhatsApp updates and the tutor/parent screens — Owner, Partner and Backend Support may open and act', () => {
  for (const key of ['applicantForwards', 'waUpdates', 'interestInbox', 'tutors', 'parents', 'users', 'orphans', 'tutorSlug', 'videoVisibility', 'tutorEdit', 'memberWarn', 'memberVerifyMobile', 'paidWelcome', 'statusImage'] as const) {
    const list = SCREEN_ACCESS[key]
    for (const r of [OWNER, PARTNER, BS]) {
      assert.ok(roleSatisfies(r, list), `${r} opens ${key}`)
      assert.ok(roleMayWrite(r, list), `${r} acts on ${key}`)
    }
  }
})

test('E: Owner-only and money screens stay closed to Backend Support (and the Partner cannot write them)', () => {
  for (const key of ['heldActivity', 'blockedSignups', 'finance', 'revenue', 'paymentAmounts', 'paymentGateways', 'team', 'memberMerge', 'memberSuspendBan', 'memberMobileChange', 'contactWithdraw', 'templateReview', 'paymentsRefund', 'insights'] as const) {
    const list = SCREEN_ACCESS[key]
    assert.ok(!roleSatisfies(BS, list), `Backend Support refused ${key}`)
    assert.ok(!roleMayWrite(PARTNER, list), `Partner cannot change ${key}`)
    assert.ok(roleMayWrite(OWNER, list), `Owner may ${key}`)
  }
  assert.ok(roleSatisfies(PARTNER, SCREEN_ACCESS.insights), 'the Partner opens Insights')
  for (const r of [OWNER, PARTNER, BS]) assert.ok(roleSatisfies(r, SCREEN_ACCESS.memberSessions), `${r} opens a member's sessions`)
})

test('E: every row + badge totals — Owner/Partner by role, one granted Backend Support account by id, other Backend Support own rows', () => {
  const mohsin = '0a5687c8-5d5c-41bf-974e-a85a5fbee938'
  const other = '11111111-2222-4333-8444-555555555555'
  const granted = parseAllRowsStaff(JSON.stringify([mohsin.toUpperCase(), 'not-an-id', 42]))
  assert.deepEqual([...granted], [mohsin])
  assert.equal(parseAllRowsStaff('{bad').size, 0)
  const list = SCREEN_ACCESS.interestInboxAll
  assert.ok(!list.includes(BS), 'the role alone does not see every row')
  assert.ok(seesAllRowsFrom({ id: other, adminRole: OWNER }, list, new Set()))
  assert.ok(seesAllRowsFrom({ id: other, adminRole: PARTNER }, list, new Set()))
  assert.ok(seesAllRowsFrom({ id: mohsin, adminRole: BS }, list, granted))
  assert.ok(!seesAllRowsFrom({ id: other, adminRole: BS }, list, granted))
  assert.ok(!seesAllRowsFrom({ id: mohsin, adminRole: null }, list, granted), 'a former staff id grants nothing')
  assert.ok(seesAllRowsFrom({ id: mohsin, adminRole: BS }, SCREEN_ACCESS.applicationsAll, granted))
})

// ------------------------------------------------------------- Part A ---
const NOW = Date.parse('2026-11-20T10:00:00Z') // 15:00 PKT, a Friday

test('A: periods in Pakistan time, custom ranges clamped', () => {
  assert.deepEqual(resolvePeriod({ period: 'today' }, NOW), { key: 'today', from: '2026-11-20', to: '2026-11-20', label: 'Today' })
  assert.equal(resolvePeriod({ period: 'yesterday' }, NOW).from, '2026-11-19')
  assert.equal(resolvePeriod({}, NOW).from, '2026-11-20', 'PR-22: the default period is Today')
  assert.equal(resolvePeriod({ period: '30d' }, NOW).from, '2026-10-22')
  const c = resolvePeriod({ period: 'custom', from: '2026-12-31', to: '2026-01-01' }, NOW)
  assert.equal(c.to, '2026-11-20', 'never past today')
  assert.ok(c.from >= '2026-08-21' && c.from < c.to, `cut to ${INSIGHTS_MAX_DAYS} days`)
  assert.equal(pkDayOf(Date.parse('2026-11-20T19:30:00Z')), '2026-11-21', 'after 19:00 UTC is the next PK day')
})

test('A: device category only', () => {
  assert.deepEqual(deviceOf('Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/119 Mobile Safari/537.36'), { device: 'mobile', os: 'android' })
  assert.deepEqual(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) Mobile/15E148'), { device: 'mobile', os: 'iphone' })
  assert.deepEqual(deviceOf('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)'), { device: 'tablet', os: 'iphone' })
  assert.deepEqual(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/119'), { device: 'desktop', os: 'windows' }, 'PR-22: Windows is its own kind')
  assert.deepEqual(deviceOf(null), { device: 'desktop', os: 'other' })
})

test('A: staff, seed, team, test, hidden, merged and held accounts never count', () => {
  const base: MemberFacts = { role: 'tutor', admin_role: null, is_seed: false, is_team_account: false, is_test_name: false, hidden_from_public: false, merged_into: null }
  assert.equal(countedRole(base, false), 'tutor')
  assert.equal(countedRole({ ...base, role: 'parent' }, false), 'parent')
  assert.equal(countedRole({ ...base, role: 'parent' }, true), null, 'burst-held parent')
  for (const k of ['is_seed', 'is_team_account', 'is_test_name', 'hidden_from_public'] as const) assert.equal(countedRole({ ...base, [k]: true }, false), null, k)
  assert.equal(countedRole({ ...base, admin_role: 'backend_support' }, false), null)
  assert.equal(countedRole({ ...base, role: 'admin' }, false), null)
  assert.equal(countedRole({ ...base, merged_into: 'x' }, false), null)
  assert.equal(countedRole(undefined, false), null)
})

test('A: tracker events map to actions', () => {
  assert.equal(trackerAction({ kind: 'page_view', path: '/pay/choose?plan=verified', label: null }), 'pay_page')
  assert.equal(trackerAction({ kind: 'page_view', path: '/tuitions/lahore/o-level-physics-tm-1450', label: null }), 'tuition_viewed')
  assert.equal(trackerAction({ kind: 'page_view', path: '/tuitions/lahore', label: null }), null)
  assert.equal(trackerAction({ kind: 'action', path: null, label: 'whatsapp_click' }), 'whatsapp_click')
  assert.equal(trackerAction({ kind: 'action', path: null, label: 'call_click' }), 'call_click')
  assert.equal(trackerAction({ kind: 'search', path: null, label: 'x' }), null)
})

test('A: merging days — members distinct over the period, visitors per day, grid by weekday', () => {
  const d1 = emptyDay('2026-11-19', 'x')
  d1.tutorsActive = ['t1', 't2']
  d1.parentsActive = ['p1']
  d1.newTutors = ['t2']
  d1.visitors = 10
  d1.actions.applied = 3
  d1.hours[9] = 4
  d1.searches = [{ surface: 'tutors', city: 'Lahore', area: null, masterId: 5, mode: null, gender: null, n: 2, zero: 1 }]
  d1.funnelTutor = [1, 1, 0, 0, 0, 0, 0]
  const d2 = emptyDay('2026-11-20', 'x')
  d2.tutorsActive = ['t1', 't3']
  d2.visitors = 5
  d2.actions.applied = 1
  d2.hours[9] = 2
  d2.searches = [{ surface: 'tutors', city: 'Lahore', area: null, masterId: 5, mode: null, gender: null, n: 1, zero: 0 }]
  const p = mergePeriod('2026-11-18', '2026-11-20', [d1, d2])
  assert.equal(p.totalDays, 3)
  assert.equal(p.builtDays, 2)
  assert.equal(p.totals.tutors, 3, 't1 once')
  assert.equal(p.totals.parents, 1)
  assert.equal(p.totals.visitorDays, 15)
  assert.equal(p.totals.newSignups, 1)
  assert.equal(p.totals.returning, 3, 't1, t3, p1')
  assert.equal(p.actions.applied, 4)
  assert.equal(p.searches[0].n, 3)
  assert.equal(p.zeroSearches[0].zero, 1)
  assert.equal(p.grid[3][9], 4, 'Thursday 09:00')
  assert.equal(p.grid[4][9], 2, 'Friday 09:00')
  assert.equal(p.funnelTutor[1].lostPct, 0)
  assert.equal(p.daily[0].tutors, 0, 'a day not built is a gap')
  assert.equal(p.daily[1].returning, 2)
})

test('A: the cron builds today when stale, yesterday until final, then missing days — at most 3', () => {
  const none = daysToBuild(NOW, new Map())
  assert.deepEqual(none, ['2026-11-20', '2026-11-19', '2026-11-18'])
  const fresh = new Map([
    ['2026-11-20', new Date(NOW - 60_000).toISOString()],
    ['2026-11-19', '2026-11-19T19:30:00.000Z'],
  ])
  const next = daysToBuild(NOW, fresh)
  assert.ok(!next.includes('2026-11-20') && !next.includes('2026-11-19'))
  assert.equal(next[0], '2026-11-18')
})

// ------------------------------------------------------------- Part F ---
test('F: the stored inbox matches a fresh build after a JSON round trip, and a real difference is named', () => {
  const counts = { byTab: { to_send: 2, sent: 1, new_since_sent: 0 }, ready: 2, readyDemo: 1, waitingBeyondCap: 0, readyByAssignee: { 'aaaaaaaa-1': 2 }, unpaidSentToday: 0 }
  const rows = [
    { tutorId: 'tutor-a-0001', tab: 'to_send', wait: null, assigneeId: 'aaaaaaaa-1', pendingKinds: ['demo'] },
    { tutorId: 'tutor-b-0002', tab: 'to_send', wait: null, assigneeId: 'aaaaaaaa-1', pendingKinds: ['view'] },
    { tutorId: 'tutor-c-0003', tab: 'sent', wait: null, assigneeId: 'aaaaaaaa-1', pendingKinds: [] },
  ]
  const fresh = { rows, counts }
  assert.deepEqual(inboxSnapshotDiff(fresh, JSON.parse(JSON.stringify(fresh))), [])
  const stale = JSON.parse(JSON.stringify(fresh))
  stale.rows[1].tab = 'sent'
  stale.counts.byTab.to_send = 1
  const d = inboxSnapshotDiff(fresh, stale)
  assert.ok(d.some((x) => /tab to_send: fresh 2, stored 1/.test(x)))
  assert.ok(d.some((x) => /tutor tutor-b-: fresh to_send\/ready, stored sent\/ready/.test(x)))
  const reordered = { rows: [rows[1], rows[0], rows[2]], counts }
  assert.deepEqual(inboxSnapshotDiff(fresh, reordered), ['same rows, different order'])
})
