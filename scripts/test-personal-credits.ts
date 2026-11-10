/**
 * scripts/test-personal-credits.ts — "Not business (personal)" on a bank credit
 * and the corrected PayPro deductions in Finance → Month by month (owner,
 * 10 Nov 2026). Pure rules plus source scans with INVENTED data; nothing
 * touches a database.
 *
 *   npm run test:personalcredits
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { summarise, type FinancePayment, type FinanceTransfer } from '../lib/financeCore'
import { buildBoard, withoutIgnored, type Credit } from '../lib/settlementMatchCore'
import { buildSettlement, feeFor, splitPayouts, typicalFees } from '../lib/payproSettlementCore'
import { personalByMonth, personalMarkProblem, personalMonthLine, personalUndoProblem } from '../lib/personalCreditCore'
import { canApprove, roleMayWrite, roleSatisfies, SCREEN_ACCESS, type AdminRole } from '../lib/adminAccessCore'

const read = (f: string) => readFileSync(f, 'utf8')
const NOW = '2026-11-10T09:00:00Z'

// ---- invented data -------------------------------------------------------
const pay = (id: string, approvedAt: string, amount: number, provider: 'paypro' | 'manual', extra: Partial<FinancePayment> = {}): FinancePayment => ({
  id,
  ref: `TM-TEST-${id}`,
  userId: `u-${id}`,
  planCode: 'verified',
  audience: 'tutor',
  amountPkr: amount,
  refundedAmountPkr: null,
  refundedAt: null,
  approvedAt,
  provider,
  method: provider === 'paypro' ? 'JazzCash' : 'Bank transfer',
  note: null,
  ...extra,
})

const personalCredit: Credit = {
  id: 'p1',
  date: '2026-09-17',
  time: null,
  amountPkr: 10000,
  senderName: 'Invented Person',
  senderBank: 'Invented Bank',
  reference: 'INV-1',
  note: null,
  isPaypro: true,
  personal: { at: '2026-11-10T08:00:00Z', byName: 'Owner Name', note: 'my own transfer' },
}
const payout: Credit = { ...personalCredit, id: 'c2', date: '2026-10-09', amountPkr: 386, senderName: 'PAYPRO PVT LTD', personal: null }

/** The rule lib/ignoredCredits applies: a personal credit's id is set aside. */
const ignoredIds = (credits: Credit[]) => new Set(credits.filter((c) => c.personal).map((c) => c.id))
const toTransfers = (credits: Credit[]): FinanceTransfer[] =>
  credits.map((c) => ({ gateway: c.isPaypro ? 'paypro' : 'manual', transferredOn: c.date, amountPkr: c.amountPkr }))

