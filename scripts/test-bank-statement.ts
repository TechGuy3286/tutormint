/**
 * scripts/test-bank-statement.ts — PR-03 (owner, 17 Nov 2026): Faysal bank
 * statement import, matching, personal entries, PayPro's real fee, payment
 * Reopen / Undo, and who may do what. Pure rules plus source scans on an
 * INVENTED statement in the Faysal format (scripts/fixtures/
 * faysal-statement-invented.xls). Nothing touches a database.
 *
 *   npm run test:bankstatement
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  allocatePayproFees,
  amountOf,
  cellText,
  classifyRow,
  contraMobile,
  decideStatementCredit,
  descriptionFacts,
  feeAmounts,
  fuzzyNamesMatch,
  importSummary,
  masked,
  matchFeeCredits,
  parseStatement,
  reopenProblem,
  resultLists,
  settlementUnits,
  suggestPersonal,
  undoDecisionProblem,
  type ApprovedBankPayment,
  type FeeCredit,
  type MatchMember,
  type ParsedStatement,
  type PendingReceipt,
} from '../lib/bankStatementCore'
import { summarise, type FinancePayment } from '../lib/financeCore'
import { buildSettlement } from '../lib/payproSettlementCore'
import { staffReceiptDecision } from '../lib/staffReceiptCore'
import { roleMayWrite, roleSatisfies, SCREEN_ACCESS, type AdminRole } from '../lib/adminAccessCore'

const read = (f: string) => readFileSync(f, 'utf8')
const FIXTURE = read('scripts/fixtures/faysal-statement-invented.xls')
const RANGE = { min: 199, max: 210 }
const FEES = feeAmounts([499, 999])

function parsed(): ParsedStatement {
  const p = parseStatement(FIXTURE)
  assert.ok(!('error' in p), 'the invented statement parses')
  return p as ParsedStatement
}

// ---------------------------------------------------------------- parsing
test('cells: ="…" wrappers, entities, commas and spaces', () => {
  assert.equal(cellText('="10,199.00"'), '10,199.00')
  assert.equal(cellText(' ="900000001" '), '900000001')
  assert.equal(cellText('A&amp;B&nbsp;C'), 'A&B C')
  assert.equal(cellText('<b>MPPC</b>'), 'MPPC')
  assert.equal(amountOf('25,000.00'), 25000)
  assert.equal(amountOf(''), 0)
  assert.equal(amountOf('-'), 0)
})

test('parse: header found, opening balance skipped, rows read, repeat in the file kept once', () => {
  const p = parsed()
  assert.equal(p.openingBalance, 10000)
  assert.equal(p.rows.length, 8)
  assert.equal(p.repeatedInFile, 1)
  const first = p.rows[0]
  assert.equal(first.seqNo, '900000001')
  assert.equal(first.date, '2026-11-01')
  assert.equal(first.time, '10:15')
  assert.equal(first.deposit, 199)
  assert.equal(first.balance, 10199)
  assert.equal(p.rows.find((r) => r.seqNo === '900000004')!.deposit, 25000)
  assert.equal(p.rows.find((r) => r.seqNo === '900000005')!.withdrawal, 12500)
  assert.equal(p.rows.find((r) => r.seqNo === '900000006')!.time, '20:45')
})

test('parse: a file that is not the statement is refused in words', () => {
  assert.ok('error' in parseStatement('hello'))
  assert.ok('error' in parseStatement('<table><tr><td>Date</td><td>Amount</td></tr></table>'))
})

test('summary: totals, closing balance check, de-dup on re-import', () => {
  const p = parsed()
  const first = importSummary(p, new Set())
  assert.equal(first.rowsNew, 8)
  assert.equal(first.rowsDuplicate, 1, 'the row repeated in the file')
  assert.equal(first.totalCredits, 27376)
  assert.equal(first.totalDebits, 12500)
  assert.equal(first.closingBalanceFile, 24876)
  assert.equal(first.closingBalanceComputed, 24876)
  assert.equal(first.balanceMatches, true)
  assert.equal(first.periodFrom, '2026-11-01')
  assert.equal(first.periodTo, '2026-11-05')
  // Import again: every row is already saved.
  const again = importSummary(p, new Set(p.rows.map((r) => r.seqNo)))
  assert.equal(again.rowsNew, 0)
  assert.equal(again.rowsDuplicate, 9)
})

test('descriptions: Raast sender, bank, last 4, REF#; CONTRA ACCT; mobile contra', () => {
  const f = descriptionFacts('RAAST FUND RECEIVED FROM ZARA NAQVI - MEEZAN BANK A/C# *4321 - REF# RFT0000001AA')
  assert.equal(f.senderName, 'ZARA NAQVI')
  assert.equal(f.senderBank, 'MEEZAN BANK')
  assert.equal(f.last4, '4321')
  assert.equal(f.raastRef, 'RFT0000001AA')
  assert.equal(descriptionFacts('CONTRA ACCT: 137801949').contra, '137801949')
  assert.equal(contraMobile({ description: 'CONTRA ACCT: 923009998877', transferAccountNo: null }), '923009998877')
  assert.equal(contraMobile({ description: 'CONTRA ACCT: 03009998877', transferAccountNo: null }), '923009998877')
  assert.equal(contraMobile({ description: 'CONTRA ACCT: 137801949', transferAccountNo: null }), null)
  assert.equal(masked('0011223344556677'), '••••6677')
})

// ---------------------------------------------------------- classification
test('classify: fee (199 / 200 / plan price), PayPro, other credit, debit', () => {
  const p = parsed()
  const cls = Object.fromEntries(p.rows.map((r) => [r.seqNo, classifyRow(r, FEES)]))
  assert.equal(cls['900000001'], 'fee')
  assert.equal(cls['900000002'], 'fee', 'Rs 200 is a fee')
  assert.equal(cls['900000003'], 'paypro')
  assert.equal(cls['900000004'], 'other_credit')
  assert.equal(cls['900000005'], 'debit')
  assert.equal(cls['900000007'], 'other_credit')
  assert.equal(classifyRow({ description: 'RAAST FUND RECEIVED FROM X Y - HBL A/C# *1 - REF# A1B2C3D4', withdrawal: 0, deposit: 999, transferAccountNo: null }, FEES), 'fee', 'a plan price')
  assert.equal(suggestPersonal({ deposit: 25000, type: 'IBFC' }, 'other_credit'), true)
  assert.equal(suggestPersonal({ deposit: 1000, type: 'CQCC' }, 'other_credit'), true, 'a cheque deposit')
  assert.equal(suggestPersonal({ deposit: 199, type: 'MPPC' }, 'fee'), false, 'never a fee')
})

// --------------------------------------------- the same money, recorded once
test('statement credit vs recorded credits: reference, amount + day, unclear', () => {
  const row = { reference: 'RFT0000001AA', stan: '111111', description: 'RAAST FUND RECEIVED FROM ZARA NAQVI - MEEZAN BANK A/C# *4321 - REF# RFT0000001AA', deposit: 199, date: '2026-11-01', time: '10:15', sender: 'ZARA NAQVI' }
  const rec = (id: string, extra: Record<string, unknown> = {}) => ({ id, reference: null, amountPkr: 199, date: '2026-11-01', time: null, senderName: null, source: 'manual', statementRowId: null, ...extra })
  assert.deepEqual(decideStatementCredit(row, [rec('a', { reference: 'rft0000001aa' })]), { action: 'link', creditId: 'a', how: 'reference' })
  assert.deepEqual(decideStatementCredit(row, [rec('a', { time: '10:20', senderName: 'Zara Naqvi' })]), { action: 'link', creditId: 'a', how: 'amount_day' })
  assert.equal(decideStatementCredit(row, [rec('a'), rec('b')]).action, 'unclear')
  assert.equal(decideStatementCredit(row, [rec('a', { senderName: 'Someone Else Entirely' })]).action, 'add', 'a different sender')
  assert.equal(decideStatementCredit(row, [rec('a', { statementRowId: 'other' })]).action, 'add', 'already another row')
  assert.equal(decideStatementCredit(row, []).action, 'add')
})

// ----------------------------------------------------------------- matching
const credit = (rowId: string, date: string, amount: number, senderName: string | null, extra: Partial<FeeCredit> = {}): FeeCredit => ({
  rowId, transferId: `t-${rowId}`, date, time: '12:00', amount, senderName, refs: [], mobile: null, settled: false, ...extra,
})
const receipt = (id: string, memberId: string, memberName: string, createdAt: string, extra: Partial<PendingReceipt> = {}): PendingReceipt => ({
  id, memberId, memberName, planCode: 'verified', amount: 199, createdAt, reference: null, ...extra,
})
const member = (id: string, names: string[], extra: Partial<MatchMember> = {}): MatchMember => ({ id, names, mobiles: [], createdAt: '2026-10-25T00:00:00Z', feePaid: false, ...extra })

test('match (a): Raast name + amount + date to a pending receipt, Rs 200 accepted', () => {
  const m = matchFeeCredits({
    credits: [credit('r1', '2026-11-01', 200, 'ZARA NAQVI')],
    receipts: [receipt('p1', 'm1', 'Zara Naqvi', '2026-10-30T09:00:00Z')],
    approved: [],
    members: [member('m1', ['Zara Naqvi'])],
    range: RANGE,
  })
  assert.deepEqual(m.get('r1'), { kind: 'receipt', paymentId: 'p1', reason: 'Raast name + amount + date' })
})

test('match (a): outside ±3 days is not the receipt', () => {
  const m = matchFeeCredits({
    credits: [credit('r1', '2026-11-10', 199, 'ZARA NAQVI')],
    receipts: [receipt('p1', 'm1', 'Zara Naqvi', '2026-11-01T09:00:00Z')],
    approved: [],
    members: [member('m1', ['Zara Naqvi'], { feePaid: true })],
    range: RANGE,
  })
  assert.equal(m.get('r1')?.kind, 'unmatched')
})

test('match (a): the uploaded reference + amount + date', () => {
  const m = matchFeeCredits({
    credits: [credit('r1', '2026-11-01', 199, 'SOMEONE PAYING FOR THEM', { refs: ['RFT0000001AA'] })],
    receipts: [receipt('p1', 'm1', 'Zara Naqvi', '2026-11-01T09:00:00Z', { reference: 'RFT0000001AA' })],
    approved: [],
    members: [],
    range: RANGE,
  })
  assert.deepEqual(m.get('r1'), { kind: 'receipt', paymentId: 'p1', reason: 'Reference + amount + date' })
})

test('match (b): the mobile contra (92 / 0 forms) → paid in bank, not recorded', () => {
  const m = matchFeeCredits({
    credits: [credit('r2', '2026-11-01', 200, 'EASYPAISA WALLET', { mobile: '923009998877' })],
    receipts: [],
    approved: [],
    members: [member('m2', ['Hamza Raza'], { mobiles: ['923009998877'] })],
    range: RANGE,
  })
  assert.deepEqual(m.get('r2'), { kind: 'member', memberId: 'm2', reason: 'Mobile number' })
})

test('match (b): the mobile contra with that member’s receipt waiting → Bank-matched', () => {
  const m = matchFeeCredits({
    credits: [credit('r2', '2026-11-01', 200, 'EASYPAISA WALLET', { mobile: '923009998877' })],
    receipts: [receipt('p2', 'm2', 'Hamza Raza', '2026-11-01T06:00:00Z')],
    approved: [],
    members: [member('m2', ['Hamza Raza'], { mobiles: ['923009998877'] })],
    range: RANGE,
  })
  assert.deepEqual(m.get('r2'), { kind: 'receipt', paymentId: 'p2', reason: 'Mobile number + amount + date' })
})

test('match (c): a close spelling of the name, within the time window', () => {
  assert.equal(fuzzyNamesMatch('MOHD SHAHEED IQBAAL', 'Muhammad Shahid Iqbal'), true)
  assert.equal(fuzzyNamesMatch('ZARA NAQVI', 'Sara Ahmed'), false)
  const m = matchFeeCredits({
    credits: [credit('r6', '2026-11-04', 199, 'MOHD SHAHEED IQBAAL')],
    receipts: [],
    approved: [],
    members: [member('m6', ['Muhammad Shahid Iqbal']), member('m7', ['Ayesha Khan'])],
    range: RANGE,
  })
  assert.deepEqual(m.get('r6'), { kind: 'member', memberId: 'm6', reason: 'Name (close spelling)' })
  // A member who signed up after the money arrived is not a match.
  const late = matchFeeCredits({
    credits: [credit('r6', '2026-11-04', 199, 'MOHD SHAHEED IQBAAL')],
    receipts: [],
    approved: [],
    members: [member('m6', ['Muhammad Shahid Iqbal'], { createdAt: '2026-11-20T00:00:00Z' })],
    range: RANGE,
  })
  assert.equal(late.get('r6')?.kind, 'unmatched')
})

test('match: two similar members → unmatched with a note; a paid member is not offered', () => {
  const m = matchFeeCredits({
    credits: [credit('r8', '2026-11-05', 199, 'ALI RAZA')],
    receipts: [],
    approved: [],
    members: [member('a', ['Ali Raza']), member('b', ['Ali Raza'])],
    range: RANGE,
  })
  assert.deepEqual(m.get('r8'), { kind: 'unmatched', note: '2 members have a similar name' })
  const paid = matchFeeCredits({ credits: [credit('r8', '2026-11-05', 199, 'ALI RAZA')], receipts: [], approved: [], members: [member('a', ['Ali Raza'], { feePaid: true })], range: RANGE })
  assert.equal(paid.get('r8')?.kind, 'unmatched')
})

test('match: a settled credit is left alone; one receipt is never claimed twice', () => {
  const m = matchFeeCredits({
    credits: [credit('x', '2026-11-01', 199, 'ZARA NAQVI', { settled: true }), credit('y', '2026-11-01', 199, 'ZARA NAQVI'), credit('z', '2026-11-01', 199, 'ZARA NAQVI')],
    receipts: [receipt('p1', 'm1', 'Zara Naqvi', '2026-11-01T06:00:00Z')],
    approved: [],
    members: [member('m1', ['Zara Naqvi'], { feePaid: true })],
    range: RANGE,
  })
  assert.equal(m.get('x')?.kind, 'settled')
  assert.equal(m.get('y')?.kind, 'receipt')
  assert.equal(m.get('z')?.kind, 'unmatched')
})

test('the four result lists', () => {
  const approved: ApprovedBankPayment[] = [
    { id: 'ap1', memberId: 'm9', memberName: 'Bilal Shah', planCode: 'verified', amount: 199, approvedAt: '2026-11-02T10:00:00Z', hasCredit: false },
    { id: 'ap2', memberId: 'm10', memberName: 'Hina Tariq', planCode: 'verified', amount: 199, approvedAt: '2026-11-03T10:00:00Z', hasCredit: false },
    { id: 'ap3', memberId: 'm11', memberName: 'Old Payment', planCode: 'verified', amount: 199, approvedAt: '2026-09-01T10:00:00Z', hasCredit: false },
    { id: 'ap4', memberId: 'm12', memberName: 'Linked Already', planCode: 'verified', amount: 199, approvedAt: '2026-11-03T10:00:00Z', hasCredit: true },
  ]
  const matches = matchFeeCredits({
    credits: [
      credit('r1', '2026-11-01', 199, 'ZARA NAQVI'),
      credit('r2', '2026-11-01', 200, 'EASYPAISA WALLET', { mobile: '923009998877' }),
      credit('r3', '2026-11-02', 199, 'BILAL SHAH'),
      credit('r8', '2026-11-05', 199, 'NOBODY KNOWN'),
    ],
    receipts: [receipt('p1', 'm1', 'Zara Naqvi', '2026-11-01T06:00:00Z')],
    approved,
    members: [member('m2', ['Hamza Raza'], { mobiles: ['923009998877'] })],
    range: RANGE,
  })
  const lists = resultLists(matches, approved, { from: '2026-11-01', to: '2026-11-05' })
  assert.deepEqual(lists.bankMatched.map((x) => x.paymentId), ['p1'])
  assert.deepEqual(lists.paidNotRecorded.map((x) => x.memberId), ['m2'])
  assert.deepEqual(lists.unmatched.map((x) => x.rowId), ['r8'])
  assert.deepEqual(lists.approvedNoCredit.map((x) => x.paymentId), ['ap1', 'ap2'], 'inside the dates, no credit')
  assert.equal(lists.approvedNoCredit[0].suggestion?.rowId, 'r3', 'the likely credit')
  assert.equal(lists.approvedNoCredit[1].suggestion, null)
})

// ------------------------------------------------------- personal exclusion
test('personal: an excluded credit leaves Due from PayPro at Rs 0, not −10,000', () => {
  const payments: FinancePayment[] = []
  const tenK = { gateway: 'paypro', transferredOn: '2026-09-17', amountPkr: 10000 }
  const counted = summarise({ payments, transfers: [tenK], deductions: [], nowIso: '2026-09-30T10:00:00Z' })
  assert.equal(counted.months.find((m) => m.month === '2026-09')!.dueFromPaypro, -10000)
  // Marked personal: lib/ignoredCredits drops it before it reaches the totals.
  const excluded = summarise({ payments, transfers: [], deductions: [], nowIso: '2026-09-30T10:00:00Z', personal: [{ month: '2026-09', count: 1, amount: 10000 }] })
  const sep = excluded.months.find((m) => m.month === '2026-09')!
  assert.equal(sep.dueFromPaypro, 0)
  assert.deepEqual(sep.personal, { count: 1, amount: 10000 }, 'the grey "Personal, excluded" line')
})

test('personal on a statement row marks its bank credit too, and Undo undoes both (source)', () => {
  const src = read('lib/bankStatement.ts')
  assert.match(src, /markRowPersonal[\s\S]*?markPersonal\(\{ transferId: row\.transfer_id/)
  assert.match(src, /undoRowPersonal[\s\S]*?undoPersonal\(\{ transferId: row\.transfer_id \}/)
  assert.match(src, /personal_undone_at/)
  assert.doesNotMatch(src, /\.delete\(/, 'nothing is deleted')
  // The bank-credit mark is what every total reads.
  assert.match(read('lib/ignoredCredits.ts'), /personal_at/)
})

// ------------------------------------------------------------ PayPro's fee
test('PayPro: N × 193 = N payments of Rs 199, Rs 6 each; a Rs 1 bank charge still reads', () => {
  assert.deepEqual(settlementUnits(193), { units: 1, unit: 193, fee: 6, bankCharge: 0 })
  assert.deepEqual(settlementUnits(579), { units: 3, unit: 193, fee: 6, bankCharge: 0 })
  assert.deepEqual(settlementUnits(578), { units: 3, unit: 193, fee: 6, bankCharge: 1 })
  assert.equal(settlementUnits(10000), null, 'not a settlement of Rs 199 payments')
})

test('PayPro: settlements allocated to payments by date and count; the rest at the usual fee', () => {
  const pays = [
    { id: 'a', paidAt: '2026-10-01T05:00:00Z', gross: 199 },
    { id: 'b', paidAt: '2026-10-01T06:00:00Z', gross: 199 },
    { id: 'c', paidAt: '2026-10-02T06:00:00Z', gross: 199 },
    { id: 'd', paidAt: '2026-10-09T06:00:00Z', gross: 199 },
  ]
  const a = allocatePayproFees(pays, [{ id: 's1', date: '2026-10-03', amount: 386 }, { id: 's2', date: '2026-10-04', amount: 193 }])
  assert.equal(a.settledBy.get('a'), 's1')
  assert.equal(a.settledBy.get('b'), 's1')
  assert.equal(a.settledBy.get('c'), 's2')
  assert.equal(a.settledBy.has('d'), false, 'paid after every settlement')
  assert.equal(a.feeBy.get('d'), 6, 'the usual fee')
  assert.deepEqual([...a.feeBy.values()], [6, 6, 6, 6])
  // The settlement report: the real fee wins over a "negative fee" export row.
  const report = buildSettlement(
    pays.map((p) => ({ id: p.id, ref: p.id, paidAt: p.paidAt, member: '', gross: p.gross, exportAmount: 199, exportShare: 203, refundedPkr: 0, refundedAt: null })),
    [{ id: 's1', date: '2026-10-03', amount: 386 }, { id: 's2', date: '2026-10-04', amount: 193 }],
    new Map(),
    new Date('2026-10-20T00:00:00Z'),
    a.feeBy,
  )
  assert.equal(report.fees, 24)
  assert.equal(report.netExpected, 772)
  assert.equal(report.received, 579)
  assert.equal(report.pending, 193, 'PayPro still owes payment d')
  assert.equal(report.checkCount, 0)
})

test('Finance month table: PayPro deductions are Rs 6 a payment from the settlements (source)', () => {
  assert.match(read('lib/finance.ts'), /loadPayproFeeAllocation/)
  assert.match(read('lib/payproSettlement.ts'), /loadPayproFeeAllocation/)
  const fees = read('lib/payproFees.ts')
  assert.match(fees, /ignoredCreditIds/, 'personal / ignored credits are not settlements')
  assert.match(fees, /\/paypro\/i/, 'only credits from PayPro')
  assert.doesNotMatch(fees, /\.update\(|\.insert\(/, 'stored payments are never edited')
})

// ---------------------------------------------------------- Reopen and Undo
test('reopen: a rejected bank receipt, with a reason', () => {
  assert.equal(reopenProblem({ status: 'rejected', provider: 'manual' }, 'Bank confirmed the money'), null)
  assert.equal(reopenProblem({ status: 'rejected', provider: 'manual' }, 'ok')?.status, 400)
  assert.equal(reopenProblem({ status: 'approved', provider: 'manual' }, 'reason here')?.status, 409)
  assert.equal(reopenProblem({ status: 'rejected', provider: 'paypro' }, 'reason here')?.status, 400)
  assert.equal(reopenProblem(null, 'reason here')?.status, 404)
})

test('undo: only the person who decided, straight after', () => {
  const now = Date.parse('2026-11-17T10:00:30Z')
  const p = { status: 'approved', reviewedAt: '2026-11-17T10:00:25Z', reviewedBy: 'owner', provider: 'manual' }
  assert.equal(undoDecisionProblem(p, 'owner', now), null)
  assert.equal(undoDecisionProblem({ ...p, status: 'rejected' }, 'owner', now), null)
  assert.equal(undoDecisionProblem(p, 'someone-else', now)?.status, 403)
  assert.equal(undoDecisionProblem({ ...p, reviewedAt: '2026-11-17T09:00:00Z' }, 'owner', now)?.status, 409)
  assert.equal(undoDecisionProblem({ ...p, status: 'pending' }, 'owner', now)?.status, 409)
  const src = read('lib/paymentDecisionUndo.ts')
  assert.match(src, /removed_at: at/, 'the credit link is soft-removed')
  assert.match(src, /verified_fee_paid_at: null/, 'the badge goes with an undone approval')
  assert.doesNotMatch(src, /\.delete\(/)
  // Both buttons offer a 10-second Undo.
  assert.match(read('app/admin/payments/PaymentDecide.tsx'), /ms: 10_000/)
  assert.match(read('app/admin/payments/StaffReceiptActions.tsx'), /ms: 10_000/)
})

// ---------------------------------------------------------- who may do what
test('access: statement and Finance are Owner only; the Partner views', () => {
  assert.deepEqual(SCREEN_ACCESS.finance, [])
  const roles: AdminRole[] = ['admin', 'operations', 'tuitions_staff', 'backend_support', 'supervisor']
  for (const r of roles) assert.equal(roleSatisfies(r, SCREEN_ACCESS.finance), false, `${r} cannot open Finance`)
  assert.equal(roleSatisfies('partner', SCREEN_ACCESS.finance), true)
  assert.equal(roleMayWrite('partner', SCREEN_ACCESS.finance), false, 'the Partner may not import or change')
  const route = read('app/api/admin/finance/statement/route.ts')
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.finance\)/)
  assert.match(route, /refuseUnlessOwnerApproval/)
  const reopen = read('app/api/admin/payments/reopen/route.ts')
  assert.match(reopen, /refuseUnlessOwnerApproval/)
  assert.match(reopen, /requireFreshAuth/)
  assert.match(read('app/admin/finance/statement/page.tsx'), /requireAdminRole\(\.\.\.SCREEN_ACCESS\.finance\)/)
  // Approving a receipt with no matching bank credit stays with the Owner.
  const d = staffReceiptDecision({
    payment: { status: 'pending', provider: 'manual', planCode: 'verified', createdAt: '2026-11-01T06:00:00Z', memberId: 'm', memberName: 'Zara Naqvi' },
    credits: [],
    range: RANGE,
    creditedToActor: false,
    alreadyPaid: false,
    refundOpen: false,
    statementCreditId: 'gone',
  })
  assert.equal(d.ok, false)
})

test('bank-matched: staff approve in one click only with that free credit', () => {
  const base = {
    payment: { status: 'pending', provider: 'manual', planCode: 'verified', createdAt: '2026-10-01T06:00:00Z', memberId: 'm', memberName: 'Hamza Raza' },
    credits: [{ id: 't1', date: '2026-10-09', time: null, amountPkr: 200, senderName: 'EASYPAISA WALLET', isPaypro: false }],
    range: RANGE,
    creditedToActor: false,
    alreadyPaid: false,
    refundOpen: false,
  }
  assert.equal(staffReceiptDecision(base).ok, false, 'no name, outside 48 hours')
  assert.deepEqual(staffReceiptDecision({ ...base, statementCreditId: 't1' }), { ok: true, creditId: 't1' })
  assert.equal(staffReceiptDecision({ ...base, statementCreditId: 't1', creditedToActor: true }).ok, false, 'never their own referral')
})

test('Backend Support sees no rupees: the Bank-matched words carry no amount', () => {
  const reasons = ['Raast name + amount + date', 'Reference + amount + date', 'Mobile number + amount + date', 'Mobile number', 'Name (close spelling) + amount + date', 'Name (close spelling)']
  for (const r of reasons) assert.doesNotMatch(r, /\d|Rs/)
  const src = read('lib/bankStatement.ts')
  assert.match(src, /select\('match_payment_id, match_reason'\)/, 'only the payment id and the words leave the statement table for Payments')
  const queue = read('app/admin/payments/PaymentQueue.tsx')
  assert.match(queue, /Bank-matched · \{p\.bankMatch\}/)
  assert.ok(SCREEN_ACCESS.paymentAmounts.every((r) => r !== 'backend_support'))
})

test('privacy: the statement table is service-role only; nothing logs a number', () => {
  const sql = read('supabase/migrations/233_bank_statement_import.sql')
  assert.match(sql, /revoke all on public\.bank_statement_rows from anon, authenticated/)
  assert.doesNotMatch(sql, /create policy[^;]*bank_statement_rows/i)
  const src = read('lib/bankStatement.ts')
  assert.doesNotMatch(src, /console\.(log|info|warn|error)/)
  assert.match(src, /field: 'account'/, 'a reveal is logged without the value')
  assert.ok(read('.gitignore').includes('*.xls'), 'a real statement file is never committed')
})
