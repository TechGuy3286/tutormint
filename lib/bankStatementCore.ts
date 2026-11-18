// lib/bankStatementCore.ts — PURE (owner, 17 Nov 2026 — PR-03).
//
// Faysal Bank statement import. The bank's portal exports the account
// statement as an ".xls" that is really an HTML table, header row:
//   Serial no, Tran Seq No, Tran Date, Effect Date, Tran Type, Tran Description,
//   Stan, Debit/Credit, Reference, Withdrawal Amount, Deposit Amount, Balance,
//   Ref Bank, Time Stamp, Transfer Account No, Transfer Account Title,
//   Transfer Branch, Transfer Branch Name, Branch, Ref.1, Ref.2, Ref.3
// Values may be wrapped as ="..." and amounts carry commas. The first data row
// is "*** OPENING BALANCE ***".
//
// This file: parsing, classification, de-duplication against credits already
// recorded, matching fee credits to members and payments, the four result
// lists, and PayPro's real fee (each settlement of N × 193 covers N payments of
// Rs 199). No I/O — the I/O half is lib/bankStatement.ts. Unit-tested by
// scripts/test-bank-statement.ts on an INVENTED statement in the same format.
//
// Nothing here logs or returns a full account number, mobile or reference for
// display: masked() keeps the last four digits.

import { inFeeRange, namesMatch, nameTokens, type FeeRange } from './feeMatchCore'
import { normalisePkMobile } from './phone'

// =========================================================================
// Parsing

export const PAYPRO_CONTRA_ACCOUNT = '137801949'
export const OPENING_BALANCE_MARK = 'OPENING BALANCE'

const HEADERS = {
  serial: 'serial no',
  seq: 'tran seq no',
  date: 'tran date',
  effect: 'effect date',
  type: 'tran type',
  desc: 'tran description',
  stan: 'stan',
  dc: 'debit/credit',
  ref: 'reference',
  withdrawal: 'withdrawal amount',
  deposit: 'deposit amount',
  balance: 'balance',
  refBank: 'ref bank',
  stamp: 'time stamp',
  accNo: 'transfer account no',
  accTitle: 'transfer account title',
} as const
type HeaderKey = keyof typeof HEADERS

export type StatementRow = {
  serialNo: number | null
  seqNo: string
  date: string
  effectDate: string | null
  time: string | null
  type: string | null
  description: string
  stan: string | null
  debitCredit: 'D' | 'C' | null
  reference: string | null
  withdrawal: number
  deposit: number
  balance: number | null
  refBank: string | null
  timeStamp: string | null
  transferAccountNo: string | null
  transferAccountTitle: string | null
}

export type ParsedStatement = {
  rows: StatementRow[]
  openingBalance: number | null
  /** Rows the file repeats (same Tran Seq No twice in one file) — kept once. */
  repeatedInFile: number
  /** Data rows that could not be read (no seq no or no date). */
  unreadable: number
}

export type StatementParseError = { error: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#160': ' ' }

/** One cell's text: tags stripped, entities decoded, ="…" unwrapped, trimmed. */
export function cellText(raw: string): string {
  let s = raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) || m : m))
    .replace(/[\s ]+/g, ' ')
    .trim()
  const wrapped = s.match(/^="?(.*?)"?$/)
  if (s.startsWith('=') && wrapped) s = wrapped[1].trim()
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) s = s.slice(1, -1).trim()
  return s
}

/** "1,234.50" → 1234.5; blank / "-" → 0. */
export function amountOf(v: string | null | undefined): number {
  const s = (v ?? '').replace(/[,\s]/g, '').replace(/^Rs\.?/i, '')
  if (!s || s === '-') return 0
  const neg = /^\(.*\)$/.test(s)
  const n = Number(s.replace(/[()]/g, ''))
  if (!Number.isFinite(n)) return 0
  return Math.round((neg ? -n : n) * 100) / 100
}

function balanceOf(v: string | null | undefined): number | null {
  const s = (v ?? '').trim()
  if (!s) return null
  const n = amountOf(s.replace(/\s*(CR|DR)$/i, ''))
  return /DR$/i.test(s) ? -n : n
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** "17-Sep-2026" / "17-SEP-26" / "17/09/2026" / "2026-09-17" → "2026-09-17". */
export function dayOf(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  let y: number, mo: number, d: number
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  const named = s.match(/(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,]+(\d{2,4})/)
  const num = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (iso) [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (named) [d, mo, y] = [Number(named[1]), MONTHS[named[2].slice(0, 3).toLowerCase()] ?? 0, Number(named[3])]
  else if (num) [d, mo, y] = [Number(num[1]), Number(num[2]), Number(num[3])]
  else return null
  if (y < 100) y += 2000
  if (!mo || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** "17-SEP-26 11.23.45.123 PM" / "2026-09-17 23:23:45" → "23:23". */
export function timeOf(v: string | null | undefined): string | null {
  const m = (v ?? '').match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:[.:]\d+)?\s*([AaPp][Mm])?/)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  const ap = m[4]?.toLowerCase()
  if (ap) {
    if (h < 1 || h > 12) return null
    if (ap === 'pm' && h !== 12) h += 12
    if (ap === 'am' && h === 12) h = 0
  }
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const norm = (h: string) =>
  h
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s*\/\s*/g, '/')
    .replace(/[.:]+$/, '')
    .trim()

function tableRows(html: string): string[][] {
  const out: string[][] = []
  const rowRe = /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(html))) {
    const cells: string[] = []
    const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi
    let c: RegExpExecArray | null
    while ((c = cellRe.exec(m[1]))) cells.push(cellText(c[1].replace(/<\/t[dh]>/gi, '')))
    if (cells.length) out.push(cells)
  }
  return out
}

