// lib/settlementMatchCore.ts
//
// Settlements (owner, 11 Oct 2026) — the PURE half: matching what customers
// paid to what reached the bank. No I/O, so every rule here is unit-tested
// (scripts/test-settlements.ts). lib/settlementMatch.ts is the I/O around it.
//
// Money reaches the bank two ways:
//   • PayPro payouts — PayPro bundles several PAID orders into ONE bank credit.
//     Settled orders are grouped by settle date and payout channel (JazzCash vs
//     Easypaisa/TMFB) and each group's MerchantShare total is matched to a credit
//     from a PayPro sender within ±2 days. When only part of a day's orders adds
//     up to a credit, that SUBSET is matched and the picked orders are named.
//   • Bank transfers — a member pays us directly and staff approve the receipt.
//     Each approved receipt is matched to a credit of the same amount within
//     ±2 days, preferring a matching reference, then a matching sender name.
// The owner can link or unlink anything by hand; a manual link always wins.
// Nothing here changes a payment — it reports.
//
// The older range check (settle / settleByDate in lib/settlementCore.ts) and its
// figures are untouched; this file adds to it.

import { isPaid, parseAmount, parseDate, type PayproRow } from './reconciliationCore'
import { BANK_CHARGE_TOLERANCE_PKR, DUE_OVERDUE_DAYS, SETTLE_WINDOW_DAYS, isSettled, pkDay } from './settlementCore'

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type PayMethod = 'JazzCash' | 'Easypaisa' | 'Card' | 'Other'
export type Channel = 'jazzcash' | 'tmfb' | 'card' | 'other'

/** PayPro's "Payment Via" → the method we report. */
export function payMethod(via: string | null | undefined): PayMethod {
  const s = (via ?? '').toLowerCase()
  if (s.includes('jazz')) return 'JazzCash'
  if (/easy\s?paisa|telenor|tmfb/.test(s)) return 'Easypaisa'
  if (/card|visa|master|debit|credit/.test(s)) return 'Card'
  return 'Other'
}