test('a personal entry is out of Received in bank, Due from PayPro and every total; Undo restores it', () => {
  const payments = [pay('a', '2026-10-09T05:00:00Z', 199, 'paypro'), pay('b', '2026-10-09T06:00:00Z', 199, 'paypro')]
  const credits = [personalCredit, payout]
  const marked = summarise({
    payments,
    transfers: toTransfers(withoutIgnored(credits, ignoredIds(credits))),
    deductions: [],
    nowIso: NOW,
    personal: personalByMonth([{ id: 'p1', date: '2026-09-17', amountPkr: 10000, note: 'my own transfer', byName: 'Owner Name', markedAt: NOW }]),
  })
  const sep = marked.months.find((m) => m.month === '2026-09')!
  assert.equal(sep.receivedInBank, 0)
  assert.equal(sep.dueFromPaypro, 0)
  assert.deepEqual(sep.personal, { count: 1, amount: 10000 }, 'the grey line still lists it')
  assert.equal(personalMonthLine(sep.personal!), 'Personal, excluded: Rs 10,000 (1 entry)')
  assert.equal(marked.totals.allTime.amount, 398, 'revenue never counts a bank credit')

  // The settlement board sets it aside: never matched, not unmatched, out of the CSV.
  const board = buildBoard({ rows: [], credits, ourPaypro: [], receipts: [], links: [], nowIso: NOW })
  const pv = board.credits.find((c) => c.id === 'p1')!
  assert.equal(pv.state, 'ignored')
  assert.equal(pv.ignoreKind, 'personal')
  assert.equal(pv.ignoreNote, 'my own transfer')

  // PayPro settlement never sees it.
  const live = withoutIgnored(credits, ignoredIds(credits))
  const { payouts, notFromPaypro } = splitPayouts(live.map((c) => ({ id: c.id, date: c.date, amount: c.amountPkr, sender: c.senderName })))
  assert.deepEqual(payouts.map((p) => p.id), ['c2'])
  assert.equal(notFromPaypro.length, 0)

  // Undo: the same credit without the mark counts again.
  const undone = credits.map((c) => (c.id === 'p1' ? { ...c, personal: null } : c))
  const back = summarise({ payments, transfers: toTransfers(withoutIgnored(undone, ignoredIds(undone))), deductions: [], nowIso: NOW })
  const sep2 = back.months.find((m) => m.month === '2026-09')!
  assert.equal(sep2.receivedInBank, 10000)
  assert.equal(sep2.dueFromPaypro, -10000)
  assert.equal(sep2.personal, null)
  assert.equal(buildBoard({ rows: [], credits: undone, ourPaypro: [], receipts: [], links: [], nowIso: NOW }).credits.find((c) => c.id === 'p1')!.state, 'unmatched')
})

test('the stored mark is read everywhere money is added up', () => {
  assert.ok(read('lib/ignoredCredits.ts').includes("not('personal_at', 'is', null)"))
  assert.ok(read('lib/settlementMatch.ts').includes('personal_at'))
  for (const f of ['lib/finance.ts', 'lib/payproSettlement.ts', 'lib/settlement.ts']) assert.ok(read(f).includes('ignoredCreditIds'), f)
})