/** Read a Faysal statement export. Never throws; an unreadable file returns an error. */
export function parseStatement(html: string): ParsedStatement | StatementParseError {
  if (!/<t[rd]\b/i.test(html)) return { error: 'This is not the Faysal Bank statement file. Download the account statement (.xls) from the bank portal and upload it as it is.' }
  const rows = tableRows(html)
  const hi = rows.findIndex((r) => r.some((c) => norm(c) === HEADERS.seq))
  if (hi < 0) return { error: 'This file has no "Tran Seq No" column, so it is not the Faysal Bank statement.' }
  const header = rows[hi].map(norm)
  const col = {} as Record<HeaderKey, number>
  for (const k of Object.keys(HEADERS) as HeaderKey[]) col[k] = header.indexOf(HEADERS[k])
  const needed: HeaderKey[] = ['seq', 'date', 'desc', 'withdrawal', 'deposit']
  const missing = needed.filter((k) => col[k] < 0)
  if (missing.length) return { error: `Missing column: ${missing.map((k) => HEADERS[k]).join(', ')}.` }

  const get = (r: string[], k: HeaderKey) => (col[k] >= 0 ? (r[col[k]] ?? '').trim() : '')
  const seen = new Set<string>()
  const out: StatementRow[] = []
  let opening: number | null = null
  let repeated = 0
  let unreadable = 0
  for (const r of rows.slice(hi + 1)) {
    if (r.every((c) => !c)) continue
    const desc = get(r, 'desc')
    const joined = r.join(' ').toUpperCase()
    if (joined.includes(OPENING_BALANCE_MARK)) {
      opening = balanceOf(get(r, 'balance'))
      continue
    }
    const seq = get(r, 'seq').replace(/\s/g, '')
    const date = dayOf(get(r, 'date'))
    if (!seq || !date) {
      // A totals or closing line has no sequence number; anything else is unreadable.
      if (!/TOTAL|CLOSING/.test(joined)) unreadable++
      continue
    }
    if (seen.has(seq)) {
      repeated++
      continue
    }
    seen.add(seq)
    const dcRaw = get(r, 'dc').toUpperCase()
    const stamp = get(r, 'stamp') || null
    out.push({
      serialNo: Number.isFinite(Number(get(r, 'serial'))) && get(r, 'serial') ? Number(get(r, 'serial')) : null,
      seqNo: seq,
      date,
      effectDate: dayOf(get(r, 'effect')),
      time: timeOf(stamp),
      type: get(r, 'type').toUpperCase() || null,
      description: desc,
      stan: get(r, 'stan') || null,
      debitCredit: dcRaw.startsWith('D') ? 'D' : dcRaw.startsWith('C') ? 'C' : null,
      reference: get(r, 'ref') || null,
      withdrawal: Math.abs(amountOf(get(r, 'withdrawal'))),
      deposit: Math.abs(amountOf(get(r, 'deposit'))),
      balance: balanceOf(get(r, 'balance')),
      refBank: get(r, 'refBank') || null,
      timeStamp: stamp,
      transferAccountNo: get(r, 'accNo').replace(/\s/g, '') || null,
      transferAccountTitle: get(r, 'accTitle') || null,
    })
  }
  if (!out.length && opening === null) return { error: 'No transactions were found in this file.' }
  return { rows: out, openingBalance: opening, repeatedInFile: repeated, unreadable }
}

// =========================================================================
// What a description says

export type DescriptionFacts = {
  senderName: string | null
  senderBank: string | null
  last4: string | null
  /** The Raast REF# value. */
  raastRef: string | null
  /** The number after CONTRA ACCT:, digits only. */
  contra: string | null
}

