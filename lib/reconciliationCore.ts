// lib/reconciliationCore.ts
//
// PayPro reconciliation — the PURE half. No server imports, no database, so it
// runs in the route, on the page and under `tsx --test` alike
// (scripts/test-reconciliation.ts). lib/reconciliation.ts is the I/O wrapper.
//
// What this does: read PayPro's Orders export (xlsx cells or csv text) into the
// EIGHT columns we keep, compare those orders with our own `payments` rows
// (matched on payments.provider_ref = Order-Number), and sum what PayPro
// collected, what it owes us (MerchantShare), and what has actually reached the
// bank. It never decides anything about a payment's status — it reports.
//
// Personal columns in the export (customer name, mobile, email) are not mapped
// and therefore never leave this parser.

export type PayproRow = {
  orderNumber: string
  transactionStatus: string | null
  paymentVia: string | null
  orderAmount: number | null
  merchantShare: number | null
  /** ISO YYYY-MM-DD or null. */
  datePaid: string | null
  settleDate: string | null
  settleStatus: string | null
}

export type PaymentRef = {
  providerRef: string
  status: string
  amountPkr: number | null
}

export type Transfer = {
  /** ISO YYYY-MM-DD. */
  transferredOn: string
  amountPkr: number
  reference: string | null
  accountLast4: string | null
}

/** One line in a flag list: the order, what we say, what PayPro says. */
export type Flag = {
  orderNumber: string
  /** Our payments.status, or null when we have no row for this order. */
  ourStatus: string | null
  /** PayPro's Transaction Status, or null when the order is not in the file. */
  payproStatus: string | null
  orderAmount: number | null
  amountPkr: number | null
  datePaid: string | null
}

export type MatchResult = {
  /** PAID at PayPro, but our row is missing or not 'approved'. */
  paidNotApproved: Flag[]
  /** Approved here, but absent from the file or not PAID there. */
  approvedNotPaid: Flag[]
  /** Both sides have the order and the amounts differ. */
  amountDifferences: Flag[]
  /** Both sides agree: PAID, approved, same amount. */
  matched: Flag[]
}

export type SettlementMatch = {
  orderNumber: string
  settleDate: string
  settleStatus: string | null
  merchantShare: number | null
  /** Sum of bank transfers dated on the Settle-Date. */
  transferredThatDay: number
  /** Sum of MerchantShare of every order settling that day. */
  shareThatDay: number
  /** transferredThatDay >= shareThatDay */
  covered: boolean
}

export type Summary = {
  /** Sum of Order-Amount for PAID orders with Date Paid in the period. */
  collected: number
  /** Sum of MerchantShare for the same orders — what PayPro should pass on. */
  expected: number
  /** Sum of bank transfers with transferred_on in the period. */
  transfersReceived: number
  /** expected - transfersReceived. Positive = PayPro still owes us. */
  owed: number
  paidCount: number
  transferCount: number
  settlementMatches: SettlementMatch[]
}

export type Period = { from: string | null; to: string | null }

export type SheetCell = string | number | boolean | Date | null | undefined

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/** "Order-Number" → "ordernumber": case, spaces and punctuation do not matter. */
export function normaliseHeader(h: SheetCell): string {
  return cellText(h).toLowerCase().replace(/[^a-z0-9]/g, '')
}

const PAYPRO_HEADERS: Record<string, keyof PayproRow> = {
  ordernumber: 'orderNumber',
  transactionstatus: 'transactionStatus',
  paymentvia: 'paymentVia',
  orderamount: 'orderAmount',
  merchantshare: 'merchantShare',
  datepaid: 'datePaid',
  settledate: 'settleDate',
  settlestatus: 'settleStatus',
}

/** Column index per PayPro field for a header row, or null if it is not one. */
function mapPayproHeader(row: SheetCell[]): Partial<Record<keyof PayproRow, number>> | null {
  const map: Partial<Record<keyof PayproRow, number>> = {}
  row.forEach((cell, i) => {
    const key = PAYPRO_HEADERS[normaliseHeader(cell)]
    if (key && map[key] === undefined) map[key] = i
  })
  return map.orderNumber === undefined ? null : map
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export function cellText(v: SheetCell): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  return String(v).trim()
}

