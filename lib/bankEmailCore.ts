// lib/bankEmailCore.ts — PURE. The Faysal Bank email reader's rules (owner,
// 26 Oct 2026). No I/O, so the reader, the Finance screen and the tests read
// the same rules.
//
//   • safety lock — the mailbox must be bank-only: every sender of the last 30
//     days must be efbl@faysalbank.com or the mailbox provider's own system
//     mail; otherwise the reader stops before opening anything;
//   • DKIM — an email is accepted only when Authentication-Results shows a
//     DKIM pass for faysalbank.com;
//   • two alert formats (RAAST Fund Transfer, FBL Transaction Alert), credits
//     only ("Your account has been credited");
//   • what is kept — amount, date, time, sender name and bank, the LAST 4
//     digits of the sender account, the reference, the channel, the
//     Message-ID. Never the body, never the receiver's account number;
//   • dedupe — by the bank's reference, and against a credit already entered
//     by hand (same amount, within 15 minutes, same or blank sender name).

export const FAYSAL_SENDER = 'efbl@faysalbank.com'
export const FAYSAL_DKIM_DOMAIN = 'faysalbank.com'
/** Added to every email the reader has dealt with (never moved or deleted). */
export const READ_KEYWORD = 'TutorMintRead'
export const LOOKBACK_DAYS = 30
export const MANUAL_MATCH_WINDOW_MIN = 15
/** The reader failing for longer than this raises a red alert. */
export const FAILING_ALERT_MS = 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Safety lock

/** System-mail domains a mailbox provider sends from. The IMAP host's own
 *  registrable domain is added at run time (imap.hostinger.com → hostinger.com). */
export const BASE_SYSTEM_DOMAINS = ['google.com', 'hostinger.com'] as const

/** "imap.hostinger.com" → "hostinger.com". Two-part public suffixes (.com.pk) keep three parts. */
export function providerDomainOf(imapHost: string | null | undefined): string | null {
  const h = (imapHost ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!h || !h.includes('.') || /^\d+(\.\d+){3}$/.test(h)) return null
  const parts = h.split('.')
  const twoPart = /^(com|net|org|co|gov|edu)\.[a-z]{2}$/.test(parts.slice(-2).join('.'))
  return parts.slice(twoPart ? -3 : -2).join('.')
}

/** Gmail's own mailboxes are on gmail.com, but its system mail is google.com. */
export function systemDomains(imapHost: string | null | undefined): string[] {
  const out = new Set<string>(BASE_SYSTEM_DOMAINS)
  const p = providerDomainOf(imapHost)
  if (p && p !== 'gmail.com' && p !== 'googlemail.com') out.add(p)
  return [...out]
}

export function addressDomain(address: string): string {
  const a = address.trim().toLowerCase()
  const at = a.lastIndexOf('@')
  return at < 0 ? '' : a.slice(at + 1)
}

function inDomain(domain: string, base: string): boolean {
  return domain === base || domain.endsWith(`.${base}`)
}

/** Is this From address allowed in a bank-only mailbox? */
export function senderAllowed(address: string, sysDomains: readonly string[]): boolean {
  const a = address.trim().toLowerCase()
  if (a === FAYSAL_SENDER) return true
  const d = addressDomain(a)
  return !!d && sysDomains.some((s) => inDomain(d, s))
}

/** The lock decision from the From addresses of the last 30 days (headers
 *  only). Locked when any sender is neither the bank nor provider system mail. */
export function mailboxLock(fromAddresses: readonly string[], sysDomains: readonly string[]): { locked: boolean; otherSenders: number } {
  let other = 0
  for (const f of fromAddresses) if (!senderAllowed(f, sysDomains)) other++
  return { locked: other > 0, otherSenders: other }
}

/** Only the bank's own address has its body opened. */
export function isBankSender(address: string | null | undefined): boolean {
  return (address ?? '').trim().toLowerCase() === FAYSAL_SENDER
}

// ---------------------------------------------------------------------------
// DKIM

/** True when an Authentication-Results header (one or several) shows
 *  dkim=pass for faysalbank.com (or a subdomain of it). */