export function descriptionFacts(desc: string): DescriptionFacts {
  const d = desc.replace(/\s+/g, ' ').trim()
  const raast = d.match(/RAAST\s+FUND\s+RECEIVED\s+FROM\s+(.+?)\s+-\s+(.+?)\s+A\/?C\s*#?\s*\*?\s*(\d{2,})/i)
  const ref = d.match(/REF\s*#\s*:?\s*([A-Za-z0-9]+)/i)
  const contra = d.match(/CONTRA\s+ACCT\s*:?\s*([0-9 -]+)/i)
  return {
    senderName: raast ? raast[1].trim() : null,
    senderBank: raast ? raast[2].trim() : null,
    last4: raast ? raast[3].slice(-4) : null,
    raastRef: ref ? ref[1] : null,
    contra: contra ? contra[1].replace(/[^0-9]/g, '') || null : null,
  }
}

/** The member's mobile a credit came from, when the contra / transfer account is one. */
export function contraMobile(row: Pick<StatementRow, 'description' | 'transferAccountNo'>): string | null {
  const f = descriptionFacts(row.description)
  for (const v of [f.contra, row.transferAccountNo]) {
    const digits = (v ?? '').replace(/[^0-9]/g, '')
    if (!digits) continue
    if (/^(92|0)?3\d{9}$/.test(digits)) {
      const m = normalisePkMobile(digits)
      if (m) return m
    }
  }
  return null
}

/** "••••1234" — the most of an account or mobile number shown by default. */
export function masked(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/[^0-9]/g, '')
  if (!d) return null
  return `••••${d.slice(-4)}`
}

// =========================================================================
// Classification

export type StatementClass = 'fee' | 'paypro' | 'other_credit' | 'debit'
export const CLASS_LABEL: Record<StatementClass, string> = {
  fee: 'Tutor / parent fee',
  paypro: 'PayPro settlement',
  other_credit: 'Other credit',
  debit: 'Withdrawal / expense',
}
export const STATEMENT_CLASSES = Object.keys(CLASS_LABEL) as StatementClass[]
export function isStatementClass(v: unknown): v is StatementClass {
  return typeof v === 'string' && v in CLASS_LABEL
}

/** Credits that count as a fee: Rs 199 and Rs 200, plus any current plan price. */
export function feeAmounts(planPrices: readonly number[]): Set<number> {
  return new Set([199, 200, ...planPrices.filter((p) => Number.isFinite(p) && p > 0)])
}

export function classifyRow(row: Pick<StatementRow, 'description' | 'withdrawal' | 'deposit' | 'transferAccountNo'>, fees: ReadonlySet<number>): StatementClass {
  if (row.deposit <= 0 && row.withdrawal > 0) return 'debit'
  if (row.deposit <= 0) return 'debit'
  const f = descriptionFacts(row.description)
  if (f.contra === PAYPRO_CONTRA_ACCOUNT || (row.transferAccountNo ?? '').replace(/[^0-9]/g, '') === PAYPRO_CONTRA_ACCOUNT) return 'paypro'
  if (fees.has(row.deposit)) return 'fee'
  return 'other_credit'
}

/** Large non-fee credits worth marking "Not business (personal)" — a suggestion only. */
export const PERSONAL_SUGGEST_MIN = 5_000
export function suggestPersonal(row: Pick<StatementRow, 'deposit' | 'type'>, cls: StatementClass): boolean {
  if (cls !== 'other_credit') return false
  if (row.deposit >= PERSONAL_SUGGEST_MIN) return true
  return ['CQCC', 'IBFC'].includes((row.type ?? '').toUpperCase())
}

/** The sender name a credit shows: the Raast name, else the transfer account title. */
export function senderOf(row: Pick<StatementRow, 'description' | 'transferAccountTitle'>, cls: StatementClass): string | null {
  if (cls === 'paypro') return 'PayPro (settlement)'
  return descriptionFacts(row.description).senderName ?? row.transferAccountTitle ?? null
}

// =========================================================================
// Import summary

export type ImportSummary = {
  rowsTotal: number
  rowsNew: number
  rowsDuplicate: number
  totalCredits: number
  totalDebits: number
  openingBalance: number | null
  closingBalanceFile: number | null
  closingBalanceComputed: number | null
  balanceMatches: boolean | null
  periodFrom: string | null
  periodTo: string | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function importSummary(p: ParsedStatement, existingSeqNos: ReadonlySet<string>): ImportSummary {
  const ordered = [...p.rows].sort((a, b) => (a.serialNo ?? 0) - (b.serialNo ?? 0) || a.date.localeCompare(b.date))
  const credits = r2(p.rows.reduce((s, r) => s + r.deposit, 0))
  const debits = r2(p.rows.reduce((s, r) => s + r.withdrawal, 0))
  const last = [...ordered].reverse().find((r) => r.balance !== null) ?? null
  const fileClose = last?.balance ?? null
  const computed = p.openingBalance === null ? null : r2(p.openingBalance + credits - debits)
  const dup = p.rows.filter((r) => existingSeqNos.has(r.seqNo)).length
  const days = p.rows.map((r) => r.date).sort()
  return {
    rowsTotal: p.rows.length,
    rowsNew: p.rows.length - dup,
    rowsDuplicate: dup + p.repeatedInFile,
    totalCredits: credits,
    totalDebits: debits,
    openingBalance: p.openingBalance,
    closingBalanceFile: fileClose,
    closingBalanceComputed: computed,
    balanceMatches: fileClose === null || computed === null ? null : Math.abs(fileClose - computed) < 0.01,
    periodFrom: days[0] ?? null,
    periodTo: days[days.length - 1] ?? null,
  }
}

// =========================================================================
// One statement credit vs the bank credits already recorded (hand-entered,
// emailed). Same reference → the same money. Same amount and day (and time
// within 15 minutes when both have one, and a compatible sender) and only one
// → the same money. Several → unclear: nothing is added, the Owner decides.

export type RecordedCredit = {
  id: string
  reference: string | null
  amountPkr: number
  date: string
  time: string | null
  senderName: string | null
  source: string
  statementRowId: string | null
}

export type StatementCreditDecision =
  | { action: 'add' }
  | { action: 'link'; creditId: string; how: 'reference' | 'amount_day' }
  | { action: 'unclear'; reason: string }

const refKey = (v: string | null | undefined) => (v ?? '').replace(/\s/g, '').toUpperCase()
const nameKeyOf = (v: string | null | undefined) => nameTokens(v).join(' ')

function minutes(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  return Date.UTC(y, m - 1, d, h, mi) / 60000
}

export function statementRefs(row: Pick<StatementRow, 'reference' | 'stan' | 'description'>): string[] {
  const f = descriptionFacts(row.description)
  return [row.reference, f.raastRef, row.stan].map(refKey).filter((v) => v.length >= 6)
}

/** The recorded credits a statement credit may be the same money as — the
 *  candidates behind an "unclear" decision (PR-04): same amount, same day, a
 *  compatible sender, not already tied to another statement row. Closest time
 *  first. Shown under "Check: possibly already recorded". */
export function possibleDuplicates(
  row: Pick<StatementRow, 'deposit' | 'date' | 'time'> & { sender: string | null },
  recorded: readonly RecordedCredit[],
): RecordedCredit[] {
  const free = recorded.filter((c) => !c.statementRowId && c.source !== 'statement')
  const same = free.filter((c) => Math.abs(c.amountPkr - row.deposit) < 0.005 && c.date === row.date)
  const compatible = same.filter((c) => {
    const a = nameKeyOf(c.senderName)
    const b = nameKeyOf(row.sender)
    return !a || !b || a === b || namesMatch(c.senderName, row.sender) || /paypro/i.test(`${c.senderName} ${row.sender}`)
  })
  const gap = (c: RecordedCredit) => (c.time && row.time ? Math.abs(minutes(c.date, c.time) - minutes(row.date, row.time)) : 24 * 60)
  return [...compatible].sort((a, b) => gap(a) - gap(b) || a.id.localeCompare(b.id))
}

export function decideStatementCredit(
  row: Pick<StatementRow, 'reference' | 'stan' | 'description' | 'deposit' | 'date' | 'time'> & { sender: string | null },
  recorded: readonly RecordedCredit[],
): StatementCreditDecision {
  const refs = new Set(statementRefs(row))
  const free = recorded.filter((c) => !c.statementRowId && c.source !== 'statement')
  const byRef = free.find((c) => refs.size > 0 && refs.has(refKey(c.reference)))
  if (byRef) return { action: 'link', creditId: byRef.id, how: 'reference' }
  const same = free.filter((c) => Math.abs(c.amountPkr - row.deposit) < 0.005 && c.date === row.date)
  const compatible = same.filter((c) => {
    const a = nameKeyOf(c.senderName)
    const b = nameKeyOf(row.sender)
    return !a || !b || a === b || namesMatch(c.senderName, row.sender) || /paypro/i.test(`${c.senderName} ${row.sender}`)
  })
  const near: RecordedCredit[] = []
  let untimed = 0
  for (const c of compatible) {
    if (c.time && row.time) {
      if (Math.abs(minutes(c.date, c.time) - minutes(row.date, row.time)) <= 15) near.push(c)
    } else untimed++
  }
  if (near.length === 1 && untimed === 0) return { action: 'link', creditId: near[0].id, how: 'amount_day' }
  if (near.length === 0 && untimed === 1) {
    const only = compatible.find((c) => !(c.time && row.time))!
    return { action: 'link', creditId: only.id, how: 'amount_day' }
  }
  if (near.length + untimed > 1) return { action: 'unclear', reason: 'more than one recorded bank credit has the same amount that day' }
  return { action: 'add' }
}

// =========================================================================
// Fuzzy names: case, spacing, common spellings (Muhammad / Mohammad are
// already dropped as prefixes; ee → i, oo → u, doubled letters, ph → f, the
// silent h after a consonant, a final y → i).

export function spellingKey(token: string): string {
  return token
    .replace(/ph/g, 'f')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/([bcdgjkpstz])h/g, '$1')
    .replace(/(.)\1+/g, '$1')
    .replace(/y$/g, 'i')
}

function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/** Same person by name, allowing common spellings. Every word of the shorter
 *  name must match a word of the longer one; long words may differ by one letter. */
export function fuzzyNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (namesMatch(a, b)) return true
  const x = nameTokens(a).map(spellingKey).filter(Boolean)
  const y = nameTokens(b).map(spellingKey).filter(Boolean)
  if (!x.length || !y.length) return false
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length === 1 && long.length > 1) return false
  if (!short.some((t) => t.length >= 3)) return false
  const pool = [...long]
  for (const t of short) {
    const i = pool.findIndex((u) => u === t || (t.length >= 5 && u.length >= 5 && oneEditApart(t, u)))
    if (i < 0) return false
    pool.splice(i, 1)
  }
  return true
}