test('mark needs a note; mark twice and undo an unmarked entry are refused', () => {
  assert.equal(personalMarkProblem({ personalAt: null }, 'x')?.status, 400)
  assert.equal(personalMarkProblem({ personalAt: null }, 'own money'), null)
  assert.equal(personalMarkProblem({ personalAt: NOW }, 'own money')?.status, 409)
  assert.equal(personalMarkProblem(null, 'own money')?.status, 404)
  assert.equal(personalUndoProblem({ personalAt: null })?.status, 409)
  assert.equal(personalUndoProblem({ personalAt: NOW }), null)
  // Nothing is deleted: undo clears the mark and stamps when.
  const io = read('lib/personalCredits.ts')
  assert.ok(io.includes('personal_undone_at'))
  assert.ok(!/\.delete\(/.test(io))
  assert.ok(io.includes("action: 'settlement.personal'") && io.includes("action: 'settlement.personal_undo'"))
})

test('only the Owner sees and uses the button', () => {
  const roles: AdminRole[] = ['owner', 'partner', 'admin', 'operations', 'supervisor', 'tuitions_staff', 'backend_support']
  for (const r of roles) assert.equal(canApprove(r), r === 'owner', r)
  const route = read('app/api/admin/payments/settlement/personal/route.ts')
  assert.ok(route.includes('checkAdminRole(...SCREEN_ACCESS.finance)'))
  assert.ok(route.includes('refuseUnlessOwnerApproval('))
  const board = read('app/admin/finance/settlement/SettlementsBoard.tsx')
  assert.ok(board.includes('const isOwner = useCanApprove()'))
  assert.ok(/isOwner && c\.ignoreKind !== 'personal'/.test(board), 'mark item gated on the Owner')
  assert.ok(/isOwner && c\.ignoreKind === 'personal'/.test(board), 'undo item gated on the Owner')
  const list = read('app/admin/finance/PersonalEntries.tsx')
  assert.ok(list.includes('useCanApprove()') && list.includes('{isOwner && ('))
})

test('Backend Support sees no rupees', () => {
  assert.equal(roleSatisfies('backend_support', [...SCREEN_ACCESS.finance]), false, 'Finance page')
  assert.equal(roleSatisfies('backend_support', [...SCREEN_ACCESS.paymentAmounts]), false, 'payment amounts')
  assert.equal(roleSatisfies('backend_support', [...SCREEN_ACCESS.revenue]), false, 'revenue card')
  // The Partner keeps read access, without the write.
  assert.equal(roleSatisfies('partner', [...SCREEN_ACCESS.finance]), true)
  assert.equal(roleMayWrite('partner', [...SCREEN_ACCESS.finance]), false)
})

test('PayPro deductions use PayPro’s own fee per order (the corrected month math)', () => {
  // Three invented PayPro orders of Rs 199 settled at Rs 193 (fee Rs 6), one
  // with a share above the amount ("Check with PayPro"), and one manual transfer.
  const payments = [
    pay('a', '2026-10-05T05:00:00Z', 199, 'paypro'),
    pay('b', '2026-10-06T05:00:00Z', 199, 'paypro'),
    pay('c', '2026-10-07T05:00:00Z', 199, 'paypro'),
    pay('d', '2026-10-08T05:00:00Z', 199, 'paypro'),
    pay('m', '2026-10-08T06:00:00Z', 199, 'manual'),
  ]
  const exportRows = { 'TM-TEST-a': 193, 'TM-TEST-b': 193, 'TM-TEST-c': 193, 'TM-TEST-d': 200 } as Record<string, number>
  const typical = typicalFees(Object.values(exportRows).map((share) => ({ amount: 199, share })))
  const net = new Map<string, number>()
  for (const p of payments.filter((x) => x.provider === 'paypro')) {
    const f = feeFor({ id: p.id, ref: p.ref!, paidAt: p.approvedAt, member: '', gross: 199, exportAmount: 199, exportShare: exportRows[p.ref!], refundedPkr: 0, refundedAt: null }, typical)
    net.set(p.id, f.net)
  }
  const transfers: FinanceTransfer[] = [{ gateway: 'paypro', transferredOn: '2026-10-09', amountPkr: 386 }]
  const s = summarise({ payments, transfers, deductions: [], nowIso: NOW, payproNet: net })
  const oct = s.months.find((m) => m.month === '2026-10')!
  assert.equal(oct.payproDeductions, 17, '6 + 6 + 6 − 1')
  assert.equal(oct.expectedInBank, 796 - 17 + 199)
  assert.equal(oct.dueFromPaypro, 779 - 386)

  // The same figure as the PayPro settlement report.
  const report = buildSettlement(
    payments.filter((p) => p.provider === 'paypro').map((p) => ({ id: p.id, ref: p.ref!, paidAt: p.approvedAt, member: '', gross: 199, exportAmount: 199, exportShare: exportRows[p.ref!], refundedPkr: 0, refundedAt: null })),
    [{ id: 't', date: '2026-10-09', amount: 386 }],
    typical,
    new Date(NOW),
  )
  assert.equal(report.pending, oct.dueFromPaypro)

  // Before the fix (no per-order fee, no deduction lines) nothing was subtracted.
  const old = summarise({ payments, transfers, deductions: [], nowIso: NOW }).months.find((m) => m.month === '2026-10')!
  assert.equal(old.payproDeductions, 0)
  assert.equal(old.dueFromPaypro, 796 - 386)

  // A payment with no known fee still falls back to the deduction lines.
  const lines = summarise({
    payments: [pay('z', '2026-10-05T05:00:00Z', 100, 'paypro')],
    transfers: [],
    deductions: [{ id: 'l', name: 'Invented fee', percent: 2, fixedPkr: 1, effectiveFrom: '2026-01-01' }],
    nowIso: NOW,
    payproNet: new Map(),
  }).months.find((m) => m.month === '2026-10')!
  assert.equal(lines.payproDeductions, 3)
})