export function dkimPass(authResults: string | readonly string[] | null | undefined, domain = FAYSAL_DKIM_DOMAIN): boolean {
  const headers = (Array.isArray(authResults) ? authResults : [authResults ?? '']) as string[]
  for (const h of headers) {
    // Each result is separated by ";"; a dkim result names its domain with
    // header.d= (or header.i=@domain).
    for (const part of h.split(';')) {
      const p = part.trim().toLowerCase()
      if (!/^dkim\s*=\s*pass\b/.test(p)) continue
      const d = p.match(/header\.d\s*=\s*([a-z0-9.-]+)/)?.[1] ?? p.match(/header\.i\s*=\s*[^@\s]*@([a-z0-9.-]+)/)?.[1]
      if (d && inDomain(d, domain)) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Parsing

export type BankChannel = 'raast' | 'ibft'

export type ParsedCredit = {
  kind: 'credit'
  channel: BankChannel
  amountPkr: number
  /** YYYY-MM-DD, Pakistan time. */
  date: string
  /** HH:MM (24 h), Pakistan time; null when the email gives none. */
  time: string | null
  senderName: string | null
  senderBank: string | null
  /** Last 4 digits of the sender account, or null when masked / absent. */
  senderLast4: string | null
  reference: string
}

export type ParseResult = ParsedCredit | { kind: 'not_credit' } | { kind: 'unreadable'; reason: string }

export const CREDIT_PHRASE = 'your account has been credited'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** HTML → one line per cell / row / paragraph. */
export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th|tr|p|div|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      const k = e.toLowerCase()
      if (k.startsWith('#x')) return String.fromCharCode(parseInt(k.slice(2), 16))
      if (k.startsWith('#')) return k === '#39' ? "'" : String.fromCharCode(parseInt(k.slice(1), 10))
      return ENTITIES[k] ?? m
    })
  return text.split(/\r?\n/).map((l) => l.replace(/[\s ]+/g, ' ').trim()).filter(Boolean)
}

const LABELS = [
  'Receiver Name',
  'Receiver Bank',
  'Receiver Account Number',
  'Receiver Account No',
  'Sender Name',
  'Sender Bank',
  'Sender Account Number',
  'Sender Account No',
  'Transaction Amount',
  'Amount Transferred',
  'Date and Time',
  'Transaction Date',
  'Transaction Time',
  'Transaction Reference',
] as const
type Label = (typeof LABELS)[number]

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const LABEL_BY_NORM = new Map(LABELS.map((l) => [norm(l), l]))
// Longest first, so "Receiver Account Number" wins over a shorter prefix.
const LABELS_BY_LENGTH = [...LABELS].sort((a, b) => b.length - a.length)

/** Splits "Label: value" / "Label<tab>value" lines; returns label → value.
 *  A label on its own line takes the next line unless that line is a label
 *  (then the value is blank — "Sender Name" is sometimes empty). */
export function labelValues(lines: readonly string[]): Map<Label, string> {
  const out = new Map<Label, string>()
  const labelOf = (line: string): { label: Label; rest: string } | null => {
    const exact = LABEL_BY_NORM.get(norm(line))
    if (exact) return { label: exact, rest: '' }
    for (const l of LABELS_BY_LENGTH) {
      const re = new RegExp(`^${l.replace(/ /g, '\\s+')}\\s*[:\\-–]?\\s*(.*)$`, 'i')
      const m = line.match(re)
      if (m) return { label: l, rest: m[1].trim() }
    }
    return null
  }
  for (let i = 0; i < lines.length; i++) {
    const hit = labelOf(lines[i])
    if (!hit || out.has(hit.label)) continue
    if (hit.rest) {
      out.set(hit.label, hit.rest.replace(/^[:\-–]\s*/, '').trim())
      continue
    }
    const next = lines[i + 1]
    if (next === undefined || labelOf(next)) out.set(hit.label, '')
    else {
      out.set(hit.label, next.replace(/^[:\-–]\s*/, '').trim())
      i++
    }
  }
  return out
}