/** The payout channel a method settles through (Easypaisa pays out via TMFB). */
export function channelOf(method: PayMethod): Channel {
  if (method === 'JazzCash') return 'jazzcash'
  if (method === 'Easypaisa') return 'tmfb'
  if (method === 'Card') return 'card'
  return 'other'
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The gateway's fee on one order: amount − MerchantShare. */
export function feeOf(r: { orderAmount: number | null; merchantShare: number | null }): number | null {
  if (r.orderAmount === null || r.merchantShare === null) return null
  return round2(r.orderAmount - r.merchantShare)
}

const orderKey = (s: string) => s.trim().toUpperCase()

/** One row per order number. A PAID line wins over a non-paid one; otherwise the
 *  later line wins. The same rule as matchRows. */
export function dedupeOrders(rows: PayproRow[]): PayproRow[] {
  const by = new Map<string, PayproRow>()
  for (const r of rows) {
    const k = orderKey(r.orderNumber)
    const have = by.get(k)
    if (!have || !isPaid(have.transactionStatus) || isPaid(r.transactionStatus)) by.set(k, r)
  }
  return [...by.values()]
}

/**
 * What an upload does to the stored orders: which are new, which already exist
 * (and are updated in place), and which order numbers we have no payment for.
 * Uploading the same file twice gives 0 new the second time.
 */
export function planUpsert(
  fileRows: PayproRow[],
  existingOrderNumbers: string[],
  ourRefs: string[],
): { rows: PayproRow[]; newOrders: string[]; updatedOrders: string[]; unknownOrders: string[] } {
  const rows = dedupeOrders(fileRows)
  const have = new Set(existingOrderNumbers.map(orderKey))
  const ours = new Set(ourRefs.map(orderKey))
  const newOrders: string[] = []
  const updatedOrders: string[] = []
  const unknownOrders: string[] = []
  for (const r of rows) {
    const k = orderKey(r.orderNumber)
    ;(have.has(k) ? updatedOrders : newOrders).push(r.orderNumber)
    if (!ours.has(k)) unknownOrders.push(r.orderNumber)
  }
  return { rows, newOrders, updatedOrders, unknownOrders }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type Credit = {
  id: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM or null */
  time: string | null
  amountPkr: number
  senderName: string | null
  senderBank: string | null
  reference: string | null
  note: string | null
  /** A PayPro payout (true) or a member's own bank transfer (false). */
  isPaypro: boolean
}

/** One of OUR PayPro payments (by reference). */
export type OurPaypro = { ref: string; status: string; amountPkr: number; approvedDay: string | null }

/** An APPROVED bank-transfer receipt. */
export type Receipt = {
  id: string
  ref: string
  amountPkr: number
  approvedDay: string
  /** The transaction id the member typed with the receipt, if any. */
  transactionId: string | null
  payerName: string | null
}

/** `target` of a 'none' link that means "Ignore (not a sale)" rather than a plain
 *  hold. Stored this way so no schema change is needed (settlement_links.kind is
 *  CHECKed to order | receipt | none; target is free text). */
export const NOT_A_SALE = 'not_a_sale'

export type ManualLink = { transferId: string; kind: 'order' | 'receipt' | 'none'; target: string | null; note: string | null }

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type MatchStatus = 'matched' | 'bank_charge' | 'amount_mismatch' | 'manual'

export type CreditMatch = {
  creditId: string
  status: MatchStatus
  /** PayPro order numbers this credit pays. */
  orders: string[]
  /** Receipt (payment) ids this credit pays. */
  receipts: string[]
  /** What the linked orders and receipts add up to. */
  expected: number
  /** credit − expected (negative = short). */
  difference: number
  /** Plain words: why this was matched. */
  how: string
  note: string | null
}

export type OrderState = 'matched' | 'waiting' | 'settled_no_credit' | 'not_paid'
export type OrderFlag = 'not_in_tutormint' | 'not_approved' | 'amount_differs'

export type OrderView = {
  orderNumber: string
  transactionStatus: string | null
  method: PayMethod
  channel: Channel
  orderAmount: number | null
  merchantShare: number | null
  fee: number | null
  datePaid: string | null
  settleDate: string | null
  settleStatus: string | null
  state: OrderState
  creditId: string | null
  ageDays: number | null
  overdue: boolean
  flags: OrderFlag[]
  ourAmount: number | null
}

export type ReceiptView = Receipt & { state: 'matched' | 'waiting'; creditId: string | null; ageDays: number; overdue: boolean }

/** 'ignored' = the owner marked it "Ignore (not a sale)": never matched, and not
 *  counted as unmatched. */
export type CreditView = Credit & { state: 'matched' | 'unmatched' | 'held' | 'ignored'; match: CreditMatch | null; ignoreNote: string | null }

export type Board = {
  hasExport: boolean
  orders: OrderView[]
  receipts: ReceiptView[]
  credits: CreditView[]
  matches: CreditMatch[]
  /** Approved on TutorMint, inside the export's dates, but not PAID in it. */
  missingFromExport: OurPaypro[]
}

export const WAITING_OVERDUE_DAYS = DUE_OVERDUE_DAYS

const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000)
const inWindow = (a: string, b: string) => Math.abs(dayNum(a) - dayNum(b)) <= SETTLE_WINDOW_DAYS
const paise = (n: number) => Math.round(n * 100)

/**
 * Indices of a subset of `amounts` adding up to `target` exactly, or null.
 * Earlier items are preferred, so the answer is the same every time.
 */
export function findSubset(amounts: number[], target: number): number[] | null {
  const goal = paise(target)
  if (goal <= 0) return null
  // sum → the indices that reach it (first way found is kept).
  let reach = new Map<number, number[]>([[0, []]])
  for (let i = 0; i < amounts.length; i++) {
    const a = paise(amounts[i])
    if (a <= 0) continue
    const next = new Map(reach)
    for (const [sum, picked] of reach) {
      const s = sum + a
      if (s > goal || next.has(s)) continue
      next.set(s, [...picked, i])
      if (s === goal) return next.get(s)!
    }
    reach = next
    if (reach.size > 50_000) return null
  }
  return null
}

/** The channel a credit's sender text points at, or null when it does not say. */
export function creditChannel(c: Pick<Credit, 'senderName' | 'senderBank' | 'note'>): Channel | null {
  const s = `${c.senderName ?? ''} ${c.senderBank ?? ''}`.toLowerCase()
  if (/tmfb|telenor|easy\s?paisa/.test(s)) return 'tmfb'
  if (/jazz|mobilink/.test(s)) return 'jazzcash'
  return null
}

/** True when the sender text names PayPro. */
export function isPayproSender(name: string | null | undefined): boolean {
  return /pay\s?pro/i.test(name ?? '')
}

const alnum = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Money totals leave out a credit marked "Ignore (not a sale)" (owner, 11 Oct
 * 2026). Every reader of bank credits that ADDS AMOUNTS UP passes its rows
 * through this with lib/ignoredCredits ignoredCreditIds().
 */
export function withoutIgnored<T extends { id: string }>(credits: T[], ignoredIds: ReadonlySet<string>): T[] {
  return ignoredIds.size === 0 ? credits : credits.filter((c) => !ignoredIds.has(c.id))
}

/** A reference with case, spaces and punctuation removed — how two are compared. */
export const refKey = alnum

function referenceMatches(credit: Credit, receipt: Receipt): boolean {
  const a = alnum(receipt.transactionId)
  const b = alnum(credit.reference)
  return a.length >= 4 && b.length >= 4 && (a === b || a.includes(b) || b.includes(a))
}

function nameMatches(credit: Credit, receipt: Receipt): boolean {
  const tokens = (receipt.payerName ?? '').toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3)
  if (tokens.length === 0) return false
  const sender = ` ${(credit.senderName ?? '').toLowerCase().replace(/[^a-z]+/g, ' ')} `
  const hits = tokens.filter((t) => sender.includes(` ${t} `)).length
  return hits >= Math.min(2, tokens.length)
}

