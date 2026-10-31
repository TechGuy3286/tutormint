import fs from 'node:fs'
// scripts/test-oct27-complaint-email.ts — npm run test:complaintemail
// (owner, 27 Oct 2026). Consent UI hidden, pause on complaint, Unpause all,
// PayPro settlement, payment emails, staff alerts in the bell, Notification
// settings, the email saving rules, the Resend webhook, Email usage,
// "Application received", and no addresses or numbers in logs. Invented data.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { CONSENT_UI_ENABLED } from '../lib/tuitionConsentCore'
import { POSTED_COLUMNS } from '../lib/tuitionPostingCore'
import {
  COMPLAINT_LABEL,
  COMPLAINT_REASON,
  DO_NOT_USE_MESSAGE,
  HOLD_MESSAGE,
  NOT_AVAILABLE_MESSAGE,
  holdSnapshot,
  isComplaintPaused,
  mayRestore,
  numberHash,
  pauseSkips,
  pauseUpdate,
  postingRefusal,
  restoreUpdate,
} from '../lib/contactWithdrawCore'
import { isHiddenTuition, NO_LONGER_AVAILABLE } from '../lib/hiddenTuitionCore'
import { resumeVerdict } from '../lib/autoPauseResumeCore'
import { buildSettlement, feeLabel, settlementCardLine, splitPayouts, typicalFees, type PayproPaymentIn } from '../lib/payproSettlementCore'
import {
  CRITICAL_TEMPLATES,
  NO_FACTS,
  STAFF_TEMPLATES,
  criticalOnlyFrom,
  decideAll,
  groupSummaries,
  logLineSafe,
  parseDailyLimit,
  typeOn,
  unopenedStreak,
  type PolicyFacts,
} from '../lib/email/policyCore'
import { signPayload, verifyWebhook, webhookAction } from '../lib/email/webhookCore'
import { usageTable, dayTotals, cleanReason } from '../lib/email/usageCore'
import { staffRecipients } from '../lib/staffAlerts'
import { render } from '../lib/notify/templates'
import { TUTOR_STAGE_TEXT } from '../lib/applicationStageCore'
import { PAYPRO_RETIRED_LINE } from '../lib/payments/payproRetireCore'
import { __setEmailDepsForTests, sendBulk, sendOne, type SendRow } from '../lib/email/send'

const read = (p: string) => readFileSync(p, 'utf8')

// ── Part A — consent UI hidden, data kept ────────────────────────────────
test('A: the consent UI is gone from every surface (removed, owner 31 Oct 2026)', () => {
  assert.equal(CONSENT_UI_ENABLED, false)
  assert.ok(!POSTED_COLUMNS.includes('Consent recorded' as never), 'Team activity has no consent column')
  for (const p of ['components/forms/PostTuitionForm.tsx', 'app/admin/jobs/JobRow.tsx', 'app/admin/applications/ApplicationsClient.tsx', 'app/admin/team-activity/page.tsx', 'app/admin/withdraw-contact/WithdrawContactClient.tsx']) {
    assert.ok(!/ConsentChip|ConsentBox|CONSENT_UI_ENABLED/.test(read(p)), p)
  }
  assert.ok(!read('app/admin/inbox/InboxClient.tsx').includes('group="consent"'), 'the Consent template group is not shown')
  for (const p of ['app/api/admin/jobs/consent/ask/route.ts', 'app/api/admin/jobs/consent/route.ts', 'app/admin/settings/privacy/page.tsx', 'app/api/admin/settings/hide-numbers/route.ts']) {
    assert.ok(!fs.existsSync(p), p + ' removed')
  }
})

test('A: no save requires consent, and the stored data is kept', () => {
  const jobs = read('lib/jobs.ts')
  assert.equal((jobs.match(/CONSENT_UI_ENABLED \? consentInputProblem/g) ?? []).length, 2, 'create and edit only check consent while the UI is on')
  const m210 = read('supabase/migrations/210_complaint_hold_email_savings.sql')
  assert.match(m210, /update public\.admin_message_templates set active = false where key = 'consent_ask'/)
  assert.ok(!/drop table|delete from public\.tuition_consents/i.test(m210), 'consent records are kept')
})

// ── Part B — pause on complaint ─────────────────────────────────────────
const openJob = { status: 'open', hidden_reason: null, hidden_prev_status: null, hidden_at: null, is_featured: true }

