/**
 * scripts/test-settlements.ts — Settlements (owner, 11 Oct 2026): PayPro payouts
 * and approved bank transfers matched to bank credits. Pure rules plus source
 * scans; nothing touches a database.
 *
 *   npm run test:settlements
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parsePayproCsv, type PayproRow } from '../lib/reconciliationCore'
import {
  buildBoard,
  creditProblem,
  feeOf,
  findSubset,
  isPayproSender,
  monthCsv,
  monthView,
  parseBankAlert,
  payMethod,
  planUpsert,
  type Credit,
  type OurPaypro,
  type Receipt,
} from '../lib/settlementMatchCore'
import { isReadOnlyRole, roleSatisfies, SCREEN_ACCESS } from '../lib/adminAccessCore'

const root = join(__dirname, '..')
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8')
const file = parsePayproCsv(read('scripts', 'fixtures', 'paypro-orders-settled.csv'))
const NOW = '2026-10-11T06:00:00Z'

const credit = (o: Partial<Credit> & { id: string; date: string; amountPkr: number }): Credit => ({
  time: null,
  senderName: 'PAYPRO PRIVATE LIMITED',
  senderBank: null,
  reference: `REF-${o.id}`,
  note: null,
  isPaypro: true,
  ...o,
})
const ours: OurPaypro[] = file
  .filter((r) => r.transactionStatus === 'PAID')
  .map((r) => ({ ref: r.orderNumber, status: 'approved', amountPkr: 199, approvedDay: r.datePaid }))
const board = (credits: Credit[], extra: Partial<Parameters<typeof buildBoard>[0]> = {}) =>
  buildBoard({ rows: file, credits, ourPaypro: ours, receipts: [], links: [], nowIso: NOW, ...extra })

test('the real column layout parses: named columns found among others, totals row skipped, no personal column kept', () => {
  assert.equal(file.length, 6, 'six orders; the totals row has no order number')
  const first = file[0]
  assert.deepEqual(first, {
    orderNumber: 'TM-20261008101500-AAA111',
    transactionStatus: 'PAID',
    paymentVia: 'JazzCash',
    orderAmount: 199,
    merchantShare: 193,
    datePaid: '2026-10-08',
    settleDate: '2026-10-09',
    settleStatus: 'Settled',
  })
  assert.ok(!JSON.stringify(file).includes('03001234567') && !JSON.stringify(file).includes('example.com'))
  assert.equal(payMethod('JazzCash'), 'JazzCash')
  assert.equal(payMethod('EasyPaisa'), 'Easypaisa')
  assert.equal(payMethod('Visa Card'), 'Card')
  assert.equal(feeOf(first), 6, 'JazzCash keeps Rs 6 on a Rs 199 order')
})

test('re-uploading the same or an overlapping export updates orders and never duplicates them', () => {
  const first = planUpsert(file, [], ours.map((o) => o.ref))
  assert.equal(first.newOrders.length, 6)
  assert.equal(first.updatedOrders.length, 0)
  assert.deepEqual(first.unknownOrders, ['TM-20261010093000-FFF666'], 'the unpaid order has no payment of ours')

  const stored = first.rows.map((r) => r.orderNumber)
  const again = planUpsert(file, stored, ours.map((o) => o.ref))
  assert.equal(again.newOrders.length, 0, 'the same file adds nothing')
  assert.equal(again.updatedOrders.length, 6)

  // An overlapping export: two orders already stored (one in another case), one new.
  const overlap: PayproRow[] = [file[0], { ...file[1], orderNumber: file[1].orderNumber.toLowerCase() }, { ...file[0], orderNumber: 'TM-NEW-1' }]
  const third = planUpsert(overlap, stored, [])
  assert.deepEqual(third.newOrders, ['TM-NEW-1'])
  assert.equal(third.updatedOrders.length, 2)

  // The same order twice in one file is one row, and the PAID line wins.
  const twice = planUpsert([{ ...file[0], transactionStatus: 'UNPAID' }, file[0]], [], [])
  assert.equal(twice.rows.length, 1)
  assert.equal(twice.rows[0].transactionStatus, 'PAID')

  // The stored table can only hold one current row per order.
  const sql = read('supabase', 'migrations', '162_settlements_matching.sql')
  assert.ok(/create unique index if not exists reconciliation_rows_current_order_uidx[\s\S]*where is_current/.test(sql))
  const lib = read('lib', 'reconciliation.ts')
  assert.ok(lib.includes('planUpsert(') && lib.includes('.update(record(r))'), 'the importer updates stored orders in place')
})

test('a Rs 386 credit matches two JazzCash orders at 193, and says which', () => {
  assert.deepEqual(findSubset([193, 193, 193], 386), [0, 1])
  assert.equal(findSubset([193, 193, 193], 400), null)

  const b = board([credit({ id: 'c1', date: '2026-10-09', amountPkr: 386 })])
  const m = b.matches[0]
  assert.equal(m.status, 'matched')
  assert.deepEqual(m.orders, ['TM-20261008101500-AAA111', 'TM-20261008113000-BBB222'])
  assert.match(m.how, /2 of 3 orders settled 2026-10-09/)
  // The third JazzCash order is still waiting for its own credit.
  const third = b.orders.find((o) => o.orderNumber === 'TM-20261008140000-CCC333')!
  assert.equal(third.state, 'settled_no_credit')
  assert.equal(b.credits[0].state, 'matched')
})

test('a whole settle-date group matches one credit; channels are kept apart', () => {
  const b = board([
    credit({ id: 'jc', date: '2026-10-09', amountPkr: 579 }),
    credit({ id: 'ep', date: '2026-10-09', amountPkr: 203, senderName: 'PAYPRO', senderBank: 'TMFB' }),
  ])
  const jc = b.matches.find((m) => m.creditId === 'jc')!
  const ep = b.matches.find((m) => m.creditId === 'ep')!
  assert.equal(jc.orders.length, 3)
  assert.deepEqual(ep.orders, ['TM-20261008150000-DDD444'])
  assert.equal(ep.status, 'matched')
  // A TMFB credit never takes JazzCash orders, even when the total fits.
  const only = board([credit({ id: 'ep', date: '2026-10-09', amountPkr: 386, senderName: 'PAYPRO', senderBank: 'TMFB' })])
  assert.equal(only.credits[0].state, 'unmatched')
})

test('an Easypaisa payout that arrives as Rs 199 against a share of 203 is an amount mismatch, not hidden', () => {
  const b = board([credit({ id: 'ep', date: '2026-10-09', amountPkr: 199, senderName: 'PAYPRO', senderBank: 'TMFB' })])
  const m = b.matches[0]
  assert.equal(m.status, 'amount_mismatch')
  assert.equal(m.expected, 203)
  assert.equal(m.difference, -4)
  const v = monthView(b, ours, '2026-10')
  assert.ok(v.attention.some((a) => a.kind === 'amount_mismatch' && a.icon === '⚠️'))
})

test('the ±2-day window: two days either side matches, three does not', () => {
  for (const [date, ok] of [['2026-10-07', true], ['2026-10-11', true], ['2026-10-06', false], ['2026-10-12', false]] as const) {
    const b = board([credit({ id: 'c', date, amountPkr: 579 })])
    assert.equal(b.credits[0].state, ok ? 'matched' : 'unmatched', date)
  }
  // Rs 2 short is a bank charge; a credit from a member is never a PayPro payout.
  assert.equal(board([credit({ id: 'c', date: '2026-10-09', amountPkr: 577 })]).matches[0].status, 'bank_charge')
  assert.equal(board([credit({ id: 'c', date: '2026-10-09', amountPkr: 579, isPaypro: false, senderName: 'ALI KHAN' })]).credits[0].state, 'unmatched')
})

const receipt = (o: Partial<Receipt> & { id: string }): Receipt => ({ ref: `TM-BANK-${o.id}`, amountPkr: 199, approvedDay: '2026-10-09', transactionId: null, payerName: null, ...o })
const member = (o: Partial<Credit> & { id: string; date: string }): Credit => credit({ amountPkr: 199, isPaypro: false, senderName: 'SOMEONE ELSE', ...o })

test('a bank transfer is matched by amount and date, preferring a matching reference, then sender name', () => {
  // Amount and date alone.
  let b = board([member({ id: 'c1', date: '2026-10-10' })], { receipts: [receipt({ id: 'r1' })] })
  assert.equal(b.receipts[0].state, 'matched')
  assert.equal(b.matches[0].how, 'Same amount, within 2 days')

  // Outside the window, or another amount: no match.
  b = board([member({ id: 'c1', date: '2026-10-12' }), member({ id: 'c2', date: '2026-10-09', amountPkr: 499 })], { receipts: [receipt({ id: 'r1' })] })
  assert.equal(b.receipts[0].state, 'waiting')
  assert.equal(b.credits.filter((c) => c.state === 'unmatched').length, 2)

  // Two receipts, two same-amount credits: reference and name decide which is which.
  b = board(
    [
      member({ id: 'near', date: '2026-10-09', senderName: 'AYESHA KHAN', reference: 'FT1' }),
      member({ id: 'ref', date: '2026-10-10', reference: 'FBL-778899' }),
    ],
    { receipts: [receipt({ id: 'r1', transactionId: 'fbl 778899' }), receipt({ id: 'r2', payerName: 'Ayesha Khan' })] },
  )
  assert.equal(b.receipts.find((r) => r.id === 'r1')!.creditId, 'ref')
  assert.equal(b.receipts.find((r) => r.id === 'r2')!.creditId, 'near')
  assert.equal(b.matches.find((m) => m.creditId === 'ref')!.how, 'Same amount and reference')
  assert.equal(b.matches.find((m) => m.creditId === 'near')!.how, 'Same amount and sender name')

  // A PayPro payout never pays a member's bank transfer.
  b = board([credit({ id: 'pp', date: '2026-10-09', amountPkr: 199 })], { receipts: [receipt({ id: 'r1' })], rows: [] })
  assert.equal(b.receipts[0].state, 'waiting')
})

test('a duplicate bank reference is refused; a credit needs a date, an amount and a reference', () => {
  const ok = { date: '2026-10-09', time: '14:35', amountPkr: 386, reference: 'FT26282ABC' }
  assert.equal(creditProblem(ok, []), null)
  assert.match(creditProblem(ok, ['ft26282-abc ']) ?? '', /already recorded/)
  assert.match(creditProblem({ ...ok, reference: ' ' }, []) ?? '', /reference/)
  assert.match(creditProblem({ ...ok, amountPkr: 0 }, []) ?? '', /amount/)
  assert.match(creditProblem({ ...ok, date: '9 Oct' }, []) ?? '', /date/)
  const sql = read('supabase', 'migrations', '162_settlements_matching.sql')
  assert.ok(sql.includes('bank_transfers_manual_reference_uidx'), 'the database refuses it too')
  assert.ok(read('app', 'api', 'admin', 'payments', 'settlement', 'credits', 'route.ts').includes('only.duplicate ? 409 : 400'))
})

test('the email-text parser reads amount, date, time, sender, sender bank and reference', () => {
  const lines = parseBankAlert(
    [
      'From: alerts@faysalbank.com',
      'Dear Customer,',
      'Your account has been credited.',
      'Amount: PKR 386.00',
      'Date: 09-Oct-2026',
      'Time: 02:35 PM',
      'Sender Name: PAYPRO PRIVATE LIMITED',
      'Sender Bank: Bank Alfalah',
      'Transaction Reference: FT26282XK9P1',
    ].join('\r\n'),
  )
  assert.deepEqual(lines, { amountPkr: 386, date: '2026-10-09', time: '14:35', senderName: 'PAYPRO PRIVATE LIMITED', senderBank: 'Bank Alfalah', reference: 'FT26282XK9P1' })
  assert.equal(isPayproSender(lines.senderName), true)

  const sentence = parseBankAlert('Dear Customer, PKR 199.00 has been credited to your account 0123 from PAYPRO via TMFB on 10/10/2026 at 09:05. Transaction ID: 554433221100.')
  assert.deepEqual(sentence, { amountPkr: 199, date: '2026-10-10', time: '09:05', senderName: 'PAYPRO', senderBank: 'TMFB', reference: '554433221100' })

  assert.deepEqual(parseBankAlert('hello'), { amountPkr: null, date: null, time: null, senderName: null, senderBank: null, reference: null })
})

test('a manual link wins, an unlink holds a credit out, and both are owner writes with a note', () => {
  const c = credit({ id: 'c1', date: '2026-10-09', amountPkr: 386 })
  const linked = board([c], { links: [{ transferId: 'c1', kind: 'order', target: 'TM-20261008140000-CCC333', note: 'PayPro confirmed by email' }] })
  assert.equal(linked.matches[0].status, 'manual')
  assert.deepEqual(linked.matches[0].orders, ['TM-20261008140000-CCC333'])
  assert.equal(linked.matches[0].difference, 193)
  assert.equal(linked.matches[0].note, 'PayPro confirmed by email')

  const held = board([c], { links: [{ transferId: 'c1', kind: 'none', target: null, note: 'not ours' }] })
  assert.equal(held.credits[0].state, 'held')
  assert.equal(held.matches.length, 0)

  const lib = read('lib', 'settlementMatch.ts')
  assert.ok(lib.includes("'Add a short note saying why.'"))
  for (const a of ['settlement.credit_add', 'settlement.link', 'settlement.unlink', 'settlement.link_reset']) assert.ok(lib.includes(a), `${a} is audited`)
})

test('paid but not settled is waiting, and red after 5 days; the month cards and fee table add up', () => {
  const b = board([credit({ id: 'c1', date: '2026-10-09', amountPkr: 386 })])
  const pending = b.orders.find((o) => o.orderNumber === 'TM-20261010090000-EEE555')!
  assert.equal(pending.state, 'waiting')
  assert.deepEqual([pending.ageDays, pending.overdue], [1, false])
  const at = (nowIso: string) => buildBoard({ rows: file, credits: [], ourPaypro: ours, receipts: [], links: [], nowIso }).orders.find((o) => o.orderNumber === pending.orderNumber)!
  assert.deepEqual([at('2026-10-16T06:00:00Z').ageDays, at('2026-10-16T06:00:00Z').overdue], [6, true])
  assert.equal(at('2026-10-15T06:00:00Z').overdue, false, '5 days is not yet overdue')

  const v = monthView(b, ours, '2026-10')
  assert.equal(v.cards.received, 995, 'five approved PayPro payments of Rs 199')
  assert.equal(v.cards.fees, 6 * 4 - 4, 'four JazzCash at Rs 6, Easypaisa at −4')
  assert.equal(v.cards.netSettled, 386)
  assert.equal(v.cards.waiting, 193 + 203 + 193)
  assert.equal(v.matched.length, 1)
  assert.equal(v.orders.length, 5, 'the unpaid order has no date and is in no month')
  const jazz = v.feeTable.find((f) => f.method === 'JazzCash')!
  assert.deepEqual([jazz.month, jazz.orders, jazz.perOrder, jazz.fees], ['2026-10', 4, [6], 24])
  assert.equal(monthView(b, ours, '2026-09').orders.length, 0)

  const csv = monthCsv(v)
  assert.ok(csv.startsWith('Type,Date,Reference,Method,'))
  assert.ok(csv.includes('PayPro order,2026-10-08,TM-20261008101500-AAA111,JazzCash,199,193,6,2026-10-09,Matched,2026-10-09,REF-c1,386'))
  assert.ok(!/Test Person|03001234567/.test(csv))
})

test('in the export but not in TutorMint, and in TutorMint but not in the export, are both flagged', () => {
  const some = ours.slice(1)
  const extra: OurPaypro = { ref: 'TM-20261009120000-ZZZ999', status: 'approved', amountPkr: 199, approvedDay: '2026-10-09' }
  const after: OurPaypro = { ref: 'TM-20261011120000-YYY888', status: 'approved', amountPkr: 199, approvedDay: '2026-10-11' }
  const b = buildBoard({ rows: file, credits: [], ourPaypro: [...some, extra, after], receipts: [], links: [], nowIso: NOW })
  assert.deepEqual(b.orders.find((o) => o.orderNumber === file[0].orderNumber)!.flags, ['not_in_tutormint'])
  assert.deepEqual(b.missingFromExport.map((p) => p.ref), [extra.ref], 'a payment after the last day in the export is not flagged')
  const kinds = monthView(b, [...some, extra, after], '2026-10').attention.map((a) => a.kind)
  assert.ok(kinds.includes('not_in_tutormint') && kinds.includes('not_in_export'))
})

test('owner and Partner only: other staff cannot open the page or its APIs', () => {
  assert.deepEqual(SCREEN_ACCESS.finance, [])
  assert.equal(roleSatisfies('owner', SCREEN_ACCESS.finance), true)
  assert.equal(roleSatisfies('partner', SCREEN_ACCESS.finance), true)
  assert.equal(isReadOnlyRole('partner'), false) // full management since 13 Oct 2026 (was view-only)
  for (const r of ['admin', 'operations', 'tuitions_staff'] as const) assert.equal(roleSatisfies(r, SCREEN_ACCESS.finance), false, r)

  // Settlement check is a tab of Finance (owner, 15 Oct 2026); the Finance page
  // that renders it checks the role, and the old address redirects there.
  assert.ok(read('app', 'admin', 'finance', 'page.tsx').includes('await requireAdminRole(...SCREEN_ACCESS.finance)'))
  assert.ok(read('app', 'admin', 'finance', 'page.tsx').includes('<SettlementTab sp={sp} extra={extra} />'))
  assert.ok(read('app', 'admin', 'finance', 'settlement', 'page.tsx').includes('redirect(financeHref(await searchParams))'))
  const base = ['app', 'api', 'admin', 'payments', 'settlement']
  for (const route of [[], ['credits'], ['links'], ['month']]) {
    const src = read(...base, ...route, 'route.ts')
    assert.ok(src.includes('checkAdminRole(...SCREEN_ACCESS.finance)'), route.join('/'))
  }
  // checkAdminRole is what refuses a Partner write (403) and a signed-out one (401).
  const auth = read('lib', 'adminAuth.ts')
  assert.ok(auth.includes('!roleMayWrite(actor.adminRole, allowed)) && !opts.self'))
  assert.ok(auth.includes("status: 401, error: 'Admin access required.'"))
  // The page hides every write control from the Partner.
  const ui = read('app', 'admin', 'finance', 'settlement', 'SettlementsBoard.tsx')
  assert.ok(ui.includes('useAdminReadOnly()') && ui.includes('{!readOnly && ('))
  // Server-written tables only: no write policy.
  const sql = read('supabase', 'migrations', '162_settlements_matching.sql')
  assert.equal((sql.match(/create policy/g) ?? []).length, 1)
  assert.ok(sql.includes('for select using (public.is_admin())'))
})

test('a sign-in redirect keeps the whole address in next, query string included', () => {
  const proxy = read('proxy.ts')
  assert.equal((proxy.match(/url\.searchParams\.set\('next', pathname \+ search\)/g) ?? []).length, 2)
  assert.ok(!proxy.includes("url.searchParams.set('next', pathname)"))
  // What the proxy builds for /pay/choose?plan=premium.
  const url = new URL('https://www.tutormint.org/pay/choose?plan=premium')
  const to = new URL('/login', url)
  to.searchParams.set('next', url.pathname + url.search)
  assert.equal(to.toString(), 'https://www.tutormint.org/login?next=%2Fpay%2Fchoose%3Fplan%3Dpremium')
  assert.equal(to.searchParams.get('next'), '/pay/choose?plan=premium')
})

test('an unknown /api/ path answers 404 JSON for every method', async () => {
  const route = await import('../app/api/[...notfound]/route')
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    const res = route[method]()
    assert.equal(res.status, 404, method)
    assert.match(res.headers.get('content-type') ?? '', /application\/json/)
    assert.deepEqual(await res.json(), { error: 'Not found' })
  }
})