// =========================================================================
// Matching fee credits to payments and members

export const RECEIPT_WINDOW_DAYS = 3
export const APPROVED_WINDOW_DAYS = 7
export const MEMBER_WINDOW_DAYS = 60
const DAY_MS = 86_400_000

export type FeeCredit = {
  rowId: string
  transferId: string | null
  date: string
  time: string | null
  amount: number
  senderName: string | null
  refs: string[]
  mobile: string | null
  /** The bank credit is already linked to a payment, or set aside (ignored / personal). */
  settled: boolean
}

export type PendingReceipt = {
  id: string
  memberId: string | null
  memberName: string | null
  planCode: string | null
  amount: number
  createdAt: string
  reference: string | null
}

export type ApprovedBankPayment = {
  id: string
  memberId: string | null
  memberName: string | null
  planCode: string | null
  amount: number
  approvedAt: string
  /** When the receipt was uploaded (payments.created_at), when known (PR-04). */
  createdAt?: string | null
  /** A bank credit is already linked to it. */
  hasCredit: boolean
}

export type MatchMember = {
  id: string
  names: string[]
  /** Verified mobile and WhatsApp, as 92… MSISDN. */
  mobiles: string[]
  createdAt: string
  feePaid: boolean
}

export type MatchReason =
  | 'Raast name + amount + date'
  | 'Reference + amount + date'
  | 'Mobile number + amount + date'
  | 'Mobile number'
  | 'Name (close spelling) + amount + date'
  | 'Name (close spelling)'
  | 'Amount + date (only match)'
  | 'Amount + date'