test('B: a paused tuition is hidden with the complaint reason, and its applications are no longer available', () => {
  const u = pauseUpdate(openJob, '2026-10-27T10:00:00Z')
  assert.deepEqual(u, { status: 'hidden', hidden_reason: COMPLAINT_REASON, is_featured: false, hidden_prev_status: 'open', hidden_at: '2026-10-27T10:00:00Z' })
  assert.ok(isHiddenTuition(u.status as string), 'out of every list (status hidden)')
  assert.ok(isComplaintPaused(u as { status: string; hidden_reason: string }))
  assert.equal(NO_LONGER_AVAILABLE, 'Tuition no longer available')
  assert.equal(COMPLAINT_LABEL, 'Paused: contact complaint')
})

test('B: the page stays at its URL, noindex, no JobPosting, number never revealed', () => {
  const page = read('app/(site)/tuitions/[city]/[slug]/page.tsx')
  assert.match(page, /if \(!job \|\| isHiddenTuition\(job\.status\)\) \{\s*return \{ title: pageTitle\('Tuition'\), robots: \{ index: false/)
  const cut = page.indexOf('return <TuitionNotAvailable')
  assert.ok(cut > 0 && cut < page.indexOf('jobPostingJsonLd('), 'the notice returns before any JobPosting is built')
  assert.ok(read('components/TuitionNotAvailable.tsx').includes('NOT_AVAILABLE_MESSAGE'))
  assert.equal(NOT_AVAILABLE_MESSAGE, 'This tuition is not available')
  const m210 = read('supabase/migrations/210_complaint_hold_email_savings.sql')
  assert.match(m210, /where j\.status = 'hidden' and j\.public_slug is not null\s*and j\.hidden_reason is distinct from 'contact_complaint'/)
  assert.match(read('lib/contactReveal.ts'), /if \(job\.status === 'hidden'\) return \{ ok: false, reason: 'no_contact' \}/)
})

test('B: nothing automatic unpauses it', () => {
  const m210 = read('supabase/migrations/210_complaint_hold_email_savings.sql')
  assert.equal((m210.match(/hidden_reason is distinct from 'contact_complaint'/g) ?? []).length, 3, 'account flag sync never un-hides or re-labels it; no redirect')
  const base = { id: 'j', pauseSource: 'auto', selfPausedAt: null, mergedInto: null, createdAt: new Date().toISOString(), resumedAt: null, posterSuspended: false, posterBanned: false, posterPausedByUser: false, contactPhone: '923001234567', parentPhone: null, isTeamPost: true }
  assert.equal(resumeVerdict({ ...base, status: 'hidden' } as never), 'not_age_pause', 'the 20-day reactivation leaves it alone')
  assert.ok(pauseSkips({ status: 'hidden', hidden_reason: COMPLAINT_REASON }), 'a second pause leaves it alone')
})

test('B: posting is refused while the number is on hold (Do not use wins)', () => {
  const n = '923001112233'
  const holds = new Set([numberHash(n)])
  assert.equal(postingRefusal(['0300 1112233'], new Set(), holds), HOLD_MESSAGE)
  assert.equal(HOLD_MESSAGE, 'This number has a complaint on file. Please check with the owner.')
  assert.equal(postingRefusal([n], holds, holds), DO_NOT_USE_MESSAGE)
  assert.equal(postingRefusal(['0300 9998877'], new Set(), holds), null)
})

test('B: both actions and Unpause all are Owner only, with reason, password and Audit, never the number', () => {
  for (const r of ['pause', 'unpause', 'withdraw']) {
    const src = read(`app/api/admin/contact-withdraw/${r}/route.ts`)
    assert.ok(src.includes('ownerContactGate') && src.includes('requireFreshAuth') && src.includes('reasonProblem'), r)
  }
  const lib = read('lib/contactWithdraw.ts')
  assert.ok(lib.includes("action: 'contact.pause_complaint'") && lib.includes("action: 'contact.unpause_complaint'"))
  assert.ok(!/detail: \{[^}]*msisdn/.test(lib), 'no number in an audit detail')
})

// ── Part B.3 — Unpause all restores exactly ─────────────────────────────
test('B: Unpause all puts every tuition back exactly as it was', () => {
  const states = [
    openJob,
    { status: 'paused', hidden_reason: null, hidden_prev_status: null, hidden_at: null, is_featured: false },
    { status: 'closed', hidden_reason: null, hidden_prev_status: null, hidden_at: null, is_featured: false },
    { status: 'hidden', hidden_reason: 'parent_hidden', hidden_prev_status: 'open', hidden_at: '2026-10-01T00:00:00Z', is_featured: false },
  ]
  for (const s of states) {
    const snap = holdSnapshot(s)
    const after = { ...s, ...pauseUpdate(s, '2026-10-27T10:00:00Z') } as typeof s
    assert.ok(mayRestore(after))
    assert.deepEqual({ ...after, ...restoreUpdate(snap) }, s, `${s.status} restored exactly`)
  }
  assert.ok(!mayRestore({ status: 'hidden', hidden_reason: 'contact_withdrawn' }), 'withdrawn since → left alone')
})

// ── Part C — PayPro settlement ──────────────────────────────────────────
const pay = (ref: string, paidAt: string, gross = 199, share: number | null = 193): PayproPaymentIn => ({
  id: ref, ref, paidAt, member: 'Test Tutor', gross, exportAmount: share == null ? null : gross, exportShare: share, refundedPkr: 0, refundedAt: null,
})

test('C: payouts are allocated to payments oldest first; the rest is pending', () => {
  const payments = [pay('C', '2026-10-05T10:00:00Z'), pay('A', '2026-10-01T10:00:00Z'), pay('B', '2026-10-02T10:00:00Z'), pay('D', '2026-10-06T10:00:00Z')]
  const r = buildSettlement(payments, [{ id: 'p1', date: '2026-10-07', amount: 578 }], new Map(), new Date('2026-10-10T10:00:00Z'))
  assert.deepEqual(r.lines.map((l) => [l.ref, l.settled, l.pending]), [['A', 193, 0], ['B', 193, 0], ['C', 192, 1], ['D', 0, 193]])
  assert.equal(r.netExpected, 772)
  assert.equal(r.received, 578)
  assert.equal(r.pending, 194)
  assert.equal(r.oldestUnsettled, '2026-10-05T10:00:00Z')
  assert.deepEqual(r.unsettled.map((l) => [l.ref, l.daysWaiting]), [['C', 5], ['D', 4]])
  assert.equal(settlementCardLine(r.pending), 'PayPro: Rs 194 not settled yet')
})

test('C: an unclear fee says Check with PayPro; a missing export row uses the usual fee', () => {
  const weird = buildSettlement([pay('X', '2026-10-01T00:00:00Z', 199, 203)], [], new Map(), new Date())
  assert.equal(feeLabel(weird.lines[0]), 'Check with PayPro')
  const typical = typicalFees([{ amount: 199, share: 193 }, { amount: 199, share: 193 }, { amount: 199, share: 194 }])
  const est = buildSettlement([pay('Y', '2026-10-01T00:00:00Z', 199, null)], [], typical, new Date())
  assert.equal(est.lines[0].net, 193)
  assert.match(feeLabel(est.lines[0]), /estimated/)
  assert.deepEqual(splitPayouts([{ id: 'a', date: 'd', amount: 578, sender: 'PAYPRO PVT LTD' }, { id: 'b', date: 'd', amount: 10000, sender: 'Someone' }]).notFromPaypro.map((p) => p.id), ['b'])
  const refunded = buildSettlement([{ ...pay('R', '2026-10-01T00:00:00Z'), refundedPkr: 199 }], [], new Map(), new Date())
  assert.equal(refunded.refundedTotal, 199)
})

// ── Part D ──────────────────────────────────────────────────────────────
test('D: PayPro reads Retired; no Pay later and no PayPro way to pay in Payment gateways', () => {
  assert.equal(PAYPRO_RETIRED_LINE, 'PayPro: Retired — orders started before 25 Nov 2026 still complete')
  const settings = read('app/admin/payments/settings/page.tsx')
  // The retired line itself left the settings pages (owner, 31 Oct 2026).
  assert.ok(!settings.includes('PAYPRO_RETIRED_LINE') && !settings.includes('PayPro mode') && !settings.includes('Pay later'))
  const gw = read('app/admin/payments/settings/gateways/GatewaysClient.tsx')
  assert.ok(!/Pay later|Online payment on PayPro|Active gateway/.test(gw))
  assert.ok(!read('app/admin/payments/settings/gateways/page.tsx').includes('Pay later'))
})

// ── Part E — payment emails, staff alerts, Notification settings ───────
test('E: no "New payment received" email; bank approval email to the Owner only', () => {
  assert.equal(typeOn('payment_alert', null), false)
  assert.equal(typeOn('bank_transfer_pending', null), true)
  const src = read('lib/payments/paymentAlerts.ts')
  assert.ok(!/@gmail\.com|@tutormint\.org/.test(src), 'no address in code')
  assert.ok(src.includes('ownerEmail()'), 'the Owner account address, read from the profile')
  assert.ok(!src.includes('PAYMENT_ALERTS_KEY).maybeSingle'), 'the old staff address list is no longer read')
  const facts: PolicyFacts = { ...NO_FACTS, typeOff: new Set(STAFF_TEMPLATES.filter((t) => !typeOn(t, null))) }
  const d = decideAll([{ to: 'owner@example.com', template: 'payment_alert' }, { to: 'owner@example.com', template: 'bank_transfer_pending' }], facts)
  assert.deepEqual(d.map((x) => x.action), ['skip', 'send'])
})

test('E: staff alerts are in the bell; their emails are off by default', () => {
  for (const t of STAFF_TEMPLATES) if (t !== 'bank_transfer_pending') assert.equal(typeOn(t, null), false, t)
  const ids = staffRecipients(
    [
      { id: 'owner', admin_role: 'owner' },
      { id: 'ops', admin_role: 'operations' },
      { id: 'staff', admin_role: 'tuitions_staff' },
      { id: 'paused', admin_role: 'operations', is_suspended: true },
    ],
    ['admin', 'operations'],
  )
  assert.deepEqual(ids, ['owner', 'ops'])
  const src = read('lib/payments/paymentAlerts.ts')
  assert.equal((src.match(/await bellStaff\(/g) ?? []).length, 4, 'every alert rings the bell')
})

test('E: Notification settings — switches, locks and the log', () => {
  assert.equal(typeOn('documents_reuploaded', 'on'), true)
  assert.equal(typeOn('welcome', 'off'), false)
  assert.equal(typeOn('confirm_email', 'off'), true, 'sign-in emails cannot be switched off')
  assert.equal(typeOn('account_erased', 'off'), true)
  const s = read('lib/email/settings.ts')
  assert.ok(s.includes("action: 'settings.email_type'"), 'every change is logged')
  const route = read('app/api/admin/settings/email-types/route.ts')
  assert.ok(route.includes("gate.actor.adminRole !== 'owner'") && route.includes('requireFreshAuth'))
})

// ── Part F — saving rules ───────────────────────────────────────────────
test('F: never to a placeholder, empty, unconfirmed (except confirmation) or do-not-email address', () => {
  const facts: PolicyFacts = { ...NO_FACTS, unconfirmed: new Set(['new@example.com']), doNotEmail: new Set(['bounced@example.com']) }
  const d = decideAll(
    [
      { to: '923001234567@users.tutormint.org', template: 'plan_expired' },
      { to: '', template: 'plan_expired' },
      { to: 'new@example.com', template: 'plan_expired' },
      { to: 'NEW@example.com', template: 'confirm_email' },
      { to: 'bounced@example.com', template: 'confirm_email' },
    ],
    facts,
  )
  assert.deepEqual(d.map((x) => x.action), ['skip', 'skip', 'skip', 'send', 'skip'])
})

test('F: the webhook refuses a bad or missing signature and accepts a good one', () => {
  const secret = 'whsec_' + Buffer.from('invented-test-secret-0123456789').toString('base64')
  const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 'e1', to: ['x@example.com'] } })
  const now = 1_800_000_000
  const sig = signPayload(secret, 'msg_1', String(now), body)
  assert.equal(verifyWebhook(secret, { id: 'msg_1', timestamp: String(now), signature: `v1,${sig}` }, body, now), true)
  assert.equal(verifyWebhook(secret, { id: 'msg_1', timestamp: String(now), signature: 'v1,AAAA' }, body, now), false)
  assert.equal(verifyWebhook(secret, { id: 'msg_1', timestamp: String(now), signature: `v1,${sig}` }, body + ' ', now), false)
  assert.equal(verifyWebhook(secret, { id: null, timestamp: null, signature: null }, body, now), false)
  assert.equal(verifyWebhook(secret, { id: 'msg_1', timestamp: String(now - 600), signature: `v1,${sig}` }, body, now), false, 'too old')
  assert.equal(verifyWebhook(undefined, { id: 'msg_1', timestamp: String(now), signature: `v1,${sig}` }, body, now), false)
  assert.deepEqual(webhookAction(JSON.parse(body)), { kind: 'do_not_email', reason: 'bounced', addresses: ['x@example.com'], emailId: 'e1' })
  const route = read('app/api/webhooks/resend/route.ts')
  assert.ok(route.includes("if (!secret) return NextResponse.json({ error: 'Not enabled.' }, { status: 503 })"))
})

test('F: 3 unopened emails of a type stop that type for the person (only with tracking on)', () => {
  assert.equal(unopenedStreak([{ openedAt: null }, { openedAt: null }, { openedAt: null }, { openedAt: '2026-10-01' }]), 3)
  assert.equal(unopenedStreak([{ openedAt: null }, { openedAt: 'x' }, { openedAt: null }]), 1)
  const unopened = new Map([['plan_expiring|a@example.com', 3]])
  assert.equal(decideAll([{ to: 'a@example.com', template: 'plan_expiring' }], { ...NO_FACTS, unopened, trackingActive: true })[0].action, 'skip')
  assert.equal(decideAll([{ to: 'a@example.com', template: 'plan_expiring' }], { ...NO_FACTS, unopened, trackingActive: false })[0].action, 'send')
})

test('F: non-urgent member emails are held for one daily summary per person', () => {
  const d = decideAll([{ to: 'p@example.com', template: 'tuition_match' }, { to: 'p@example.com', template: 'tuition_paused' }], NO_FACTS)
  assert.deepEqual(d.map((x) => (x.action === 'queue' ? x.kind : x.action)), ['summary', 'summary'])
  assert.equal(decideAll([{ to: 'p@example.com', template: 'tuition_match' }], NO_FACTS, { fromQueue: true })[0].action, 'send')
  const groups = groupSummaries([
    { id: '1', recipient: 'p@example.com', template: 'tuition_match', subject: 'New tuition', text: 'Grade 5 Maths\n© 2026 Tutor Mint', createdAt: '2026-10-27T01:00:00Z' },
    { id: '2', recipient: 'P@example.com', template: 'message_digest', subject: 'Messages', text: 'You have 1 new message', createdAt: '2026-10-27T02:00:00Z' },
    { id: '3', recipient: 'p@example.com', template: 'message_digest', subject: 'Messages', text: 'You have 3 new messages', createdAt: '2026-10-27T03:00:00Z' },
    { id: '4', recipient: 'q@example.com', template: 'welcome', subject: 'Welcome', text: 'Hi', createdAt: '2026-10-27T04:00:00Z' },
  ])
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0].ids, ['1', '2', '3'])
  assert.deepEqual(groups[0].items.map((i) => i.text), ['Grade 5 Maths', 'You have 3 new messages'])
  const m = render({ id: 'daily_summary', items: groups[0].items })
  assert.match(m.subject, /2 updates/)
  assert.ok(m.text.includes('Grade 5 Maths'))
})