/** "PKR 199.00" / "PKR 200.00/-" / "Rs. 1,200" → 199 / 200 / 1200. */
export function parseAmount(v: string | null | undefined): number | null {
  const m = (v ?? '').replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** "23-Oct-26" / "19-Oct-2026" / "19/10/2026" → "2026-10-23". */
export function parseDay(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  let d: number, mo: number, y: number
  const named = s.match(/(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,]+(\d{2,4})/)
  const numeric = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (named) {
    d = Number(named[1])
    mo = MONTHS[named[2].slice(0, 3).toLowerCase()] ?? 0
    y = Number(named[3])
  } else if (numeric) {
    d = Number(numeric[1])
    mo = Number(numeric[2])
    y = Number(numeric[3])
  } else return null
  if (y < 100) y += 2000
  if (!mo || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** "11:55 PM" / "08:31 pm" / "20:31" → "23:55" / "20:31". */
export function parseClock(v: string | null | undefined): string | null {
  const m = (v ?? '').match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  const ap = m[3]?.toLowerCase()
  if (ap) {
    if (h < 1 || h > 12) return null
    if (ap === 'pm' && h !== 12) h += 12
    if (ap === 'am' && h === 12) h = 0
  }
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** The last 4 digits of an account, or null when it is masked or absent. */
export function last4(v: string | null | undefined): string | null {
  const s = (v ?? '').replace(/\s/g, '')
  const m = s.match(/(\d{4})$/)
  return m ? m[1] : null
}

const blankToNull = (v: string | undefined) => {
  const t = (v ?? '').trim()
  return t && !/^[-–—*x]+$/i.test(t) && t.toLowerCase() !== 'n/a' ? t : null
}

/** Reads one bank alert. Only the bank's own text is passed in; nothing here
 *  is kept except the returned fields. */
export function parseFaysalAlert(input: { subject: string | null | undefined; text?: string | null; html?: string | null }): ParseResult {
  const subject = (input.subject ?? '').trim()
  const lines = [...htmlToLines(input.html ?? ''), ...(input.text ?? '').split(/\r?\n/).map((l) => l.replace(/[\s ]+/g, ' ').trim()).filter(Boolean)]
  const all = `${subject}\n${lines.join('\n')}`.toLowerCase()
  if (!all.includes(CREDIT_PHRASE)) return { kind: 'not_credit' }

  const isRaast = /raast/i.test(subject)
  const isIbft = /fbl transaction alert/i.test(subject) || /inter\s*bank\s*funds?\s*transfer/i.test(all)
  if (!isRaast && !isIbft) return { kind: 'unreadable', reason: 'unknown format' }
  const channel: BankChannel = isRaast ? 'raast' : 'ibft'

  const v = labelValues(lines)
  const amount = parseAmount(v.get('Transaction Amount') ?? v.get('Amount Transferred'))
  let date: string | null
  let time: string | null
  if (v.has('Date and Time')) {
    date = parseDay(v.get('Date and Time'))
    time = parseClock(v.get('Date and Time'))
  } else {
    date = parseDay(v.get('Transaction Date'))
    time = parseClock(v.get('Transaction Time'))
  }
  const reference = (v.get('Transaction Reference') ?? '').replace(/\s/g, '')
  if (!amount) return { kind: 'unreadable', reason: 'no amount' }
  if (!date) return { kind: 'unreadable', reason: 'no date' }
  if (!/^[A-Za-z0-9]{6,24}$/.test(reference)) return { kind: 'unreadable', reason: 'no reference' }

  return {
    kind: 'credit',
    channel,
    amountPkr: amount,
    date,
    time,
    senderName: blankToNull(v.get('Sender Name')),
    senderBank: blankToNull(v.get('Sender Bank')),
    senderLast4: last4(v.get('Sender Account Number') ?? v.get('Sender Account No')),
    reference,
  }
}

/** A PayPro payout (the sender is PayPro): matched only against PayPro orders. */
export function isPayproPayout(senderName: string | null | undefined): boolean {
  return /paypro/i.test(senderName ?? '')
}

// ---------------------------------------------------------------------------
// Dedupe against what is already recorded

export type ExistingCredit = {
  id: string
  reference: string | null
  amountPkr: number
  date: string
  time: string | null
  senderName: string | null
  source: string
  messageId: string | null
}

export type CreditDecision =
  | { action: 'add' }
  | { action: 'duplicate'; creditId: string }
  | { action: 'link'; creditId: string }
  | { action: 'unclear'; reason: string }

const nameKey = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z]/g, '')

function minutesOf(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  return Date.UTC(y, m - 1, d, h, mi) / 60000
}

/** What to do with a parsed credit, given the credits already recorded. */
export function decideCredit(c: ParsedCredit, existing: readonly ExistingCredit[]): CreditDecision {
  const ref = c.reference.toUpperCase()
  const sameRef = existing.find((e) => (e.reference ?? '').trim().toUpperCase() === ref)
  if (sameRef) return { action: 'duplicate', creditId: sameRef.id }

  // A credit typed in by hand: same amount, within 15 minutes, same or blank sender name.
  const manual = existing.filter((e) => e.source !== 'email' && !e.messageId && Math.abs(e.amountPkr - c.amountPkr) < 0.005)
  const near: ExistingCredit[] = []
  let undated = 0
  for (const e of manual) {
    const namesOk = !nameKey(e.senderName) || !nameKey(c.senderName) || nameKey(e.senderName) === nameKey(c.senderName)
    if (!namesOk) continue
    if (e.time && c.time) {
      if (Math.abs(minutesOf(e.date, e.time) - minutesOf(c.date, c.time)) <= MANUAL_MATCH_WINDOW_MIN) near.push(e)
    } else if (e.date === c.date) undated++
  }
  if (near.length === 1 && undated === 0) return { action: 'link', creditId: near[0].id }
  if (near.length > 1) return { action: 'unclear', reason: 'more than one hand-entered credit matches' }
  if (undated > 0) return { action: 'unclear', reason: 'a hand-entered credit of the same amount that day has no time' }
  return { action: 'add' }
}

// ---------------------------------------------------------------------------
// Status shown on Finance settings

export type ReaderStatus = 'off' | 'running' | 'locked' | 'error'

export const READER_STATUS_LABEL: Record<ReaderStatus, string> = {
  off: 'Off',
  running: 'Running',
  locked: 'Locked',
  error: 'Error',
}

export const LOCKED_MESSAGE = "This mailbox isn't bank-only"

/** Red alert: switched on and failing (error or locked) for over an hour. */
export function readerFailingAlert(s: { enabled: boolean; status: ReaderStatus; errorSince: string | null }, now: Date): boolean {
  if (!s.enabled || (s.status !== 'error' && s.status !== 'locked') || !s.errorSince) return false
  return now.getTime() - new Date(s.errorSince).getTime() > FAILING_ALERT_MS
}

/** Error text kept for the screen: a plain category, never a host, user or secret. */
export function readerErrorCategory(e: unknown): string {
  const m = (e instanceof Error ? `${e.name} ${e.message} ${(e as { code?: string }).code ?? ''}` : String(e)).toLowerCase()
  if (/auth|login|credential|password|invalid user/.test(m)) return 'Sign-in to the mailbox failed'
  if (/timeout|timed out|etimedout/.test(m)) return 'The mailbox did not answer in time'
  if (/enotfound|econnrefused|econnreset|getaddrinfo|socket|tls|certificate/.test(m)) return 'Could not connect to the mailbox'
  return 'The reader stopped with an error'
}

/** The IMAP settings are present (names only are ever reported). */
export const BANK_IMAP_ENV = ['BANK_IMAP_HOST', 'BANK_IMAP_PORT', 'BANK_IMAP_USER', 'BANK_IMAP_PASSWORD'] as const

export function missingImapEnv(env: Record<string, string | undefined>): string[] {
  return BANK_IMAP_ENV.filter((k) => !(env[k] ?? '').trim())
}
