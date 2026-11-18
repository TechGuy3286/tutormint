/**
 * scripts/test-pr04.ts — PR-04 (owner, 18 Nov 2026): statement matching fix,
 * erase-requested members out of follow-ups, default pictures in admin.
 * Pure rules plus source scans, on INVENTED data only. Nothing touches a
 * database.
 *
 *   npm run test:pr04
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  AUTO_PAIR_REASON,
  MULTI_ACCOUNT_NOTE,
  bankMoneyCounted,
  doubleLinks,
  matchFeeCredits,
  pairApprovedPayments,
  possibleDuplicates,
  resultLists,
  type ApprovedBankPayment,
  type FeeCredit,
  type MatchMember,
  type RecordedCredit,
} from '../lib/bankStatementCore'
import { excludedReason, peopleFixed } from '../lib/peopleDirectoryCore'
import { ERASE_BANNER, eraseContactPolicy, eraseDateLine, eraseMovesCount, eraseTags } from '../lib/eraseRequestedCore'
import { adminAvatarView, NO_PHOTO_TAG, pickAvatarSrc } from '../lib/adminAvatarCore'
import AdminAvatar from '../components/admin/AdminAvatar'

const read = (p: string) => readFileSync(p, 'utf8')
const RANGE = { min: 199, max: 210 }

const credit = (rowId: string, date: string, amount: number, extra: Partial<FeeCredit> = {}): FeeCredit => ({
  rowId,
  transferId: `t-${rowId}`,
  date,
  time: '12:00',
  amount,
  senderName: null,
  refs: [],
  mobile: null,
  settled: false,
  ...extra,
})
const approved = (id: string, approvedAt: string, extra: Partial<ApprovedBankPayment> = {}): ApprovedBankPayment => ({
  id,
  memberId: `m-${id}`,
  memberName: 'Invented Member',
  planCode: 'verified',
  amount: 199,
  approvedAt,
  createdAt: null,
  hasCredit: false,
  ...extra,
})
const member = (id: string, mobiles: string[] = []): MatchMember => ({ id, names: ['Invented Person'], mobiles, createdAt: '2026-10-01T00:00:00Z', feePaid: false })

// ------------------------------------------------------- 1. statement matching

test('approved-payment matching: unique on both sides → linked automatically', () => {
  // A nameless Rs 200 credit (only "CONTRA ACCT: …") and one Rs 199 payment approved the same day.
  const m = matchFeeCredits({
    credits: [credit('r1', '2026-10-20', 200)],
    receipts: [],
    approved: [approved('p1', '2026-10-20T09:00:00Z')],
    members: [],
    range: RANGE,
  })
  assert.deepEqual(m.get('r1'), { kind: 'approved', paymentId: 'p1', reason: AUTO_PAIR_REASON, auto: true })
})

test('approved-payment matching: the receipt upload time counts as well as the approval', () => {
  // Approved 5 days later, but the receipt was uploaded the same day as the credit.
  const p = pairApprovedPayments([{ rowId: 'r1', date: '2026-10-20', time: '12:00', amount: 199 }], [approved('p1', '2026-10-25T09:00:00Z', { createdAt: '2026-10-20T08:00:00Z' })], RANGE)
  assert.deepEqual(p.auto, [{ rowId: 'r1', paymentId: 'p1' }])
})

test('approved-payment matching: ambiguous → a suggestion, closest first, never linked', () => {
  // Two credits of the same amount, one payment: not unique on the payment side.
  const credits = [credit('r1', '2026-10-20', 199, { time: '10:00' }), credit('r2', '2026-10-21', 199, { time: '10:00' })]
  const pays = [approved('p1', '2026-10-20T06:00:00Z')]
  const m = matchFeeCredits({ credits, receipts: [], approved: pays, members: [], range: RANGE })
  assert.equal(m.get('r1')?.kind, 'unmatched')
  assert.equal(m.get('r2')?.kind, 'unmatched')
  const pairing = pairApprovedPayments(credits, pays, RANGE)
  assert.deepEqual(pairing.auto, [])
  assert.deepEqual(pairing.forPayment.get('p1'), ['r1', 'r2'], 'closest first')
  const lists = resultLists(m, pays, { from: '2026-10-19', to: '2026-10-22' }, pairing)
  assert.deepEqual(
    lists.approvedNoCredit[0].suggestions.map((s) => s.rowId),
    ['r1', 'r2'],
  )
  assert.equal(lists.approvedNoCredit[0].suggestion?.rowId, 'r1')
  // Two payments, one credit: not unique on the credit side either.
  const two = pairApprovedPayments([{ rowId: 'r1', date: '2026-10-20', time: '12:00', amount: 199 }], [approved('p1', '2026-10-20T06:00:00Z'), approved('p2', '2026-10-21T06:00:00Z')], RANGE)
  assert.deepEqual(two.auto, [])
})

test('approved-payment matching: outside ±2 days, the wrong amount, or already credited → nothing', () => {
  const c = [{ rowId: 'r1', date: '2026-10-20', time: '12:00', amount: 199 }]
  assert.deepEqual(pairApprovedPayments(c, [approved('p1', '2026-10-24T06:00:00Z')], RANGE).auto, [], 'too far')
  assert.deepEqual(pairApprovedPayments(c, [approved('p1', '2026-10-20T06:00:00Z', { planCode: 'premium', amount: 499 })], RANGE).auto, [], 'wrong amount')
  assert.deepEqual(pairApprovedPayments(c, [approved('p1', '2026-10-20T06:00:00Z', { hasCredit: true })], RANGE).auto, [], 'already credited')
})

test('Link and Undo: the Owner links, Undo removes the link and stops it coming back', () => {
  const route = read('app/api/admin/finance/statement/route.ts')
  assert.match(route, /z\.literal\('link_approved'\)/)
  assert.match(route, /z\.literal\('unlink'\)/)
  assert.match(route, /refuseUnlessOwnerApproval\(gate\.actor/, 'Owner only')
  const io = read('lib/bankStatement.ts')
  // Undo stamps the row so the automatic matching never relinks the same pair.
  assert.match(io, /clearLinks\(row\.transfer_id as string, actor\)[\s\S]{0,200}auto_link_undone_at: new Date\(\)\.toISOString\(\)/)
  assert.match(io, /if \(!row\?\.transfer_id \|\| row\.auto_link_undone_at\) continue/)
  // The UI: Link with a 10-second Undo; automatic links listed with Undo.
  const ui = read('app/admin/finance/statement/StatementClient.tsx')
  assert.match(ui, /action: 'link_approved'[\s\S]{0,200}label: 'Undo', ms: 10_000[\s\S]{0,80}action: 'unlink'/)
  assert.match(ui, /Linked automatically \(\{board\.lists\.autoLinked\.length\}\)/)
  // The link refuses a credit or payment that already has one.
  const fee = read('lib/feeMatch.ts')
  assert.match(fee, /export async function linkStatementCredit[\s\S]{0,600}c\.state !== 'unmatched'[\s\S]{0,300}r\.state !== 'waiting'/)
})

test('"Same money — link" adds nothing: the row points at the credit already recorded', () => {
  const transfers = [{ id: 'tA', amountPkr: 199 }]
  // Before: one recorded credit, the statement row has no credit of its own.
  const before = bankMoneyCounted([{ id: 'other', transferId: 'tA' }, { id: 'row', transferId: null }], transfers)
  // After "Same money — link": the row points at the SAME credit.
  const after = bankMoneyCounted([{ id: 'other', transferId: 'tA' }, { id: 'row', transferId: 'tA' }], transfers)
  assert.equal(before, 199)
  assert.equal(after, 199, 'no new money')
  // The action never inserts a bank credit; Add is the one that does, behind a warning.
  const io = read('lib/bankStatement.ts')
  const same = io.slice(io.indexOf('export async function sameMoneyRow'), io.indexOf('export async function undoSameMoneyRow'))
  assert.doesNotMatch(same, /from\('bank_transfers'\)\.insert/)
  assert.match(same, /resolveUnclearRow\(rowId, \{ kind: 'same', transferId \}, actor\)/)
  const ui = read('app/admin/finance/statement/StatementClient.tsx')
  assert.match(ui, /Same money — link/)
  assert.match(ui, /This counts it as NEW money in the bank totals/)
  // The duplicates shown: same amount and day, closest time first, not already tied to a row.
  const rec: RecordedCredit[] = [
    { id: 'c1', reference: null, amountPkr: 199, date: '2026-10-20', time: '15:00', senderName: null, source: 'manual', statementRowId: null },
    { id: 'c2', reference: null, amountPkr: 199, date: '2026-10-20', time: '12:05', senderName: null, source: 'email', statementRowId: null },
    { id: 'c3', reference: null, amountPkr: 199, date: '2026-10-20', time: '12:01', senderName: null, source: 'manual', statementRowId: 'x' },
    { id: 'c4', reference: null, amountPkr: 200, date: '2026-10-20', time: '12:00', senderName: null, source: 'manual', statementRowId: null },
  ]
  assert.deepEqual(possibleDuplicates({ deposit: 199, date: '2026-10-20', time: '12:00', sender: null }, rec).map((c) => c.id), ['c2', 'c1'])
})

test('Assign on nameless rows: every unmatched row has Assign; a row with no credit gets one first', () => {
  const ui = read('app/admin/finance/statement/StatementClient.tsx')
  const unmatched = ui.slice(ui.indexOf('id="unmatched"'), ui.indexOf('id="approved-no-credit"'))
  assert.match(unmatched, /onClick=\{\(\) => void startAssign\(m\.row\)\}>\s*Assign to a member/)
  assert.doesNotMatch(unmatched, /m\.row\.transferId && \(\s*<button[^>]*>\s*Assign/, 'not hidden behind a bank credit')
  assert.match(ui, /action: 'ensure_credit'/)
  const io = read('lib/bankStatement.ts')
  // A row under "possibly already recorded" may be old money: never made into a new credit by Assign.
  assert.match(io, /export async function ensureRowCredit[\s\S]{0,700}transfer_how === 'unclear'\) return \{ ok: false, status: 409/)
  // Member search by name, mobile or email (the existing LinkBankCredit search).
  assert.match(read('lib/bankPaymentLink.ts'), /full_name\.ilike[\s\S]{0,80}email\.ilike[\s\S]{0,200}phone_number\.eq/)
})

test('"That number is on more than one account": the candidates are offered, masked, to pick one', () => {
  const m = matchFeeCredits({
    credits: [credit('r1', '2026-10-20', 199, { mobile: '923001112223' })],
    receipts: [],
    approved: [],
    members: [member('a', ['923001112223']), member('b', ['923001112223'])],
    range: RANGE,
  })
  assert.deepEqual(m.get('r1'), { kind: 'unmatched', note: MULTI_ACCOUNT_NOTE, candidates: ['a', 'b'] })
  const lists = resultLists(m, [], { from: null, to: null })
  assert.deepEqual(lists.unmatched[0].candidates, ['a', 'b'])
  const io = read('lib/bankStatement.ts')
  assert.match(io, /mobile: maskPhoneDisplay\(p\?\.phone_number \?\? p\?\.whatsapp \?\? null\)/, 'mobiles masked')
  assert.match(read('app/admin/finance/statement/StatementClient.tsx'), /Pick this account/)
})

test('no double counting: one credit ↔ one payment, possibly-recorded rows never matched', () => {
  // Many credits and payments: the automatic pairs never reuse either side.
  const credits = Array.from({ length: 6 }, (_, i) => ({ rowId: `r${i}`, date: `2026-10-${10 + i * 3}`, time: '12:00', amount: 199 }))
  const pays = Array.from({ length: 6 }, (_, i) => approved(`p${i}`, `2026-10-${10 + i * 3}T07:00:00Z`))
  const pairing = pairApprovedPayments(credits, pays, RANGE)
  assert.equal(pairing.auto.length, 6)
  assert.deepEqual(doubleLinks(pairing.auto.map((a) => ({ creditId: a.rowId, paymentId: a.paymentId }))), [])
  assert.deepEqual(doubleLinks([{ creditId: 'c', paymentId: 'p1' }, { creditId: 'c', paymentId: 'p2' }]), ['c'], 'a credit twice is caught')
  // A transfer two rows point at is counted once; a set-aside one not at all.
  assert.equal(bankMoneyCounted([{ id: 'a', transferId: 't1' }, { id: 'b', transferId: 't1' }, { id: 'c', transferId: 't2' }], [{ id: 't1', amountPkr: 199 }, { id: 't2', amountPkr: 500, setAside: true }]), 199)
  // A row waiting under "possibly already recorded" is left out of the matching.
  assert.match(read('lib/bankStatement.ts'), /!\(r\.transfer_how === 'unclear' && !r\.transfer_id\)/)
})

// --------------------------------------------- 2. erase-requested members

test('erase requested: in no list or count, only under its grey chip; back after cancel', () => {
  assert.equal(excludedReason({ role: 'tutor', eraseRequested: true }), 'erase_requested')
  assert.equal(excludedReason({ role: 'tutor', erased: true, eraseRequested: true }), 'deleted', 'a finished erase wins')
  assert.equal(excludedReason({ role: 'tutor' }), null)
  // The stored-row filter (admin_list_page containment) for each view.
  const rows = [
    { id: 'real', tags: { excluded: false, deleted: false, erase_req: false } },
    { id: 'erase', tags: eraseTags({ excluded: false, deleted: false, erase_req: false }, '2026-11-23T00:00:00Z') },
    { id: 'test', tags: { excluded: true, deleted: false, erase_req: false, excluded_base: true } },
  ]
  const view = (v: 'real' | 'all' | 'erase') => rows.filter((r) => Object.entries(peopleFixed(v)).every(([k, val]) => (r.tags as Record<string, unknown>)[k] === val)).map((r) => r.id)
  assert.deepEqual(view('real'), ['real'], 'every stage, chip, badge and to-do')
  assert.deepEqual(view('all'), ['real', 'test'], 'not even under "Show staff & test accounts"')
  assert.deepEqual(view('erase'), ['erase'], 'only under Erase requested')
  // Cancel: back exactly where it was.
  const back = eraseTags(rows[1].tags, null)
  assert.equal(back.excluded, false)
  assert.equal(back.erase_req, false)
  assert.equal(eraseTags(rows[2].tags, '2026-11-23T00:00:00Z').excluded, true)
  assert.equal(eraseTags(eraseTags(rows[2].tags, '2026-11-23T00:00:00Z'), null).excluded, true, 'a test account stays out after cancel')
  assert.equal(eraseMovesCount({ excluded: false }, '2026-11-23T00:00:00Z'), 'out')
  assert.equal(eraseMovesCount(rows[1].tags, null), 'in')
  assert.equal(eraseMovesCount({ excluded: true, excluded_base: true }, '2026-11-23T00:00:00Z'), 'none')
  assert.equal(eraseDateLine('2026-11-23T05:00:00Z'), 'Erase on 23 Nov 2026')
})

test('erase requested: every work list reads the same exclusion, at once on schedule and cancel', () => {
  assert.match(read('lib/peopleDirectory.ts'), /from\('account_erasures'\)\.select\('id, member_id, due_at'\)\.eq\('status', 'scheduled'\)/)
  assert.match(read('lib/peopleDirectory.ts'), /eraseRequested: eraseDue\.has\(id\)/)
  // Follow-ups, parent follow-ups, Paid tutors and the Overview filter on excluded.
  assert.match(read('lib/staffOutreach.ts'), /p\.excluded !== null/)
  assert.match(read('lib/parentFollowUps.ts'), /p\.excluded === null/)
  assert.match(read('lib/paidTutors.ts'), /p\.excluded === null/)
  // Scheduled and cancelled: the stored row moves in the same request.
  const erase = read('lib/accountErase.ts')
  assert.match(erase, /setPeopleEraseRequested\(args\.memberId, erasure\.due_at\)/)
  assert.match(erase, /setPeopleEraseRequested\(args\.memberId, null\)/)
  assert.match(read('lib/tutorPipeline.ts'), /export async function setPeopleEraseRequested[\s\S]{0,1500}nudgeBadges/)
  assert.match(read('app/admin/users/PeopleTabs.tsx'), /\{ERASE_CHIP_LABEL\} <span/)
})

test('erase requested: member page banner, contact off for staff, Owner warned, documents warned', () => {
  assert.equal(eraseContactPolicy(false, 'admin'), 'allowed')
  assert.equal(eraseContactPolicy(true, 'backend_support'), 'blocked')
  assert.equal(eraseContactPolicy(true, 'partner'), 'blocked')
  assert.equal(eraseContactPolicy(true, 'owner'), 'warn')
  assert.equal(ERASE_BANNER, 'Erase requested — don’t contact')
  const page = read('app/admin/users/[id]/page.tsx')
  assert.match(page, /data-erase-banner=""/)
  assert.match(page, /pipeContact=\{eraseContact === 'blocked' \? null : pipeContact\}/)
  assert.match(page, /data-erase-doc-warning=""/)
  const actions = read('app/admin/users/[id]/MemberActions.tsx')
  assert.match(actions, /eraseContact === 'blocked' \? \(/)
  // The server refuses staff too (the Owner passes).
  for (const p of ['app/api/admin/whatsapp/route.ts', 'app/api/admin/people/follow-up/route.ts', 'app/api/admin/inbox/route.ts']) {
    assert.match(read(p), /refuseEraseRequestedContact\(gate\.actor/, p)
  }
  assert.match(read('lib/eraseRequestedGuard.ts'), /if \(actor\.adminRole === 'owner'\) return null/)
})

// ---------------------------------------------------- 3. default pictures

test('default pictures in admin: male / female / neutral default + "No photo"; a real photo as it is', () => {
  assert.deepEqual(adminAvatarView({ src: null, gender: 'female' }), { src: null, gender: 'female', noPhoto: true, kind: 'female' })
  assert.equal(adminAvatarView({ src: '', gender: 'male' }).kind, 'male')
  assert.equal(adminAvatarView({ src: null, gender: 'trans' }).kind, 'neutral')
  assert.equal(adminAvatarView({ src: null, gender: null }).kind, 'neutral')
  assert.equal(adminAvatarView({ src: 'https://x.test/p.jpg', gender: 'male' }).noPhoto, false)
  assert.equal(pickAvatarSrc(null, 'https://x.test/p.jpg'), 'https://x.test/p.jpg')
  assert.equal(pickAvatarSrc('  ', null), null)

  const none = renderToStaticMarkup(createElement(AdminAvatar, { name: 'Invented', src: null, gender: 'female' }))
  assert.match(none, /data-admin-avatar="default"/)
  assert.match(none, /default-female/)
  assert.ok(none.includes(NO_PHOTO_TAG))
  const neutral = renderToStaticMarkup(createElement(AdminAvatar, { name: 'Invented', src: null, gender: null }))
  assert.match(neutral, /neutral\.svg/)
  const photo = renderToStaticMarkup(createElement(AdminAvatar, { name: 'Invented', src: 'data:image/png;base64,iVBORw0KGgo=', gender: 'male' }))
  assert.match(photo, /data-admin-avatar="photo"/)
  assert.ok(!photo.includes(NO_PHOTO_TAG))
})

test('default pictures in admin: every admin picture goes through AdminAvatar', () => {
  for (const p of [
    'components/admin/OverviewCardGrid.tsx', // People cards, search results
    'components/admin/PipelineActions.tsx',
    'app/admin/users/[id]/page.tsx', // member page header
    'app/admin/payments/PaymentQueue.tsx',
    'app/admin/finance/statement/StatementClient.tsx',
    'app/admin/inbox/InboxClient.tsx',
    'app/admin/applications/ApplicationsClient.tsx',
    'app/admin/applications/ForwardToParents.tsx',
    'app/admin/users/duplicates/page.tsx',
    'app/admin/team/TeamClient.tsx',
  ]) {
    const s = read(p)
    assert.match(s, /<AdminAvatar\b/, p)
    assert.doesNotMatch(s, /import Avatar from '@\/components\/Avatar'/, `${p} uses AdminAvatar`)
  }
  // A real photo hidden publicly is still shown to staff: the loader never reads show_avatar.
  assert.doesNotMatch(read('lib/memberAvatars.ts'), /show_avatar/)
})