/** The reason an automatic statement link carries — unique on both sides (PR-04). */
export const AUTO_PAIR_REASON: MatchReason = 'Amount + date (only match)'

export type CreditMatch =
  | { kind: 'settled' }
  | { kind: 'receipt'; paymentId: string; reason: MatchReason }
  | { kind: 'approved'; paymentId: string; reason: MatchReason; auto?: boolean }
  | { kind: 'member'; memberId: string; reason: MatchReason }
  | { kind: 'unmatched'; note: string | null; candidates?: string[] }

// =========================================================================
// Approved payments ↔ fee credits by amount and time (PR-04). The matching
// above needs a name, a reference or a mobile; most statement credits carry
// none ("CONTRA ACCT: …" with last-4 digits). So: same amount (Rs 199/200 for
// the fee, else the plan price), within ±2 days of the receipt upload OR the
// approval. Linked automatically ONLY when the pairing is unique on both sides —
// the credit has one candidate payment and that payment one candidate credit.
// Everything else is a suggestion, closest by time first.

export const APPROVED_PAIR_WINDOW_DAYS = 2

export type PairCredit = { rowId: string; date: string; time: string | null; amount: number }

export type ApprovedPairing = {
  /** Unique on both sides — link automatically. */
  auto: { rowId: string; paymentId: string }[]
  /** payment id → candidate credits, closest first. */
  forPayment: Map<string, string[]>
  /** credit row id → candidate payments, closest first. */
  forCredit: Map<string, string[]>
}

function pairGapMs(c: PairCredit, p: ApprovedBankPayment): number | null {
  const at = creditMs(c)
  const gaps = [p.createdAt, p.approvedAt].filter((v): v is string => !!v).map((v) => Math.abs(Date.parse(v) - at)).filter((g) => Number.isFinite(g))
  if (!gaps.length) return null
  const g = Math.min(...gaps)
  return g <= APPROVED_PAIR_WINDOW_DAYS * DAY_MS ? g : null
}

export function pairApprovedPayments(credits: readonly PairCredit[], payments: readonly ApprovedBankPayment[], range: FeeRange): ApprovedPairing {
  const forPayment = new Map<string, { id: string; gap: number }[]>()
  const forCredit = new Map<string, { id: string; gap: number }[]>()
  const open = payments.filter((p) => !p.hasCredit)
  for (const c of credits) {
    for (const p of open) {
      if (!amountFits(c.amount, p.planCode, p.amount, range)) continue
      const gap = pairGapMs(c, p)
      if (gap === null) continue
      forCredit.set(c.rowId, [...(forCredit.get(c.rowId) ?? []), { id: p.id, gap }])
      forPayment.set(p.id, [...(forPayment.get(p.id) ?? []), { id: c.rowId, gap }])
    }
  }
  const order = (xs: { id: string; gap: number }[]) => [...xs].sort((a, b) => a.gap - b.gap || a.id.localeCompare(b.id)).map((x) => x.id)
  const auto: ApprovedPairing['auto'] = []
  for (const [rowId, ps] of forCredit) {
    if (ps.length !== 1) continue
    const back = forPayment.get(ps[0].id) ?? []
    if (back.length === 1 && back[0].id === rowId) auto.push({ rowId, paymentId: ps[0].id })
  }
  auto.sort((a, b) => a.rowId.localeCompare(b.rowId))
  return {
    auto,
    forPayment: new Map([...forPayment].map(([k, v]) => [k, order(v)])),
    forCredit: new Map([...forCredit].map(([k, v]) => [k, order(v)])),
  }
}

/** One credit is linked to at most one payment, and one payment to at most one
 *  credit — the rule that keeps money from being counted twice (PR-04). Returns
 *  the offending ids, empty when the links are sound. */