type Order = OrderView

export function buildBoard(input: {
  /** The CURRENT stored orders (one per order number). */
  rows: PayproRow[]
  credits: Credit[]
  ourPaypro: OurPaypro[]
  receipts: Receipt[]
  links: ManualLink[]
  nowIso: string
}): Board {
  const today = dayNum(pkDay(input.nowIso))
  const ours = new Map(input.ourPaypro.map((p) => [orderKey(p.ref), p]))

  const orders: Order[] = dedupeOrders(input.rows).map((r) => {
    const method = payMethod(r.paymentVia)
    const paid = isPaid(r.transactionStatus)
    const our = ours.get(orderKey(r.orderNumber))
    const flags: OrderFlag[] = []
    if (paid && !our) flags.push('not_in_tutormint')
    else if (paid && our && our.status !== 'approved') flags.push('not_approved')
    if (paid && our && r.orderAmount !== null && Math.abs(r.orderAmount - our.amountPkr) > 0.005) flags.push('amount_differs')
    return {
      orderNumber: r.orderNumber,
      transactionStatus: r.transactionStatus,
      method,
      channel: channelOf(method),
      orderAmount: r.orderAmount,
      merchantShare: r.merchantShare,
      fee: paid ? feeOf(r) : null,
      datePaid: r.datePaid,
      settleDate: r.settleDate,
      settleStatus: r.settleStatus,
      state: paid ? (isSettled(r) ? 'settled_no_credit' : 'waiting') : 'not_paid',
      creditId: null,
      ageDays: null,
      overdue: false,
      flags,
      ourAmount: our ? our.amountPkr : null,
    }
  })
  const orderBy = new Map(orders.map((o) => [orderKey(o.orderNumber), o]))
  const receipts: ReceiptView[] = input.receipts.map((r) => ({ ...r, state: 'waiting', creditId: null, ageDays: 0, overdue: false }))
  const receiptBy = new Map(receipts.map((r) => [r.id, r]))
  const credits = [...input.credits].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.id.localeCompare(b.id))

  const matches = new Map<string, CreditMatch>()
  const held = new Set<string>()
  const ignored = new Map<string, string | null>()
  const share = (list: Order[]) => round2(list.reduce((s, o) => s + (o.merchantShare ?? 0), 0))

  const take = (credit: Credit, picked: Order[], recs: ReceiptView[], status: MatchStatus, how: string, note: string | null = null) => {
    const expected = round2(share(picked) + recs.reduce((s, r) => s + r.amountPkr, 0))
    for (const o of picked) {
      o.state = 'matched'
      o.creditId = credit.id
    }
    for (const r of recs) {
      r.state = 'matched'
      r.creditId = credit.id
    }
    matches.set(credit.id, {
      creditId: credit.id,
      status,
      orders: picked.map((o) => o.orderNumber),
      receipts: recs.map((r) => r.id),
      expected,
      difference: round2(credit.amountPkr - expected),
      how,
      note,
    })
  }

  // 1. The owner's manual links win. A hold ('none') keeps a credit unmatched.
  const linksBy = new Map<string, ManualLink[]>()
  for (const l of input.links) linksBy.set(l.transferId, [...(linksBy.get(l.transferId) ?? []), l])
  for (const c of credits) {
    const ls = linksBy.get(c.id)
    if (!ls || ls.length === 0) continue
    const none = ls.find((l) => l.kind === 'none')
    if (none) {
      held.add(c.id)
      if (none.target === NOT_A_SALE) ignored.set(c.id, none.note)
      continue
    }
    const picked = ls
      .filter((l) => l.kind === 'order' && l.target)
      .map((l) => orderBy.get(orderKey(l.target!)))
      .filter((o): o is Order => !!o && o.state !== 'matched')
    const recs = ls
      .filter((l) => l.kind === 'receipt' && l.target)
      .map((l) => receiptBy.get(l.target!))
      .filter((r): r is ReceiptView => !!r && r.state !== 'matched')
    if (picked.length + recs.length === 0) continue
    take(c, picked, recs, 'manual', 'Linked by hand', ls.find((l) => l.note)?.note ?? null)
  }

  const free = (c: Credit) => !matches.has(c.id) && !held.has(c.id)
  const channelFits = (c: Credit, ch: Channel) => {
    const want = creditChannel(c)
    return want === null || want === ch
  }
  const openSettled = () => orders.filter((o) => o.state === 'settled_no_credit' && o.settleDate)
  const groupsOf = (list: Order[]) => {
    const by = new Map<string, Order[]>()
    for (const o of list) {
      const k = `${o.settleDate}|${o.channel}`
      by.set(k, [...(by.get(k) ?? []), o])
    }
    return [...by.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, list]) => ({ settleDate: k.split('|')[0], channel: k.split('|')[1] as Channel, list: list.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber)) }))
  }
  const gapRank = (c: Credit, settleDate: string): [number, number] => {
    const gap = dayNum(c.date) - dayNum(settleDate)
    return [Math.abs(gap), gap >= 0 ? 0 : 1]
  }
  const less = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
    return false
  }
  const ordersWord = (n: number) => `${n} order${n === 1 ? '' : 's'}`

  // 2. PayPro, whole groups: settle date + channel total = one credit (a
  //    shortfall of Rs 2 or less is a bank charge).
  for (const g of groupsOf(openSettled())) {
    const total = share(g.list)
    let best: Credit | null = null
    let bestKey: number[] | null = null
    for (const c of credits) {
      if (!free(c) || !c.isPaypro || !inWindow(c.date, g.settleDate) || !channelFits(c, g.channel)) continue
      const short = round2(total - c.amountPkr)
      const exact = Math.abs(short) < 0.005
      if (!exact && !(short > 0 && short <= BANK_CHARGE_TOLERANCE_PKR + 0.005)) continue
      const key = [exact ? 0 : 1, ...gapRank(c, g.settleDate)]
      if (!bestKey || less(key, bestKey)) {
        best = c
        bestKey = key
      }
    }
    if (!best) continue
    const exact = Math.abs(total - best.amountPkr) < 0.005
    take(best, g.list, [], exact ? 'matched' : 'bank_charge', `${ordersWord(g.list.length)} settled ${g.settleDate}`)
  }

  // 3. PayPro, subsets: a credit that equals only SOME of a day's orders.
  for (const c of credits) {
    if (!free(c) || !c.isPaypro) continue
    const days = [...new Set(openSettled().map((o) => o.settleDate!))]
      .filter((d) => inWindow(c.date, d))
      .sort((a, b) => (less(gapRank(c, a), gapRank(c, b)) ? -1 : 1))
    let done = false
    for (const day of days) {
      const sameDay = openSettled().filter((o) => o.settleDate === day && channelFits(c, o.channel))
      const pools = [...groupsOf(sameDay).map((g) => g.list), sameDay.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber))]
      for (const pool of pools) {
        const idx = findSubset(pool.map((o) => o.merchantShare ?? 0), c.amountPkr)
        if (!idx) continue
        const picked = idx.map((i) => pool[i])
        take(c, picked, [], 'matched', `${picked.length} of ${ordersWord(pool.length)} settled ${day}`)
        done = true
        break
      }
      if (done) break
    }
  }

  // 4. PayPro, amount mismatch: a credit clearly meant for a group but off by a
  //    little (within Rs 10 an order, or 5%). Shown as a mismatch, not hidden.
  for (const g of groupsOf(openSettled())) {
    const total = share(g.list)
    const allow = Math.max(10 * g.list.length, total * 0.05)
    let best: Credit | null = null
    let bestKey: number[] | null = null
    for (const c of credits) {
      if (!free(c) || !c.isPaypro || !inWindow(c.date, g.settleDate) || !channelFits(c, g.channel)) continue
      const diff = Math.abs(c.amountPkr - total)
      if (diff > allow) continue
      const key = [diff, ...gapRank(c, g.settleDate)]
      if (!bestKey || less(key, bestKey)) {
        best = c
        bestKey = key
      }
    }
    if (best) take(best, g.list, [], 'amount_mismatch', `${ordersWord(g.list.length)} settled ${g.settleDate}`)
  }

  // 5. Bank-transfer receipts: same amount within ±2 days — a matching
  //    reference first, then a matching sender name, then the nearest day.
  const openReceipts = () => receipts.filter((r) => r.state === 'waiting').sort((a, b) => a.approvedDay.localeCompare(b.approvedDay) || a.id.localeCompare(b.id))
  const passes: { test: (c: Credit, r: Receipt) => boolean; how: string }[] = [
    { test: referenceMatches, how: 'Same amount and reference' },
    { test: nameMatches, how: 'Same amount and sender name' },
    { test: () => true, how: 'Same amount, within 2 days' },
  ]
  for (const pass of passes) {
    for (const r of openReceipts()) {
      let best: Credit | null = null
      let bestGap = Infinity
      for (const c of credits) {
        if (!free(c) || c.isPaypro || Math.abs(c.amountPkr - r.amountPkr) > 0.005 || !inWindow(c.date, r.approvedDay)) continue
        if (!pass.test(c, r)) continue
        const gap = Math.abs(dayNum(c.date) - dayNum(r.approvedDay))
        if (gap < bestGap) {
          best = c
          bestGap = gap
        }
      }
      if (best) take(best, [], [r], 'matched', pass.how)
    }
  }

  // Ages: how long money has been on its way.
  for (const o of orders) {
    if (o.state !== 'waiting' && o.state !== 'settled_no_credit') continue
    const since = o.state === 'settled_no_credit' ? o.settleDate : o.datePaid
    o.ageDays = since ? Math.max(0, today - dayNum(since)) : null
    o.overdue = o.ageDays !== null && o.ageDays > WAITING_OVERDUE_DAYS
  }
  for (const r of receipts) {
    if (r.state !== 'waiting') continue
    r.ageDays = Math.max(0, today - dayNum(r.approvedDay))
    r.overdue = r.ageDays > WAITING_OVERDUE_DAYS
  }

  // Approved here, not PAID in the export — only inside the dates the export covers.
  const paidDays = orders.filter((o) => o.state !== 'not_paid' && o.datePaid).map((o) => o.datePaid!).sort()
  const paidKeys = new Set(orders.filter((o) => o.state !== 'not_paid').map((o) => orderKey(o.orderNumber)))
  const missingFromExport =
    paidDays.length === 0
      ? []
      : input.ourPaypro.filter(
          (p) => p.status === 'approved' && !!p.approvedDay && p.approvedDay >= paidDays[0] && p.approvedDay <= paidDays[paidDays.length - 1] && !paidKeys.has(orderKey(p.ref)),
        )

  return {
    hasExport: input.rows.length > 0,
    orders,
    receipts,
    credits: credits.map((c) => {
      const match = matches.get(c.id) ?? null
      return {
        ...c,
        state: match ? 'matched' : ignored.has(c.id) ? 'ignored' : held.has(c.id) ? 'held' : 'unmatched',
        match,
        ignoreNote: ignored.get(c.id) ?? null,
      }
    }),
    matches: [...matches.values()],
    missingFromExport,
  }
}