test('F: the same template to the same person at most once in 24 hours', () => {
  const facts = { ...NO_FACTS, recent: new Set(['plan_expired|a@example.com']) }
  const d = decideAll([{ to: 'a@example.com', template: 'plan_expired' }, { to: 'b@example.com', template: 'plan_expired' }, { to: 'b@example.com', template: 'plan_expired' }], facts)
  assert.deepEqual(d.map((x) => x.action), ['skip', 'send', 'skip'])
  assert.equal(decideAll([{ to: 'a@example.com', template: 'confirm_email' }], { ...NO_FACTS, recent: new Set(['confirm_email|a@example.com']) })[0].action, 'send', 'a confirmation can be resent')
})

test('F: from 90 of the daily limit only critical emails go; the rest are held for tomorrow', () => {
  assert.equal(criticalOnlyFrom(100), 90)
  assert.equal(parseDailyLimit('3000'), 3000)
  assert.equal(parseDailyLimit('abc'), 100)
  const facts = { ...NO_FACTS, sentToday: 89, limit: 100 }
  const d = decideAll(
    [{ to: 'a@example.com', template: 'plan_expired' }, { to: 'b@example.com', template: 'plan_expired' }, { to: 'o@example.com', template: 'bank_transfer_pending' }, { to: 'c@example.com', template: 'confirm_email' }],
    facts,
  )
  assert.deepEqual(d.map((x) => (x.action === 'queue' ? x.kind : x.action)), ['send', 'daily_limit', 'send', 'send'])
  for (const t of ['confirm_email', 'password_reset', 'account_erased', 'bank_transfer_pending']) assert.ok(CRITICAL_TEMPLATES.has(t))
})