export function doubleLinks(links: readonly { creditId: string; paymentId: string }[]): string[] {
  const credit = new Map<string, number>()
  const payment = new Map<string, number>()
  for (const l of links) {
    credit.set(l.creditId, (credit.get(l.creditId) ?? 0) + 1)
    payment.set(l.paymentId, (payment.get(l.paymentId) ?? 0) + 1)
  }
  return [...[...credit].filter(([, n]) => n > 1).map(([k]) => k), ...[...payment].filter(([, n]) => n > 1).map(([k]) => k)]
}

/** The money a set of statement rows puts in the bank totals: each row counts
 *  through the ONE bank credit it is tied to, and a bank credit counts once
 *  however many rows point at it ("Same money — link" adds nothing). Rows with
 *  no bank credit count nothing. */
export function bankMoneyCounted(
  rows: readonly { id: string; transferId: string | null }[],
  transfers: readonly { id: string; amountPkr: number; setAside?: boolean }[],
): number {
  const used = new Set(rows.map((r) => r.transferId).filter((v): v is string => !!v))
  return r2(transfers.filter((t) => used.has(t.id) && !t.setAside).reduce((s, t) => s + t.amountPkr, 0))
}

function creditMs(c: Pick<FeeCredit, 'date' | 'time'>): number {
  return Date.parse(`${c.date}T${c.time ?? '12:00'}:00+05:00`)
}

function amountFits(credit: number, plan: string | null, price: number, range: FeeRange): boolean {
  if (plan === 'verified') return inFeeRange(credit, range)
  return Math.abs(credit - price) < 0.005 || (credit >= price && credit - price <= 11)
}

function refMatches(credit: FeeCredit, ref: string | null): boolean {
  const k = refKey(ref)
  if (k.length < 6) return false
  return credit.refs.some((r) => r === k || r.includes(k) || k.includes(r))
}

export function matchFeeCredits(input: {
  credits: FeeCredit[]
  receipts: PendingReceipt[]
  approved: ApprovedBankPayment[]
  members: MatchMember[]
  range: FeeRange
}): Map<string, CreditMatch> {
  const out = new Map<string, CreditMatch>()
  const usedPay = new Set<string>()
  const usedMember = new Set<string>()
  const byMember = new Map(input.members.map((m) => [m.id, m]))
  const memberOfMobile = new Map<string, string[]>()
  for (const m of input.members) for (const mob of m.mobiles) memberOfMobile.set(mob, [...(memberOfMobile.get(mob) ?? []), m.id])
  const openApproved = input.approved.filter((p) => !p.hasCredit)

  const sorted = [...input.credits].sort((a, b) => creditMs(a) - creditMs(b) || a.rowId.localeCompare(b.rowId))
  for (const c of sorted) {
    if (c.settled) {
      out.set(c.rowId, { kind: 'settled' })
      continue
    }
    const at = creditMs(c)
    const receiptsIn = (days: number) =>
      input.receipts.filter((p) => !usedPay.has(p.id) && Math.abs(Date.parse(p.createdAt) - at) <= days * DAY_MS && amountFits(c.amount, p.planCode, p.amount, input.range))
    const approvedIn = (days: number) =>
      openApproved.filter((p) => !usedPay.has(p.id) && Math.abs(Date.parse(p.approvedAt) - at) <= days * DAY_MS && amountFits(c.amount, p.planCode, p.amount, input.range))
    const pick = (m: CreditMatch) => {
      out.set(c.rowId, m)
      if (m.kind === 'receipt' || m.kind === 'approved') usedPay.add(m.paymentId)
      if (m.kind === 'member') usedMember.add(m.memberId)
    }

    // (a) A pending receipt: same amount within ±3 days, the payer's name or their typed reference.
    const rec = receiptsIn(RECEIPT_WINDOW_DAYS)
    const byRef = rec.filter((p) => refMatches(c, p.reference))
    if (byRef.length === 1) {
      pick({ kind: 'receipt', paymentId: byRef[0].id, reason: 'Reference + amount + date' })
      continue
    }
    const byName = rec.filter((p) => namesMatch(c.senderName, p.memberName))
    if (byName.length === 1) {
      pick({ kind: 'receipt', paymentId: byName[0].id, reason: 'Raast name + amount + date' })
      continue
    }

    // (b) The credit came from a member's verified mobile or WhatsApp number.
    const mobileMembers = c.mobile ? (memberOfMobile.get(c.mobile) ?? []).filter((id) => byMember.has(id)) : []
    if (mobileMembers.length === 1) {
      const mid = mobileMembers[0]
      const r = rec.find((p) => p.memberId === mid)
      if (r) {
        pick({ kind: 'receipt', paymentId: r.id, reason: 'Mobile number + amount + date' })
        continue
      }
      const ap = approvedIn(APPROVED_WINDOW_DAYS).find((p) => p.memberId === mid)
      if (ap) {
        pick({ kind: 'approved', paymentId: ap.id, reason: 'Mobile number + amount + date' })
        continue
      }
      if (!byMember.get(mid)!.feePaid && !usedMember.has(mid)) {
        pick({ kind: 'member', memberId: mid, reason: 'Mobile number' })
        continue
      }
    }

    // (c) A close spelling of the name, within a time window.
    const fuzzyRec = rec.filter((p) => fuzzyNamesMatch(c.senderName, p.memberName))
    if (fuzzyRec.length === 1) {
      pick({ kind: 'receipt', paymentId: fuzzyRec[0].id, reason: 'Name (close spelling) + amount + date' })
      continue
    }
    const fuzzyAp = approvedIn(APPROVED_WINDOW_DAYS).filter((p) => fuzzyNamesMatch(c.senderName, p.memberName))
    if (fuzzyAp.length === 1) {
      pick({ kind: 'approved', paymentId: fuzzyAp[0].id, reason: 'Name (close spelling) + amount + date' })
      continue
    }
    const fuzzyMembers = input.members.filter(
      (m) =>
        !m.feePaid &&
        !usedMember.has(m.id) &&
        Date.parse(m.createdAt) <= at + DAY_MS &&
        at - Date.parse(m.createdAt) <= MEMBER_WINDOW_DAYS * DAY_MS &&
        m.names.some((n) => fuzzyNamesMatch(c.senderName, n)),
    )
    if (fuzzyMembers.length === 1) {
      pick({ kind: 'member', memberId: fuzzyMembers[0].id, reason: 'Name (close spelling)' })
      continue
    }
    pick({
      kind: 'unmatched',
      note: fuzzyMembers.length > 1 ? `${fuzzyMembers.length} members have a similar name` : mobileMembers.length > 1 ? MULTI_ACCOUNT_NOTE : null,
      // "That number is on more than one account": the Owner picks one (PR-04).
      ...(mobileMembers.length > 1 ? { candidates: mobileMembers } : fuzzyMembers.length > 1 ? { candidates: fuzzyMembers.map((m) => m.id) } : {}),
    })
  }

  // (d) PR-04: the credits still unmatched vs approved bank payments with no
  // credit, by amount and time. Unique on both sides → linked automatically.
  const left = sorted.filter((c) => out.get(c.rowId)?.kind === 'unmatched')
  const pairing = pairApprovedPayments(
    left.map((c) => ({ rowId: c.rowId, date: c.date, time: c.time, amount: c.amount })),
    openApproved.filter((p) => !usedPay.has(p.id)),
    input.range,
  )
  for (const a of pairing.auto) {
    out.set(a.rowId, { kind: 'approved', paymentId: a.paymentId, reason: AUTO_PAIR_REASON, auto: true })
    usedPay.add(a.paymentId)
  }
  return out
}

