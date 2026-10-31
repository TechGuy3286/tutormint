/**
 * scripts/test-fee-match.ts — payment auto-linking, parent WhatsApp messages,
 * the WhatsApp link audit and no wasted tuition emails (owner, 27 Oct 2026).
 * Pure rules plus source scans with invented data; nothing touches a database.
 *
 *   npm run test:feematch
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  FEE_MATCH_DEFAULT,
  FEE_NAME_HOW,
  alreadyPaidOption,
  approvalPick,
  autoLinkPlan,
  creditLabelOf,
  feeRangeProblem,
  inFeeRange,
  likelyMember,
  namesMatch,
  parseFeeRange,
  partialLabel,
  partialShort,
  relabelPatch,
  roundingOf,
  type FreeCredit,
  type OpenFeePayment,
} from '../lib/feeMatchCore'
import { ALREADY_PAID, feeAmountSplit, linkDecision, type LinkFacts } from '../lib/bankPaymentLinkCore'
import { buildBoard, monthView, NOT_A_SALE, REFUND_DUE, withoutIgnored, type Credit, type Receipt } from '../lib/settlementMatchCore'
import { financeItems } from '../lib/financeItemsCore'
import { fillParentFollowUp, parentMessageSituation, PARENT_DEFAULTS, PARENT_TEMPLATE_KEY, PARENT_PLACEHOLDERS, PARENT_REASONS, type ParentFacts } from '../lib/parentFollowUpCore'
import { unknownPlaceholders } from '../lib/applicationTemplatesCore'
import { finishWaText, siteLink, waChatHref, waSendHref, waShareHref } from '../lib/waLinkCore'
import { tuitionEmailBlock, isTuitionEmail } from '../lib/notify/tuitionEmailCore'
import { TUTOR_STAGE_TEXT } from '../lib/applicationStageCore'

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const R = FEE_MATCH_DEFAULT
const H = 3_600_000

// ---------------------------------------------------------------- Part A.1

test('the fee match range is 199–210 by default; 200 counts, rounding Rs 1', () => {
  assert.deepEqual(R, { min: 199, max: 210 })
  for (const n of [199, 200, 205, 210]) assert.equal(inFeeRange(n, R), true, String(n))
  for (const n of [198, 110, 211, 499]) assert.equal(inFeeRange(n, R), false, String(n))
  assert.equal(roundingOf(200, 199), 1)
  assert.equal(roundingOf(199, 199), 0)
  assert.equal(roundingOf(150, 199), 0)
  // A Rs 200 credit for the fee records Rs 199 + Rs 1 rounding; a plan records as typed.
  assert.deepEqual(feeAmountSplit('verified', 200, 199), { amountPkr: 199, roundingPkr: 1 })
  assert.deepEqual(feeAmountSplit('verified', 199, 199), { amountPkr: 199, roundingPkr: 0 })
  assert.deepEqual(feeAmountSplit('premium', 500, 499), { amountPkr: 500, roundingPkr: 0 })
  // The setting falls back to the default on nonsense; the Owner cannot save nonsense.
  assert.deepEqual(parseFeeRange('199', '210'), { min: 199, max: 210 })
  assert.deepEqual(parseFeeRange('abc', '210'), R)
  assert.deepEqual(parseFeeRange('220', '210'), R)
  assert.equal(feeRangeProblem(199, 210, 199), null)
  assert.ok(feeRangeProblem(210, 199, 199))
  assert.ok(feeRangeProblem(199, 900, 199))
})

// ---------------------------------------------------------------- names

test('names compare without case, spacing, dots or Muhammad / M. / Syed', () => {
  assert.equal(namesMatch('ABDUL AHAD KHAN', 'Abdul Ahad Khan'), true)
  assert.equal(namesMatch('M. ABDUL  AHAD KHAN', 'Abdul Ahad Khan'), true)
  assert.equal(namesMatch('Muhammad Bilal', 'M Bilal'), true)
  assert.equal(namesMatch('USMAN SYED PACHA', 'Usman Said Pacha'), true)
  assert.equal(namesMatch('ABDUL AHAD', 'Abdul Ahad Khan'), true)
  assert.equal(namesMatch('AHAD', 'Abdul Ahad Khan'), false, 'one shared word alone is too weak')
  assert.equal(namesMatch('EMAN ALI', 'Ghania Perveez'), false)
  assert.equal(namesMatch(null, 'Ghania Perveez'), false)
})

// ---------------------------------------------------------------- Part A.2

const credit = (id: string, over: Partial<Credit> = {}): Credit => ({
  id,
  date: '2026-10-26',
  time: '15:00',
  amountPkr: 200,
  senderName: 'ZAINAB NOOR',
  senderBank: null,
  reference: `REF${id}`,
  note: null,
  isPaypro: false,
  ...over,
})
const receipt = (id: string, over: Partial<Receipt> = {}): Receipt => ({
  id,
  ref: `TM-${id}`,
  amountPkr: 199,
  approvedDay: '2026-10-26',
  transactionId: null,
  payerName: 'Zainab Noor',
  planCode: 'verified',
  memberId: `m-${id}`,
  createdAt: '2026-10-26T09:00:00Z',
  reviewedAt: '2026-10-26T09:30:00Z',
  ...over,
})
const board = (credits: Credit[], receipts: Receipt[], links: Parameters<typeof buildBoard>[0]['links'] = []) =>
  buildBoard({ rows: [], credits, ourPaypro: [], receipts, links, nowIso: '2026-10-27T12:00:00Z', feeRange: R })

test('a late Rs 200 credit links to the same-name fee payment within 48 hours', () => {
  const b = board([credit('c1')], [receipt('p1')])
  const c = b.credits.find((x) => x.id === 'c1')!
  assert.equal(c.state, 'matched')
  assert.equal(c.match!.how, FEE_NAME_HOW)
  assert.deepEqual(c.match!.receipts, ['p1'])
  assert.equal(c.match!.difference, 1, 'the extra rupee is the difference — shown as rounding')
})

test('a blind same-amount guess no longer takes the payment of a tutor whose own Rs 200 credit is waiting', () => {
  // Abdul Ahad's shape: his own Rs 200 credit, and someone else's Rs 199 the next day.
  const b = board(
    [credit('own', { senderName: 'ABDUL AHAD KHAN', date: '2026-10-26' }), credit('other', { amountPkr: 199, senderName: 'AIZAZ MASOOD', date: '2026-10-27', time: '10:00' })],
    [receipt('p1', { payerName: 'Abdul Ahad Khan' })],
  )
  assert.equal(b.credits.find((x) => x.id === 'own')!.state, 'matched')
  assert.equal(b.credits.find((x) => x.id === 'other')!.state, 'unmatched')
})

test('outside 48 hours, a different name, or a plan payment: no automatic link', () => {
  assert.equal(board([credit('c1', { date: '2026-10-29' })], [receipt('p1')]).credits[0].state, 'unmatched', '3 days later')
  assert.equal(board([credit('c1', { senderName: 'BURHAN UDDIN' })], [receipt('p1')]).credits[0].state, 'unmatched', 'name differs')
  assert.equal(board([credit('c1', { amountPkr: 500 })], [receipt('p1', { planCode: 'premium', amountPkr: 499 })]).credits[0].state, 'unmatched')
})

test('autoLinkPlan: links a safe pair, suggests when the name differs (the closest shared name first)', () => {
  const pays: OpenFeePayment[] = [
    { id: 'p1', ref: 'TM-1', memberId: 'm1', memberName: 'Zainab Noor', amountPkr: 199, createdAt: '2026-10-26T09:00:00Z', reviewedAt: null },
    { id: 'p2', ref: 'TM-2', memberId: 'm2', memberName: 'Tehmina Nigah', amountPkr: 199, createdAt: '2026-10-26T13:00:00Z', reviewedAt: null },
    { id: 'p3', ref: 'TM-3', memberId: 'm3', memberName: 'Aleena Irfan', amountPkr: 199, createdAt: '2026-10-26T14:50:00Z', reviewedAt: null },
  ]
  const credits: FreeCredit[] = [
    { id: 'c1', date: '2026-10-26', time: '15:00', amountPkr: 200, senderName: 'ZAINAB NOOR', isPaypro: false },
    { id: 'c2', date: '2026-10-26', time: '15:00', amountPkr: 200, senderName: 'Tehmina Naa', isPaypro: false },
    { id: 'c3', date: '2026-10-26', time: '15:00', amountPkr: 200, senderName: 'PAYPRO', isPaypro: true },
  ]
  const plan = autoLinkPlan(credits, pays, R)
  assert.deepEqual(plan.links.map((l) => [l.creditId, l.paymentId, l.rounding]), [['c1', 'p1', 1]])
  assert.equal(plan.suggestions.length, 1)
  assert.equal(plan.suggestions[0].creditId, 'c2')
  assert.equal(plan.suggestions[0].memberName, 'Tehmina Nigah', 'more shared name beats a closer time')
  assert.ok(!plan.suggestions.some((s) => s.creditId === 'c3'), 'PayPro payouts are never suggested')
})

// ---------------------------------------------------------------- Part A.3

test('approving a receipt attaches the closest unlinked in-range credit within 48 hours (no name needed)', () => {
  const credits: FreeCredit[] = [
    { id: 'far', date: '2026-10-22', time: '10:00', amountPkr: 200, senderName: 'X', isPaypro: false },
    { id: 'near', date: '2026-10-26', time: '10:00', amountPkr: 200, senderName: 'SOMEONE ELSE', isPaypro: false },
    { id: 'big', date: '2026-10-26', time: '09:30', amountPkr: 499, senderName: 'Y', isPaypro: false },
  ]
  assert.equal(approvalPick({ createdAt: '2026-10-26T06:00:00Z', reviewedAt: null }, credits, R)?.creditId, 'near')
  assert.equal(approvalPick({ createdAt: '2026-10-18T06:00:00Z', reviewedAt: null }, credits, R), null)
  assert.equal(approvalPick({ createdAt: '2026-10-26T06:00:00Z', reviewedAt: null }, [], R), null)
  assert.ok(48 * H > 0)
})

// ---------------------------------------------------------------- Part A.4 / A.5

const FEE = { code: 'verified', name: 'Verification Fee', audience: 'tutor', pricePkr: 199, active: true }
const facts = (over: Partial<LinkFacts> = {}): LinkFacts => ({
  memberRole: 'tutor',
  feePaidAt: null,
  plan: FEE,
  payments: [],
  subs: [],
  creditState: 'unmatched',
  creditAmountPkr: 200,
  amountPkr: 200,
  feeRange: R,
  ...over,
})

test('"already paid" offers Link (no credit yet) or Mark as duplicate — refund due', () => {
  const d = linkDecision(facts({ feePaidAt: '2026-10-26T09:30:00Z', payments: [{ id: 'p1', planCode: 'verified', status: 'approved' }] }))
  assert.deepEqual(d, { ok: false, error: ALREADY_PAID })
  assert.equal(alreadyPaidOption({ paymentId: 'p1', ref: 'TM-1', amountPkr: 199, approvedAt: null, provider: 'manual', hasCredit: false }), 'link_existing')
  assert.equal(alreadyPaidOption({ paymentId: 'p1', ref: 'TM-1', amountPkr: 199, approvedAt: null, provider: 'manual', hasCredit: true }), 'refund_due')
  assert.equal(alreadyPaidOption({ paymentId: 'p1', ref: 'TM-1', amountPkr: 199, approvedAt: null, provider: 'paypro', hasCredit: false }), 'refund_due')
})

test('a partial payment (below the range) never activates', () => {
  assert.equal(partialShort(110, R, 199), 89)
  assert.equal(partialShort(200, R, 199), null)
  assert.equal(partialLabel(89), 'Partial — Rs 89 short')
  const d = linkDecision(facts({ creditAmountPkr: 110, amountPkr: 110 }))
  assert.equal(d.ok, false)
  assert.match((d as { error: string }).error, /^Partial — Rs 89 short\. A partial payment never activates/)
  // Typing less than the fee from a bigger credit is refused the same way.
  assert.equal(linkDecision(facts({ creditAmountPkr: 200, amountPkr: 150 })).ok, false)
  // In range activates.
  assert.deepEqual(linkDecision(facts()), { ok: true, mode: 'activate' })
})

test('likely member for a partial credit: one name match only', () => {
  const ms = [
    { id: 'a', name: 'Hamana Mukhtar' },
    { id: 'b', name: 'Sara Khan' },
  ]
  assert.equal(likelyMember('HAMANA MUKHTAR', ms)?.id, 'a')
  assert.equal(likelyMember('KHAN', ms), null)
})

// ---------------------------------------------------------------- Part A.6

test('re-labelling a credit "Owner / partner transfer" takes it out of matching and revenue', () => {
  assert.deepEqual(relabelPatch('owner_transfer'), { category: 'owner_transfer' })
  assert.deepEqual(relabelPatch('paypro'), { gateway: 'paypro', category: null })
  assert.deepEqual(relabelPatch('member'), { gateway: 'manual', category: null })
  assert.equal(creditLabelOf({ isPaypro: true, category: 'owner_transfer' }), 'owner_transfer')
  const b = board([credit('big', { amountPkr: 10000, isPaypro: true, senderName: 'SOMEONE', category: 'owner_transfer' })], [])
  const c = b.credits[0]
  assert.equal(c.state, 'ignored')
  assert.equal(c.ignoreKind, 'owner_transfer')
  const items = financeItems(monthView(b, [], '2026-10'))
  const it = items.find((i) => i.creditId === 'big')!
  assert.equal(it.group, 'good', 'not Needs attention')
  assert.equal(it.label, 'Owner / partner transfer (not revenue)')
  // Every money total drops ignored ids (lib/ignoredCredits adds owner transfers and refunds due).
  assert.deepEqual(withoutIgnored([{ id: 'big' }, { id: 'x' }], new Set(['big'])), [{ id: 'x' }])
  assert.match(read('lib/ignoredCredits.ts'), /category', 'owner_transfer'/)
  assert.match(read('lib/ignoredCredits.ts'), /REFUND_DUE/)
  assert.match(read('lib/payproSettlement.ts'), /ignoredCreditIds/)
})

test('a duplicate marked refund due is set aside, and its refund is a Needs-attention item', () => {
  const b = board([credit('dup')], [], [{ transferId: 'dup', kind: 'none', target: REFUND_DUE, note: 'Duplicate of TM-1' }])
  assert.equal(b.credits[0].ignoreKind, 'refund_due')
  const items = financeItems(monthView(b, [], '2026-10'), [], {}, [{ id: 'r1', memberName: 'Zainab Noor', paymentRef: 'TM-1', amountPkr: 200, createdAt: '2026-10-27T10:00:00Z' }])
  const due = items.find((i) => i.kind === 'refund_due')!
  assert.equal(due.group, 'attention')
  assert.equal(due.amount, 200)
  assert.equal(items.find((i) => i.creditId === 'dup')!.label, 'Duplicate payment — refund due')
  assert.notEqual(NOT_A_SALE, REFUND_DUE)
})

test('the routes are Owner only and audited', () => {
  for (const f of ['app/api/admin/payments/refund-due/route.ts', 'app/api/admin/payments/settlement/relabel/route.ts', 'app/api/admin/finance/fee-range/route.ts']) {
    const s = read(f)
    assert.match(s, /refuseUnlessOwnerApproval/, f)
    assert.match(s, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.finance\)/, f)
  }
  const fm = read('lib/feeMatch.ts')
  for (const a of ['settlement.auto_link', 'settlement.approval_link', 'settlement.link_existing', 'settlement.refund_due', 'settlement.refund_done', 'settlement.relabel', 'settings.fee_match_range']) {
    assert.ok(fm.includes(`'${a}'`), a)
  }
  assert.match(read('app/api/admin/payments/decide/route.ts'), /attachCreditOnApproval/)
  assert.match(read('lib/settlementMatch.ts'), /autoLinkNewCredits/)
  assert.match(read('lib/bankEmailReader.ts'), /runFeeAutoLink/)
})

// ---------------------------------------------------------------- Part B.8

const parentFacts = (over: Partial<ParentFacts> = {}): ParentFacts => ({
  joinedAt: '2026-10-01T00:00:00Z',
  emailSignup: false,
  emailConfirmed: true,
  tuitions: [],
  hiredThanksAt: null,
  ...over,
})
const tuition = (over: Partial<ParentFacts['tuitions'][number]> = {}) => ({
  id: 't1',
  title: 'Home Tutor Required | Grade 5 | DHA, Lahore',
  status: 'open',
  createdAt: '2026-10-20T00:00:00Z',
  publicPath: '/tuitions/lahore/home-tutor-grade-5-abc123',
  applications: 0,
  waitingForward: 0,
  hiredAt: null,
  hiredTutorName: null,
  hiredApplicationId: null,
  ...over,
})

test('every parent gets a situation (and a template) — never "nothing to send"', () => {
  const now = Date.parse('2026-10-27T12:00:00Z')
  const cases: [Partial<ParentFacts>, string][] = [
    [{}, 'no_tuition'],
    [{ tuitions: [tuition()] }, 'no_applicants'],
    [{ tuitions: [tuition({ applications: 2, waitingForward: 2 })] }, 'waiting_forward'],
    [{ tuitions: [tuition({ applications: 2, waitingForward: 0 })] }, 'waiting_forward'],
    [{ emailSignup: true, emailConfirmed: false }, 'email_unconfirmed'],
    [{ tuitions: [tuition({ status: 'paused' })] }, 'expired'],
    [{ tuitions: [tuition({ status: 'closed', hiredAt: '2026-10-25T00:00:00Z', hiredTutorName: 'Ali Raza', hiredApplicationId: 'a1' })] }, 'hired'],
    // A brand-new tuition (under 2 days) still has a message: "we're finding tutors".
    [{ tuitions: [tuition({ createdAt: '2026-10-27T08:00:00Z' })] }, 'no_applicants'],
  ]
  for (const [f, want] of cases) assert.equal(parentMessageSituation(parentFacts(f), now).reason, want, JSON.stringify(f))
  for (const r of PARENT_REASONS) assert.ok(PARENT_TEMPLATE_KEY[r], r)
})

test('every parent message has a TutorMint link, the sender ref, no price, no emoji, and ends with the support number', () => {
  const values = {
    firstName: 'Ayesha',
    tuitionTitle: 'Home Tutor Required | Grade 5',
    tuitionLink: siteLink('/tuitions/lahore/home-tutor-grade-5-abc123'),
    postLink: siteLink('/parent/dashboard/post-job'),
    tutorName: 'Ali Raza',
    reviewLink: siteLink('/review?application=a1'),
    tutorLinks: [siteLink('/tutor/ali-raza'), siteLink('/tutor/sara-khan')],
    signinLink: siteLink('/login'),
    repostLink: siteLink('/parent/dashboard/job/t1'),
    supportWhatsapp: '0321 5872222',
  }
  const keys = Object.keys(PARENT_DEFAULTS)
  assert.equal(keys.length, 6, 'tutors applied, no tuition, no applicants, email, expired, hired')
  for (const key of keys) {
    const body = PARENT_DEFAULTS[key]
    assert.deepEqual(unknownPlaceholders(body, PARENT_PLACEHOLDERS), [], key)
    const text = finishWaText(fillParentFollowUp(body, values), 'AQSA')
    assert.match(text, /https:\/\/www\.tutormint\.org\/[^\s]*ref=AQSA/, `${key} has a link with the ref`)
    assert.ok(!/Rs\.?\s?\d|PKR|\d+\s?rupees/i.test(text), `${key}: no price`)
    assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${key}: no emoji`)
    assert.match(text, /0321 5872222$/, `${key} ends with the support number`)
    const href = waSendHref('923001234567', text)
    assert.ok(href.startsWith('https://api.whatsapp.com/send?phone=923001234567&text='), key)
  }
  // The tutors-applied message lists every tutor's profile.
  const ta = fillParentFollowUp(PARENT_DEFAULTS.pf_tutors_applied, values)
  assert.match(ta, /tutor\/ali-raza/)
  assert.match(ta, /tutor\/sara-khan/)
})

test('every parent WhatsApp button goes through the one builder and records a follow-up', () => {
  const pw = read('lib/parentWhatsApp.ts')
  assert.match(pw, /recordFollowUp/)
  assert.match(pw, /senderRefCode/)
  assert.match(pw, /waSendHref/)
  assert.match(read('app/api/admin/follow-ups/parent/route.ts'), /sendParentMessage/)
  assert.match(read('app/api/admin/whatsapp/route.ts'), /sendParentMessage/)
  for (const f of ['app/admin/users/[id]/MemberActions.tsx', 'components/admin/OverviewCardGrid.tsx', 'components/admin/WhatsappChatButton.tsx', 'app/admin/jobs/[id]/page.tsx']) {
    assert.match(read(f), /AdminWhatsAppLink/, f)
  }
  assert.match(read('components/admin/AdminWhatsAppLink.tsx'), /UNDO_MS/)
})

// ---------------------------------------------------------------- Part B.9

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

test('no code outside lib/waLinkCore.ts builds a wa.me or api.whatsapp.com link', () => {
  const offenders: string[] = []
  for (const root of ['app', 'components', 'lib']) {
    for (const f of walk(join(process.cwd(), root))) {
      const rel = f.slice(process.cwd().length + 1).replace(/\\/g, '/')
      if (rel === 'lib/waLinkCore.ts') continue
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '').trim()
          if (code.startsWith('*') || code.startsWith('/*')) return
          if (/wa\.me\/|api\.whatsapp\.com/.test(code)) offenders.push(`${rel}:${i + 1}`)
        })
    }
  }
  assert.deepEqual(offenders, [])
  assert.equal(waChatHref('923001234567'), 'https://api.whatsapp.com/send?phone=923001234567')
  assert.equal(waChatHref(null), null)
  assert.ok(waShareHref('Hi 🙂').startsWith('https://api.whatsapp.com/send?text='))
  assert.ok(waShareHref('Hi 🙂').includes('%F0%9F%99%82'), 'emoji kept')
})

// ---------------------------------------------------------------- Part C

test('no tuition email to the team account, staff, test accounts or placeholder addresses', () => {
  const real = { email: 'parent@example.com', role: 'parent' }
  assert.equal(isTuitionEmail('tuition_paused'), true)
  assert.equal(isTuitionEmail('tuition_match'), true)
  assert.equal(isTuitionEmail('verification_fee_paid'), false)
  assert.equal(tuitionEmailBlock('tuition_paused', real), null)
  assert.ok(tuitionEmailBlock('tuition_paused', { ...real, is_team_account: true }))
  assert.ok(tuitionEmailBlock('tuition_paused', { ...real, role: 'admin' }))
  assert.ok(tuitionEmailBlock('tuition_match', { ...real, is_test_name: true }))
  assert.ok(tuitionEmailBlock('tuition_match', { ...real, hidden_from_public: true }))
  assert.ok(tuitionEmailBlock('tuition_match', { ...real, is_seed: true }))
  assert.ok(tuitionEmailBlock('tuition_paused', { email: '923001234567@users.tutormint.org', role: 'parent' }))
  // Other emails to the same accounts are untouched by this rule.
  assert.equal(tuitionEmailBlock('verification_fee_paid', { ...real, is_team_account: true }), null)
  const notify = read('lib/notify/index.ts')
  assert.match(notify, /tuitionEmailBlock\(input\.id/)
  assert.match(notify, /is_team_account, is_test_name, hidden_from_public, is_seed/)
})

// ---------------------------------------------------------------- Part D

test('the tutor sees "Application received" for the first stage everywhere', () => {
  assert.equal(TUTOR_STAGE_TEXT.applied, 'Application received')
  for (const f of ['app/(site)/tutor/dashboard/applications/page.tsx', 'app/(site)/tutor/dashboard/applications/[id]/page.tsx']) {
    const s = read(f)
    assert.match(s, /applied: \{ label: TUTOR_STAGE_TEXT\.applied/, f)
    assert.ok(!s.includes('Awaiting the parent'), f)
  }
})

// ---------------------------------------------------------------- logs

test('no phone, email or account number in a log line of the new code', () => {
  const files = [
    'lib/feeMatch.ts',
    'lib/feeMatchCore.ts',
    'lib/parentWhatsApp.ts',
    'lib/notify/tuitionEmailCore.ts',
    'app/api/admin/whatsapp/route.ts',
    'app/api/admin/payments/refund-due/route.ts',
    'app/api/admin/payments/settlement/relabel/route.ts',
    'app/api/admin/finance/fee-range/route.ts',
    'app/api/admin/follow-ups/parent/route.ts',
    'components/admin/AdminWhatsAppLink.tsx',
    'components/admin/AlreadyPaidOptions.tsx',
  ]
  for (const f of files) {
    for (const line of read(f).split('\n')) {
      if (!/console\.(log|info|warn|error)/.test(line)) continue
      assert.ok(!/phone|email|mobile|msisdn|iban|account|whatsapp|address/i.test(line), `${f}: ${line.trim()}`)
    }
  }
  // The audit details of the new actions carry ids and amounts only.
  const fm = read('lib/feeMatch.ts')
  assert.ok(!/detail: \{[^}]*(phone|email|iban|account_number|senderName)/.test(fm))
  // The email path never logs the recipient.
  assert.match(read('lib/notify/index.ts'), /console\.info\(`\[notify\] \$\{input\.id\} not sent: \$\{result\.reason\}`\)/)
})