test('F: the send path records skipped and held emails and never attempts them', async () => {
  const rows: SendRow[] = []
  const held: unknown[] = []
  let calls = 0
  __setEmailDepsForTests({
    fetch: (async () => {
      calls++
      return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ id: 'e', data: [{ id: 'e1' }] }), text: async () => '' } as unknown as Response
    }) as unknown as typeof fetch,
    apiKey: () => 're_test',
    production: () => true,
    recorder: async () => ({ sends: async (r) => void rows.push(...r), runStart: async () => {}, runFinish: async () => {} }),
    log: () => {},
    policy: { facts: async () => ({ ...NO_FACTS, sentToday: 95, limit: 100 }), enqueue: async (i) => void held.push(...i) },
  })
  try {
    const a = await sendOne({ to: 'a@example.com', subject: 's', text: 't', template: 'plan_expired' })
    assert.equal(a.ok, false)
    const b = await sendOne({ to: 'a@example.com', subject: 's', text: 't', template: 'confirm_email' })
    assert.equal(b.ok, true)
    await sendBulk([{ to: 'b@example.com', subject: 's', text: 't', template: 'tuition_match' }], { job: 'tuition_match' })
    assert.equal(calls, 1, 'only the critical email was attempted')
    assert.deepEqual(rows.map((r) => r.status), ['queued', 'sent', 'queued'])
    assert.equal(held.length, 2)
  } finally {
    __setEmailDepsForTests()
  }
})