export const MULTI_ACCOUNT_NOTE = 'that number is on more than one account'

// =========================================================================
// The four result lists

export type ResultLists = {
  bankMatched: { rowId: string; paymentId: string; reason: MatchReason }[]
  paidNotRecorded: { rowId: string; memberId: string; reason: MatchReason }[]
  unmatched: { rowId: string; note: string | null; candidates: string[] }[]
  /** `suggestions` = every likely credit, the strongest first (PR-04). */
  approvedNoCredit: { paymentId: string; suggestion: { rowId: string; reason: MatchReason } | null; suggestions: { rowId: string; reason: MatchReason }[] }[]
}

/** Approved bank payments inside the statement's dates with no bank credit
 *  linked; each with the statement credit(s) that look like its own. A credit
 *  the matching tied to it comes first; then the closest unlinked credits of
 *  the same amount and window (`pairing`, PR-04). */
export function resultLists(
  matches: ReadonlyMap<string, CreditMatch>,
  approved: ApprovedBankPayment[],
  period: { from: string | null; to: string | null },
  pairing?: Pick<ApprovedPairing, 'forPayment'>,
): ResultLists {
  const lists: ResultLists = { bankMatched: [], paidNotRecorded: [], unmatched: [], approvedNoCredit: [] }
  const suggestionFor = new Map<string, { rowId: string; reason: MatchReason }>()
  const free = new Set<string>()
  for (const [rowId, m] of matches) {
    if (m.kind === 'receipt') lists.bankMatched.push({ rowId, paymentId: m.paymentId, reason: m.reason })
    else if (m.kind === 'member') lists.paidNotRecorded.push({ rowId, memberId: m.memberId, reason: m.reason })
    else if (m.kind === 'unmatched') {
      lists.unmatched.push({ rowId, note: m.note, candidates: m.candidates ?? [] })
      free.add(rowId)
    } else if (m.kind === 'approved') suggestionFor.set(m.paymentId, { rowId, reason: m.reason })
  }
  const pkd = (iso: string) => new Date(Date.parse(iso) + 5 * 3_600_000).toISOString().slice(0, 10)
  for (const p of approved) {
    if (p.hasCredit) continue
    const d = pkd(p.approvedAt)
    if (period.from && d < period.from) continue
    if (period.to && d > period.to) continue
    const first = suggestionFor.get(p.id) ?? null
    const more = (pairing?.forPayment.get(p.id) ?? []).filter((rowId) => free.has(rowId) && rowId !== first?.rowId).map((rowId) => ({ rowId, reason: 'Amount + date' as MatchReason }))
    const suggestions = [...(first ? [first] : []), ...more]
    lists.approvedNoCredit.push({ paymentId: p.id, suggestion: suggestions[0] ?? null, suggestions })
  }
  return lists
}