// ---------------------------------------------------------------------------
// One month
// ---------------------------------------------------------------------------

export type AttentionKind = 'credit_unmatched' | 'amount_mismatch' | 'not_in_tutormint' | 'not_in_export' | 'order_amount' | 'waiting'

export type AttentionItem = {
  kind: AttentionKind
  /** ❓ ⚠️ ⏳ — shown before the title. */
  icon: string
  title: string
  detail: string
  day: string | null
  red: boolean
  creditId?: string
}

export type FeeRow = { month: string; method: PayMethod; orders: number; amount: number; fees: number; perOrder: number[] }

export type MonthView = {
  month: string
  cards: { received: number; fees: number; netSettled: number; waiting: number; unmatched: number }
  attention: AttentionItem[]
  matched: CreditView[]
  orders: OrderView[]
  receipts: ReceiptView[]
  credits: CreditView[]
  feeTable: FeeRow[]
}

const rs = (n: number | null) => (n === null ? '—' : `Rs ${n.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`)
const days = (n: number | null) => (n === null ? '' : ` · ${n} day${n === 1 ? '' : 's'}`)

export function monthView(board: Board, ourPaypro: OurPaypro[], month: string): MonthView {
  const inMonth = (d: string | null | undefined) => !!d && d.startsWith(month)
  const orders = board.orders.filter((o) => inMonth(o.datePaid ?? o.settleDate))
  const receipts = board.receipts.filter((r) => inMonth(r.approvedDay))
  const credits = board.credits.filter((c) => inMonth(c.date))
  const matched = credits.filter((c) => c.state === 'matched')

  const attention: AttentionItem[] = []
  for (const c of credits) {
    if (c.state === 'matched') {
      if (c.match!.status === 'amount_mismatch') {
        attention.push({
          kind: 'amount_mismatch',
          icon: '⚠️',
          title: `Amount mismatch: credit ${rs(c.amountPkr)}, expected ${rs(c.match!.expected)}`,
          detail: `${c.match!.how}${c.senderName ? ` · from ${c.senderName}` : ''}${c.reference ? ` · ref ${c.reference}` : ''}`,
          day: c.date,
          red: true,
          creditId: c.id,
        })
      }
      continue
    }
    if (c.state === 'ignored') continue
    attention.push({
      kind: 'credit_unmatched',
      icon: '❓',
      title: `Bank credit not matched: ${rs(c.amountPkr)}`,
      detail: `${c.senderName ?? 'Sender not recorded'}${c.reference ? ` · ref ${c.reference}` : ''}${c.state === 'held' ? ' · unlinked by hand' : ''}`,
      day: c.date,
      red: true,
      creditId: c.id,
    })
  }
  for (const o of orders) {
    if (o.flags.includes('not_in_tutormint') || o.flags.includes('not_approved')) {
      attention.push({
        kind: 'not_in_tutormint',
        icon: '⚠️',
        title: o.flags.includes('not_approved') ? `Paid at PayPro, not approved on TutorMint: ${o.orderNumber}` : `In the PayPro export, not in TutorMint: ${o.orderNumber}`,
        detail: `${o.method} · ${rs(o.orderAmount)}`,
        day: o.datePaid,
        red: true,
      })
    }
    if (o.flags.includes('amount_differs')) {
      attention.push({
        kind: 'order_amount',
        icon: '⚠️',
        title: `Amount mismatch: ${o.orderNumber}`,
        detail: `PayPro ${rs(o.orderAmount)} · TutorMint ${rs(o.ourAmount)}`,
        day: o.datePaid,
        red: true,
      })
    }
    if (o.state === 'waiting' || o.state === 'settled_no_credit') {
      attention.push({
        kind: 'waiting',
        icon: '⏳',
        title: o.state === 'waiting' ? `Paid, not settled yet: ${o.orderNumber}` : `PayPro says settled, no bank credit yet: ${o.orderNumber}`,
        detail: `${o.method} · ${rs(o.merchantShare)}${days(o.ageDays)}${o.overdue ? ' · overdue' : ''}`,
        day: o.state === 'waiting' ? o.datePaid : o.settleDate,
        red: o.overdue,
      })
    }
  }
  for (const p of board.missingFromExport.filter((p) => inMonth(p.approvedDay))) {
    attention.push({
      kind: 'not_in_export',
      icon: '⚠️',
      title: `In TutorMint, not in the PayPro export: ${p.ref}`,
      detail: rs(p.amountPkr),
      day: p.approvedDay,
      red: true,
    })
  }
  for (const r of receipts) {
    if (r.state !== 'waiting') continue
    attention.push({
      kind: 'waiting',
      icon: '⏳',
      title: `Bank transfer approved, no bank credit yet: ${r.ref}`,
      detail: `${rs(r.amountPkr)}${r.payerName ? ` · ${r.payerName}` : ''}${days(r.ageDays)}${r.overdue ? ' · overdue' : ''}`,
      day: r.approvedDay,
      red: r.overdue,
    })
  }
  attention.sort((a, b) => Number(b.red) - Number(a.red) || (b.day ?? '').localeCompare(a.day ?? ''))

  const paid = orders.filter((o) => o.state !== 'not_paid')
  const received = round2(
    ourPaypro.filter((p) => p.status === 'approved' && inMonth(p.approvedDay)).reduce((s, p) => s + p.amountPkr, 0) + receipts.reduce((s, r) => s + r.amountPkr, 0),
  )

  return {
    month,
    cards: {
      received,
      fees: round2(paid.reduce((s, o) => s + (o.fee ?? 0), 0)),
      netSettled: round2(matched.reduce((s, c) => s + c.amountPkr, 0)),
      waiting: round2(
        paid.filter((o) => o.state !== 'matched').reduce((s, o) => s + (o.merchantShare ?? 0), 0) + receipts.filter((r) => r.state === 'waiting').reduce((s, r) => s + r.amountPkr, 0),
      ),
      unmatched: attention.filter((a) => a.kind !== 'waiting' || a.red).length,
    },
    attention,
    matched,
    orders,
    receipts,
    credits,
    feeTable: feeTable(board.orders),
  }
}

