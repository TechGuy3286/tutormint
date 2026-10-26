/**
 * scripts/test-finance-items.ts  —  npm run test:financeitems
 *
 * The simpler Finance page (owner, 21 Oct 2026): every money item of the month
 * is in exactly one of the two filters (Needs attention · All good ✅) with a
 * plain label; the three cards; one "Link" per bank credit that keeps the
 * Owner-only rule and the password re-check; "Ignore (not a sale)" in the ⋯
 * menu; one "+ Add"; "Show details" closed by default; old addresses redirect.
 * Pure logic + source scans.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { financeCards, financeCounts, financeItems, pickFinanceGroup } from '../lib/financeItemsCore'
import { financeHref, isLegacyFinanceQuery } from '../lib/financeTabsCore'
import { SCREEN_ACCESS } from '../lib/adminAccessCore'
import type { CreditView, MonthView, OrderView, ReceiptView } from '../lib/settlementMatchCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Source without comments, so a note about an old button is not a button. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const credit = (id: string, state: CreditView['state'], status?: 'matched' | 'amount_mismatch' | 'manual'): CreditView => ({
  id,
  date: '2026-10-10',
  time: null,
  amountPkr: 199,
  senderName: null,
  senderBank: null,
  reference: `R${id}`,
  note: null,
  isPaypro: false,
  state,
  match: status ? { creditId: id, status, orders: [], receipts: [], expected: 199, difference: 0, how: 'x', note: null } : null,
  ignoreNote: null,
})
const order = (n: string, state: OrderView['state'], flags: OrderView['flags'] = []): OrderView => ({
  orderNumber: n,
  transactionStatus: 'PAID',
  method: 'JazzCash',
  channel: 'jazzcash',
  orderAmount: 199,
  merchantShare: 193,
  fee: 6,
  datePaid: '2026-10-09',
  settleDate: null,
  settleStatus: null,
  state,
  creditId: null,
  ageDays: 2,
  overdue: false,
  flags,
  ourAmount: 199,
})
const receipt = (id: string, state: ReceiptView['state']): ReceiptView => ({
  id,
  ref: `TM-${id}`,
  amountPkr: 199,
  approvedDay: '2026-10-08',
  transactionId: null,
  payerName: null,
  state,
  creditId: null,
  ageDays: 3,
  overdue: false,
})

const VIEW: MonthView = {
  month: '2026-10',
  cards: { received: 1194, fees: 12, netSettled: 199, waiting: 386, unmatched: 4 },
  attention: [{ kind: 'not_in_export', icon: '⚠️', title: 'In TutorMint, not in the PayPro export: TM-9', detail: 'Rs 199', day: '2026-10-07', red: true }],
  matched: [],
  orders: [order('O1', 'matched'), order('O2', 'waiting'), order('O3', 'settled_no_credit'), order('O4', 'not_paid'), order('O5', 'matched', ['amount_differs']), order('O6', 'waiting', ['not_approved'])],
  receipts: [receipt('r1', 'matched'), receipt('r2', 'waiting')],
  credits: [credit('c1', 'matched', 'matched'), credit('c2', 'unmatched'), credit('c3', 'held'), credit('c4', 'ignored'), credit('c5', 'matched', 'amount_mismatch')],
  feeTable: [],
}

test('every item is in exactly one filter', () => {
  const items = financeItems(VIEW)
  const expected = VIEW.credits.length + VIEW.orders.length + VIEW.receipts.length + 1
  assert.equal(items.length, expected, 'one row per credit, order, receipt and missing payment')
  assert.equal(new Set(items.map((i) => i.key)).size, items.length, 'no item twice')
  const c = financeCounts(items)
  assert.equal(c.attention + c.good, items.length)
  for (const i of items) assert.ok(i.group === 'attention' || i.group === 'good')
})

test('Needs attention: unmatched credits, approved payments with no bank credit, paid-not-settled orders', () => {
  const by = new Map(financeItems(VIEW).map((i) => [i.key, i]))
  const g = (k: string) => by.get(k)!.group
  assert.equal(g('credit:c2'), 'attention')
  assert.equal(by.get('credit:c2')!.label, 'Money in the bank, not linked yet')
  assert.equal(g('credit:c3'), 'attention')
  assert.equal(g('credit:c5'), 'attention', 'an amount mismatch')
  assert.equal(g('order:O2'), 'attention')
  assert.equal(by.get('order:O2')!.label, 'Paid, waiting for the bank (2 days)')
  assert.equal(g('order:O3'), 'attention')
  assert.equal(g('order:O5'), 'attention', 'amount differs')
  assert.equal(by.get('order:O6')!.label, 'Paid at PayPro, not approved on TutorMint · Paid, waiting for the bank (2 days)')
  assert.equal(g('receipt:r2'), 'attention')
  assert.equal(by.get('receipt:r2')!.label, 'Bank transfer approved, no bank credit yet (3 days)')
  assert.equal(g('missing:TM-9'), 'attention')
  // All good.
  assert.equal(g('credit:c1'), 'good')
  assert.equal(g('credit:c4'), 'good', 'ignored (not a sale)')
  assert.equal(g('order:O1'), 'good')
  assert.equal(g('order:O4'), 'good')
  assert.equal(g('receipt:r1'), 'good')
  assert.deepEqual(financeCounts(financeItems(VIEW)), { attention: 9, good: 5 })
})

test('three cards; the default filter; the numbers come from the settlement view', () => {
  const items = financeItems(VIEW)
  assert.deepEqual(financeCards(VIEW, items), { received: 1194, inBank: 199, attention: 9 })
  assert.equal(pickFinanceGroup(undefined, { attention: 2, good: 1 }), 'attention')
  assert.equal(pickFinanceGroup(undefined, { attention: 0, good: 5 }), 'good')
  assert.equal(pickFinanceGroup('good', { attention: 2, good: 1 }), 'good')
  // Layout only: the matching rules are not touched.
  assert.ok(read('app/admin/finance/settlement/SettlementTab.tsx').includes('items={financeItems(board.view, alerts)}'))
})

test('"Link" replaces both old buttons and keeps Owner-only and the password re-check', () => {
  const board = code('app/admin/finance/settlement/SettlementsBoard.tsx')
  assert.ok(!board.includes('Link by hand'))
  assert.ok(!board.includes('Link to member'))
  assert.ok(board.includes("{c.state === 'matched' ? 'Change link' : 'Link'}"))
  assert.ok(board.includes('<LinkBankCredit'), 'a member opens the same record-a-bank-payment form')
  assert.ok(board.includes("'/api/admin/payments/settlement/links'"), 'orders and payments use the same link route')
  // Ignore lives in the ⋯ menu.
  assert.ok(board.includes('aria-label="More actions"'))
  assert.ok(board.includes('Ignore (not a sale)'))
  // The routes are unchanged: Owner only, and the member path asks for the password.
  assert.deepEqual(SCREEN_ACCESS.finance, [])
  assert.ok(read('app/api/admin/payments/settlement/links/route.ts').includes('checkAdminRole(...SCREEN_ACCESS.finance)'))
  const bank = read('app/api/admin/payments/bank-link/route.ts')
  assert.ok(bank.includes('refuseUnlessOwnerApproval(gate.actor'))
  assert.ok(bank.includes('requireFreshAuth(gate.actor.id)'))
  const link = read('components/admin/LinkBankCredit.tsx')
  assert.ok(link.includes('if (!canApprove) return null'), 'only the Owner sees the form')
})

test('one + Add, details closed by default, old addresses redirect', () => {
  const board = read('app/admin/finance/settlement/SettlementsBoard.tsx')
  assert.ok(board.includes('Add bank credit') && board.includes('Upload PayPro export'))
  assert.equal((board.match(/<AddBankCredits/g) ?? []).length, 1)
  assert.ok(board.includes('<details open={detailsOpen}'))
  assert.ok(board.includes('Show details'))
  assert.ok(board.includes('Export CSV'))
  assert.ok(read('app/admin/finance/settlement/SettlementTab.tsx').includes("detailsOpen={ranged || sp.show === 'details'}"))
  assert.equal(financeHref({ tab: 'settlement', month: '2026-09' }), '/admin/finance?month=2026-09')
  assert.equal(financeHref({ tab: 'finance' }), '/admin/finance')
  assert.equal(isLegacyFinanceQuery({ tab: 'finance' }), true)
  assert.ok(read('app/admin/finance/page.tsx').includes('if (isLegacyFinanceQuery(sp)) redirect(financeHref(sp))'))
  assert.ok(read('app/admin/finance/settlement/page.tsx').includes('redirect(financeHref(await searchParams))'))
})