function textOrNull(v: SheetCell): string | null {
  const s = cellText(v)
  return s === '' ? null : s
}

/** "Rs 1,199.00", "PKR 199", "199" or 199 → 199. Anything else → null. */
export function parseAmount(v: SheetCell): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean' || v instanceof Date) return null
  const cleaned = v.replace(/[^0-9.\-()]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  // "(199)" is an accountant's negative.
  const negative = /^\(.*\)$/.test(cleaned) || cleaned.startsWith('-')
  const n = Number(cleaned.replace(/[()\-]/g, ''))
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  // Reject 31 Feb and friends: Date.UTC rolls them over.
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

/** Excel serial day (1900 date system) → ISO date. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null
  const ms = Math.round((serial - 25569) * 86400 * 1000) // 25569 = 1970-01-01
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Dates in the shapes PayPro and Excel produce → ISO YYYY-MM-DD, or null.
 *
 *   2026-10-04 / 2026-10-04 15:23:20 / 2026-10-04T15:23:20Z
 *   04/10/2026 / 04-10-2026        day first (Pakistan)
 *   10/04/2026                     month first ONLY when the day-first reading
 *                                  is impossible (second part > 12); both ≤ 12
 *                                  is read day-first, never guessed the other way
 *   04-Oct-2026 / 04 Oct 2026 / Oct 4, 2026
 *   46024 (Excel serial), a Date object
 */
export function parseDate(v: SheetCell): string | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  if (typeof v === 'number') return excelSerialToIso(v)

  const s = v.trim()
  if (s === '') return null
  // A whole number typed as text is still an Excel serial.
  if (/^\d{5}$/.test(s)) return excelSerialToIso(Number(s))

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/)
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]))

  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T].*)?$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const y = Number(m[3])
    // Day-first unless that reading is impossible and month-first is not.
    if (a > 12 && b <= 12) return iso(y, b, a)
    if (b > 12 && a <= 12) return iso(y, a, b)
    return iso(y, b, a)
  }

  m = s.match(/^(\d{1,2})[ \-/]([A-Za-z]{3,9})[ \-/,]+(\d{4})(?:[ T].*)?$/)
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()]
    return mon ? iso(Number(m[3]), mon, Number(m[1])) : null
  }

  m = s.match(/^([A-Za-z]{3,9})[ \-/]+(\d{1,2}),?[ \-/]+(\d{4})(?:[ T].*)?$/)
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()]
    return mon ? iso(Number(m[3]), mon, Number(m[2])) : null
  }

  return null
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * A table of cells (header row somewhere in the first ten rows — PayPro's
 * export sometimes carries a title line) → PayproRow[].
 *
 * A row with an EMPTY Order-Number is skipped: that is the totals row at the
 * foot of the export, and anything else without an order is not an order.
 */
export function rowsFromSheet(cells: SheetCell[][]): PayproRow[] {
  let headerAt = -1
  let map: Partial<Record<keyof PayproRow, number>> | null = null
  for (let i = 0; i < Math.min(cells.length, 10); i++) {
    map = mapPayproHeader(cells[i] ?? [])
    if (map) {
      headerAt = i
      break
    }
  }
  if (!map || headerAt < 0) return []

  const at = (row: SheetCell[], key: keyof PayproRow): SheetCell => {
    const i = map![key]
    return i === undefined ? null : row[i]
  }

  const out: PayproRow[] = []
  for (const row of cells.slice(headerAt + 1)) {
    const orderNumber = cellText(at(row, 'orderNumber'))
    if (orderNumber === '') continue
    out.push({
      orderNumber,
      transactionStatus: textOrNull(at(row, 'transactionStatus')),
      paymentVia: textOrNull(at(row, 'paymentVia')),
      orderAmount: parseAmount(at(row, 'orderAmount')),
      merchantShare: parseAmount(at(row, 'merchantShare')),
      datePaid: parseDate(at(row, 'datePaid')),
      settleDate: parseDate(at(row, 'settleDate')),
      settleStatus: textOrNull(at(row, 'settleStatus')),
    })
  }
  return out
}