// =========================================================================
// PayPro's real fee. A settlement credit of N × 193 covers N payments of
// Rs 199: the fee is 199 − 193 = Rs 6 a payment. The bank may take Rs 1 from a
// transfer, so N × 193 − 1 also reads as N payments.

export type Settlement = { id: string; date: string; amount: number }
export type SettlementCount = { units: number; unit: number; fee: number; bankCharge: number } | null

/** How many Rs `price` payments one settlement covers, and the fee per payment. */
export function settlementUnits(amount: number, price = 199, maxFee = 20): SettlementCount {
  // An exact multiple first; only then allow the bank's Rs 1.
  for (const charge of [0, 1]) {
    for (let fee = 1; fee <= maxFee; fee++) {
      const unit = price - fee
      const total = r2(amount + charge)
      const n = total / unit
      if (n >= 1 && Math.abs(n - Math.round(n)) < 1e-9) return { units: Math.round(n), unit, fee, bankCharge: charge }
    }
  }
  return null
}

export type PayproPay = { id: string; paidAt: string; gross: number }
export type FeeAllocation = {
  /** payment id → PayPro's fee on it. */
  feeBy: Map<string, number>
  /** payment id → the settlement that paid it. */
  settledBy: Map<string, string>
  perSettlement: { id: string; date: string; amount: number; units: number | null; fee: number | null; covered: number; bankCharge: number }[]
  /** The usual fee per payment for an amount, from the settlements (for payments not settled yet). */
  usualFee: Map<number, number>
}

/** Allocate settlements to PayPro payments by date and count: each settlement
 *  covers the next N unsettled payments made on or before its date, oldest
 *  first. A payment no settlement covers yet takes the usual fee. */
export function allocatePayproFees(payments: PayproPay[], settlements: Settlement[], price = 199): FeeAllocation {
  const pays = [...payments].sort((a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt) || a.id.localeCompare(b.id))
  const sets = [...settlements].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const feeBy = new Map<string, number>()
  const settledBy = new Map<string, string>()
  const tally = new Map<number, number>()
  const perSettlement: FeeAllocation['perSettlement'] = []
  const pkDayOf = (iso: string) => new Date(Date.parse(iso) + 5 * 3_600_000).toISOString().slice(0, 10)
  for (const s of sets) {
    const count = settlementUnits(s.amount, price)
    if (!count) {
      perSettlement.push({ id: s.id, date: s.date, amount: s.amount, units: null, fee: null, covered: 0, bankCharge: 0 })
      continue
    }
    tally.set(count.fee, (tally.get(count.fee) ?? 0) + count.units)
    let covered = 0
    for (const p of pays) {
      if (covered >= count.units) break
      if (settledBy.has(p.id) || pkDayOf(p.paidAt) > s.date || Math.abs(p.gross - price) > 0.005) continue
      settledBy.set(p.id, s.id)
      feeBy.set(p.id, count.fee)
      covered++
    }
    perSettlement.push({ id: s.id, date: s.date, amount: s.amount, units: count.units, fee: count.fee, covered, bankCharge: count.bankCharge })
  }
  const usual = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
  const usualFee = new Map<number, number>()
  if (usual) usualFee.set(price, usual[0])
  for (const p of pays) if (!feeBy.has(p.id) && usualFee.has(p.gross)) feeBy.set(p.id, usualFee.get(p.gross)!)
  return { feeBy, settledBy, perSettlement, usualFee }
}

// =========================================================================
// Reopen and the 10-second Undo

export const DECISION_UNDO_MS = 10_000
/** The server allows a little longer than the button, for a slow connection. */
export const DECISION_UNDO_GRACE_MS = 60_000

export function undoDecisionProblem(
  p: { status: string; reviewedAt: string | null; reviewedBy: string | null; provider: string | null } | null,
  actorId: string,
  now: number,
): { status: number; error: string } | null {
  if (!p) return { status: 404, error: 'Payment not found.' }
  if (p.provider !== 'manual') return { status: 400, error: 'Only a bank-transfer decision can be undone here.' }
  if (p.status !== 'approved' && p.status !== 'rejected') return { status: 409, error: 'This payment has no decision to undo.' }
  if (p.reviewedBy !== actorId) return { status: 403, error: 'Only the person who decided can undo it.' }
  if (!p.reviewedAt || now - Date.parse(p.reviewedAt) > DECISION_UNDO_GRACE_MS) return { status: 409, error: 'Too late to undo. Use Reopen instead.' }
  return null
}

export function reopenProblem(p: { status: string; provider: string | null } | null, reason: string): { status: number; error: string } | null {
  if (!p) return { status: 404, error: 'Payment not found.' }
  if (p.provider !== 'manual') return { status: 400, error: 'Only a bank-transfer receipt can be reopened.' }
  if (p.status !== 'rejected') return { status: 409, error: 'Only a rejected receipt can be reopened.' }
  if (reason.trim().length < 3) return { status: 400, error: 'Give a short reason.' }
  return null
}