/** Per method per month: what the gateway kept, and the fee on one order. */
export function feeTable(orders: OrderView[]): FeeRow[] {
  const by = new Map<string, FeeRow>()
  for (const o of orders) {
    if (o.state === 'not_paid' || !o.datePaid || o.fee === null) continue
    const month = o.datePaid.slice(0, 7)
    const k = `${month}|${o.method}`
    const row = by.get(k) ?? { month, method: o.method, orders: 0, amount: 0, fees: 0, perOrder: [] }
    row.orders += 1
    row.amount = round2(row.amount + (o.orderAmount ?? 0))
    row.fees = round2(row.fees + o.fee)
    if (!row.perOrder.includes(o.fee)) row.perOrder.push(o.fee)
    by.set(k, row)
  }
  return [...by.values()]
    .map((r) => ({ ...r, perOrder: r.perOrder.sort((a, b) => a - b) }))
    .sort((a, b) => b.month.localeCompare(a.month) || a.method.localeCompare(b.method))
}

const csvCell = (v: string | number | null | undefined) => {
  let s = v === null || v === undefined ? '' : String(v)
  // A cell starting with = + - @ is run as a formula by spreadsheets.
  if (/^[=+\-@]/.test(s) && typeof v !== 'number') s = `'${s}`
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const ORDER_STATE: Record<OrderState, string> = {
  matched: 'Matched',
  waiting: 'Paid, not settled yet',
  settled_no_credit: 'Settled by PayPro, no bank credit yet',
  not_paid: 'Not paid',
}

/** The month as one CSV. No member names, mobiles or emails. */
export function monthCsv(view: MonthView): string {
  const creditBy = new Map(view.credits.map((c) => [c.id, c]))
  const head = ['Type', 'Date', 'Reference', 'Method', 'Amount (Rs)', 'Merchant share (Rs)', 'Fee (Rs)', 'Settle date', 'Status', 'Bank credit date', 'Bank credit reference', 'Bank credit amount (Rs)']
  const lines: (string | number | null)[][] = [head]
  const credit = (id: string | null) => {
    const c = id ? creditBy.get(id) : undefined
    return [c?.date ?? '', c?.reference ?? '', c?.amountPkr ?? '']
  }
  for (const o of view.orders) {
    lines.push(['PayPro order', o.datePaid, o.orderNumber, o.method, o.orderAmount, o.merchantShare, o.fee, o.settleDate, ORDER_STATE[o.state] + (o.overdue ? ' (overdue)' : ''), ...credit(o.creditId)])
  }
  for (const r of view.receipts) {
    lines.push(['Bank transfer', r.approvedDay, r.ref, 'Bank transfer', r.amountPkr, r.amountPkr, 0, '', r.state === 'matched' ? 'Matched' : 'No bank credit yet' + (r.overdue ? ' (overdue)' : ''), ...credit(r.creditId)])
  }
  for (const c of view.credits) {
    // An ignored credit is not a sale: it is listed on the page, never exported.
    if (c.state === 'ignored') continue
    const status = c.state === 'matched' ? (c.match!.status === 'amount_mismatch' ? 'Amount mismatch' : c.match!.status === 'manual' ? 'Matched by hand' : 'Matched') : 'Not matched'
    lines.push(['Bank credit', c.date, c.reference, c.isPaypro ? 'PayPro payout' : 'Bank transfer', c.amountPkr, '', '', '', status, c.date, c.reference, c.amountPkr])
  }
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------
// A bank alert email, pasted as text
// ---------------------------------------------------------------------------

export type ParsedAlert = {
  amountPkr: number | null
  date: string | null
  time: string | null
  senderName: string | null
  senderBank: string | null
  reference: string | null
}

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

export function findDate(text: string): string | null {
  const patterns = [
    /\b\d{4}-\d{1,2}-\d{1,2}\b/,
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/,
    /\b\d{1,2}[ -/][A-Za-z]{3,9}[ -/,]+\d{4}\b/,
    /\b[A-Za-z]{3,9} \d{1,2},? \d{4}\b/,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    const d = m ? parseDate(m[0]) : null
    if (d) return d
  }
  // 10-OCT-26
  const m = text.match(/\b(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{2})\b/)
  if (m && MON[m[2].toLowerCase()]) return parseDate(`${m[1]}-${m[2]}-20${m[3]}`)
  return null
}

export function findTime(text: string): string | null {
  const m = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?/)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  const ap = (m[3] ?? '').replace(/\./g, '').toLowerCase()
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const clean = (s: string | null | undefined) => {
  const v = (s ?? '').replace(/\s+/g, ' ').replace(/[.,;:\s]+$/, '').trim()
  return v === '' ? null : v
}

/**
 * Read a pasted bank alert (Faysal Bank's credit email, or an SMS) into the
 * fields of the "Add bank credit" form. It reads both shapes an alert comes in —
 * "Label: value" lines and one sentence — and returns null for anything it could
 * not find. The owner checks every field before saving; nothing is saved here.
 */
export function parseBankAlert(text: string): ParsedAlert {
  const src = text.replace(/\r/g, '')
  const flat = src.replace(/\s+/g, ' ')
  const lines = src.split('\n')
  const labelled = (names: string[]): string | null => {
    for (const name of names) {
      const re = new RegExp(`^\\s*${name.replace(/ /g, '\\s+')}\\s*(?:no\\.?|number|#)?\\s*[:=]\\s*(.+?)\\s*$`, 'i')
      for (const line of lines) {
        const m = line.match(re)
        // "From: alerts@bank.com" is the email's own header, not the sender of the money.
        if (m && !/@/.test(m[1])) return m[1]
      }
    }
    return null
  }

  const amountText =
    labelled(['credit amount', 'transaction amount', 'amount credited', 'amount']) ??
    flat.match(/(?:PKR|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1] ??
    flat.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:PKR|Rs\b)/i)?.[1] ??
    null
  const amount = amountText ? parseAmount(amountText) : null

  const dateLine = labelled(['transaction date', 'value date', 'date and time', 'date & time', 'date/time', 'date'])
  const timeLine = labelled(['transaction time', 'time'])

  const senderName =
    labelled(['sender name', 'remitter name', 'from account title', 'received from', 'sender', 'remitter', 'from']) ??
    flat.match(/\bfrom\s+([A-Za-z0-9][A-Za-z0-9 .&'()-]{1,60}?)(?=\s+(?:via|through|on|at|a\/c|account|bank|ref|reference|with|dated|to)\b|[.,;]|$)/i)?.[1] ??
    null
  const senderBank =
    labelled(['sender bank', 'from bank', 'originating bank', 'remitting bank', 'bank name', 'bank']) ??
    flat.match(/\b(?:via|through)\s+([A-Za-z][A-Za-z .&-]{1,50}?)(?=\s+(?:on|at|ref|reference|with|dated|to)\b|[.,;]|$)/i)?.[1] ??
    null
  const reference =
    labelled(['transaction reference', 'transaction ref', 'transaction id', 'reference number', 'reference', 'ref', 'tid', 'stan', 'trx id', 'trace']) ??
    flat.match(/\b(?:transaction\s+(?:reference|ref|id)|reference(?:\s+(?:no|number))?|ref(?:\s+no)?|TID|STAN|Trx\s*ID)\.?\s*(?:is|:|#|-)?\s*([A-Za-z0-9][A-Za-z0-9/-]{5,})/i)?.[1] ??
    null

  return {
    amountPkr: amount !== null && amount > 0 ? amount : null,
    date: (dateLine ? findDate(dateLine) : null) ?? findDate(flat),
    time: (timeLine ? findTime(timeLine) : null) ?? (dateLine ? findTime(dateLine) : null) ?? findTime(flat),
    senderName: clean(senderName),
    senderBank: clean(senderBank),
    reference: clean(reference)?.replace(/\s.*$/, '') ?? null,
  }
}

/** Why a new bank credit is refused, in plain words; null when it is fine. */
export function creditProblem(c: { date: string; time: string | null; amountPkr: number; reference: string | null }, existingReferences: string[]): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) return 'Enter the date of the credit.'
  if (c.time !== null && !/^\d{2}:\d{2}$/.test(c.time)) return 'Enter the time like 14:35, or leave it empty.'
  if (!Number.isFinite(c.amountPkr) || c.amountPkr <= 0) return 'Enter the amount received, like 386.'
  const ref = alnum(c.reference)
  if (ref === '') return 'Enter the transaction reference from the bank alert.'
  if (existingReferences.some((r) => alnum(r) === ref)) return 'A bank credit with this reference is already recorded. It was not added again.'
  return null
}

// ---------------------------------------------------------------------------
// What a saved credit matched, in one line
// ---------------------------------------------------------------------------

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDay = (d: string) => `${Number(d.slice(8, 10))} ${SHORT_MONTH[Number(d.slice(5, 7)) - 1] ?? ''}`.trim()

/** "Matched to 2 JazzCash orders settled 9 Oct", or "No match yet". */
export function matchSummary(board: Board, creditId: string): { matched: boolean; text: string } {
  const c = board.credits.find((x) => x.id === creditId)
  const m = c?.match
  if (!c || !m) return { matched: false, text: 'No match yet' }
  const parts: string[] = []
  if (m.orders.length > 0) {
    const picked = m.orders.map((n) => board.orders.find((o) => orderKey(o.orderNumber) === orderKey(n))).filter((o): o is OrderView => !!o)
    const methods = [...new Set(picked.map((o) => o.method))]
    const settled = [...new Set(picked.map((o) => o.settleDate).filter((d): d is string => !!d))].sort()
    const method = methods.length === 1 && methods[0] !== 'Other' ? methods[0] : 'PayPro'
    parts.push(`${m.orders.length} ${method} order${m.orders.length === 1 ? '' : 's'}${settled.length > 0 ? ` settled ${settled.map(shortDay).join(', ')}` : ''}`)
  }
  if (m.receipts.length > 0) parts.push(`${m.receipts.length} bank transfer receipt${m.receipts.length === 1 ? '' : 's'}`)
  const tail =
    m.status === 'amount_mismatch' ? ` — amount mismatch, expected ${rs(m.expected)}` : m.status === 'bank_charge' ? ` (${rs(-m.difference)} bank charge)` : ''
  return { matched: true, text: `Matched to ${parts.join(' and ')}${tail}` }
}