/** RFC-4180-ish CSV: quotes, doubled quotes, CRLF, a UTF-8 BOM. */
export function parseCsvTable(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  // Drop fully blank lines.
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export function parsePayproCsv(text: string): PayproRow[] {
  return rowsFromSheet(parseCsvTable(text))
}

// ---------------------------------------------------------------------------
// Status + matching
// ---------------------------------------------------------------------------

/** PayPro's PAID (any case); SUCCESS / Successful read the same way. */
export function isPaid(status: string | null | undefined): boolean {
  if (!status) return false
  const s = status.trim().toLowerCase()
  return s === 'paid' || s === 'success' || s === 'successful'
}

const key = (ref: string) => ref.trim().toUpperCase()

const near = (a: number | null, b: number | null) =>
  a === null || b === null ? true : Math.abs(a - b) < 0.005

function flag(row: PayproRow | undefined, payment: PaymentRef | undefined, orderNumber: string): Flag {
  return {
    orderNumber,
    ourStatus: payment?.status ?? null,
    payproStatus: row?.transactionStatus ?? null,
    orderAmount: row?.orderAmount ?? null,
    amountPkr: payment?.amountPkr ?? null,
    datePaid: row?.datePaid ?? null,
  }
}

/**
 * Compare the file with our payments. Match is payments.provider_ref ===
 * Order-Number (trimmed, case-insensitive). When the file carries the same
 * order twice, a PAID line wins over a non-paid one.
 */
export function matchRows(rows: PayproRow[], payments: PaymentRef[]): MatchResult {
  const byOrder = new Map<string, PayproRow>()
  for (const r of rows) {
    const k = key(r.orderNumber)
    const have = byOrder.get(k)
    if (!have || (!isPaid(have.transactionStatus) && isPaid(r.transactionStatus))) byOrder.set(k, r)
  }
  const byRef = new Map<string, PaymentRef>()
  for (const p of payments) {
    if (p.providerRef) byRef.set(key(p.providerRef), p)
  }

  const paidNotApproved: Flag[] = []
  const approvedNotPaid: Flag[] = []
  const amountDifferences: Flag[] = []
  const matched: Flag[] = []

  for (const [k, row] of byOrder) {
    const payment = byRef.get(k)
    const paid = isPaid(row.transactionStatus)
    const approved = payment?.status === 'approved'

    if (paid && !approved) paidNotApproved.push(flag(row, payment, row.orderNumber))

    if (payment) {
      const same = near(row.orderAmount, payment.amountPkr)
      if (!same) amountDifferences.push(flag(row, payment, row.orderNumber))
      if (paid && approved && same) matched.push(flag(row, payment, row.orderNumber))
    }
  }

  for (const [k, payment] of byRef) {
    if (payment.status !== 'approved') continue
    const row = byOrder.get(k)
    if (!row || !isPaid(row.transactionStatus)) {
      approvedNotPaid.push(flag(row, payment, payment.providerRef.trim()))
    }
  }

  const byDate = (a: Flag, b: Flag) => (b.datePaid ?? '').localeCompare(a.datePaid ?? '') || a.orderNumber.localeCompare(b.orderNumber)
  paidNotApproved.sort(byDate)
  approvedNotPaid.sort(byDate)
  amountDifferences.sort(byDate)
  matched.sort(byDate)

  return { paidNotApproved, approvedNotPaid, amountDifferences, matched }
}

// ---------------------------------------------------------------------------
// Sums
// ---------------------------------------------------------------------------

export function inPeriod(isoDate: string | null, period: Period): boolean {
  if (!isoDate) return false
  if (period.from && isoDate < period.from) return false
  if (period.to && isoDate > period.to) return false
  return true
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function summarise(rows: PayproRow[], transfers: Transfer[], period: Period): Summary {
  const paid = rows.filter((r) => isPaid(r.transactionStatus))
  const paidInPeriod = paid.filter((r) => inPeriod(r.datePaid, period))

  const collected = round2(paidInPeriod.reduce((s, r) => s + (r.orderAmount ?? 0), 0))
  const expected = round2(paidInPeriod.reduce((s, r) => s + (r.merchantShare ?? 0), 0))

  const transfersInPeriod = transfers.filter((t) => inPeriod(t.transferredOn, period))
  const transfersReceived = round2(transfersInPeriod.reduce((s, t) => s + t.amountPkr, 0))

  // Settlements: every PAID order with a Settle-Date whose settle OR paid date
  // falls in the period (a payment taken on the 30th settles in the next month).
  const transfersByDay = new Map<string, number>()
  for (const t of transfers) transfersByDay.set(t.transferredOn, (transfersByDay.get(t.transferredOn) ?? 0) + t.amountPkr)

  const settling = paid.filter(
    (r) => r.settleDate && (inPeriod(r.settleDate, period) || inPeriod(r.datePaid, period)),
  )
  const shareByDay = new Map<string, number>()
  for (const r of settling) shareByDay.set(r.settleDate!, (shareByDay.get(r.settleDate!) ?? 0) + (r.merchantShare ?? 0))

  const settlementMatches: SettlementMatch[] = settling
    .map((r) => {
      const day = r.settleDate!
      const transferredThatDay = round2(transfersByDay.get(day) ?? 0)
      const shareThatDay = round2(shareByDay.get(day) ?? 0)
      return {
        orderNumber: r.orderNumber,
        settleDate: day,
        settleStatus: r.settleStatus,
        merchantShare: r.merchantShare,
        transferredThatDay,
        shareThatDay,
        covered: transferredThatDay + 0.005 >= shareThatDay,
      }
    })
    .sort((a, b) => b.settleDate.localeCompare(a.settleDate) || a.orderNumber.localeCompare(b.orderNumber))

  return {
    collected,
    expected,
    transfersReceived,
    owed: round2(expected - transfersReceived),
    paidCount: paidInPeriod.length,
    transferCount: transfersInPeriod.length,
    settlementMatches,
  }
}

// ---------------------------------------------------------------------------
// Bank statement CSV
// ---------------------------------------------------------------------------

/** Last four digits of whatever the account column holds, or null. */
export function accountLast4(v: SheetCell): string | null {
  const digits = cellText(v).replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : null
}

function pickColumn(headers: string[], prefer: string[], fallback: (h: string) => boolean): number {
  for (const p of prefer) {
    const i = headers.indexOf(p)
    if (i >= 0) return i
  }
  return headers.findIndex(fallback)
}

/**
 * A bank statement CSV → transfers. Columns are found by name, loosely: a date
 * column (value date / transaction date / date), an amount column (Credit
 * first — money IN — then Amount), a reference-ish column, an account column.
 * Rows without a date or a positive amount are skipped (a debit line has an
 * empty Credit cell). Account numbers keep their last four digits only.
 */
export function parseBankCsv(text: string): Transfer[] {
  const table = parseCsvTable(text)
  if (table.length === 0) return []

  let headerAt = -1
  let headers: string[] = []
  for (let i = 0; i < Math.min(table.length, 10); i++) {
    const h = table[i].map(normaliseHeader)
    const hasDate = h.some((x) => x.includes('date'))
    const hasAmount = h.some((x) => x.includes('amount') || x.includes('credit'))
    if (hasDate && hasAmount) {
      headerAt = i
      headers = h
      break
    }
  }
  if (headerAt < 0) return []

  const dateCol = pickColumn(headers, ['valuedate', 'transactiondate', 'date', 'transferdate', 'postingdate'], (h) => h.includes('date'))
  const amountCol = pickColumn(headers, ['credit', 'creditamount', 'amount', 'amountpkr'], (h) => h.includes('credit') || h.includes('amount'))
  const refCol = pickColumn(
    headers,
    ['reference', 'ref', 'referenceno', 'description', 'narration', 'particulars', 'details', 'remarks'],
    (h) => /ref|descr|narrat|particular|detail|remark/.test(h),
  )
  const accountCol = pickColumn(headers, ['account', 'accountno', 'accountnumber', 'iban', 'acct'], (h) => /account|iban|acct/.test(h))

  const out: Transfer[] = []
  for (const row of table.slice(headerAt + 1)) {
    const transferredOn = parseDate(row[dateCol] ?? null)
    const amount = parseAmount(row[amountCol] ?? null)
    if (!transferredOn || amount === null || amount <= 0) continue
    out.push({
      transferredOn,
      amountPkr: amount,
      reference: refCol >= 0 ? textOrNull(row[refCol]) : null,
      accountLast4: accountCol >= 0 ? accountLast4(row[accountCol]) : null,
    })
  }
  return out
}

/** "Rs 1,199" for the screen. */
export function pkr(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `Rs ${n.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`
}