test('F: Email usage counts per day and type, reasons without addresses', () => {
  const rows = usageTable([
    { at: '2026-10-27T05:00:00Z', template: 'tuition_paused', status: 'sent', reason: null },
    { at: '2026-10-27T06:00:00Z', template: 'tuition_paused', status: 'sent', reason: null },
    { at: '2026-10-27T07:00:00Z', template: 'tuition_paused', status: 'skipped', reason: 'invalid address: x@example.com' },
    { at: '2026-10-27T08:00:00Z', template: 'payment_alert', status: 'queued', reason: null },
    { at: '2026-10-26T08:00:00Z', template: 'confirm_email', status: 'failed', reason: 'Resend 500' },
  ])
  const t = rows.find((r) => r.day === '2026-10-27' && r.template === 'tuition_paused')!
  assert.deepEqual([t.sent, t.skipped, t.failed, t.queued], [2, 1, 0, 0])
  assert.deepEqual(Object.keys(t.skipReasons), ['invalid address: [address]'])
  assert.deepEqual(dayTotals(rows)[0], { day: '2026-10-27', sent: 2, skipped: 1, failed: 0, queued: 1 })
  assert.equal(cleanReason('to 03001234567 failed'), 'to [number] failed')
})

// ── Part G ──────────────────────────────────────────────────────────────
test('G: the first stage on a tutor’s My applications reads "Application received"', () => {
  assert.equal(TUTOR_STAGE_TEXT.applied, 'Application received')
  assert.equal(TUTOR_STAGE_TEXT.forwarded, 'Shared with the parent', 'nothing else changed')
})

// ── No addresses, phones or account numbers in logs ─────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}

test('logs: no email address, phone or account number is printed', () => {
  const files = [...walk('lib/email'), 'lib/notify/index.ts', 'lib/payments/paymentAlerts.ts', 'lib/staffAlerts.ts', 'lib/contactWithdraw.ts', 'lib/payproSettlement.ts', 'app/api/webhooks/resend/route.ts']
  const bad: string[] = []
  for (const f of files) {
    for (const line of read(f).split('\n')) {
      if (!/console\.(log|info|warn|error)\(/.test(line)) continue
      if (f.endsWith('send.ts') && line.includes('consolePrint')) continue
      if (/\$\{[^}]*(\.to\b|email|address|msisdn|phone|iban|account_number|recipient)[^}]*\}/i.test(line) || /,\s*(email|address|msisdn|to)\s*[,)]/.test(line)) bad.push(`${f}: ${line.trim()}`)
    }
  }
  assert.deepEqual(bad, [])
  assert.equal(logLineSafe('[email] tuition_paused failed: Resend 500'), true)
  assert.equal(logLineSafe('[email] to someone@example.com failed'), false)
  assert.equal(logLineSafe('number 03001234567'), false)
})
