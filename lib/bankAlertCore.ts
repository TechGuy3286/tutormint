// lib/bankAlertCore.ts
//
// Bank credits by paste (owner, 11 Oct 2026) — the PURE half. The owner pastes
// one or more Faysal Bank credit alerts (or a whole email thread) and each one
// becomes a bank credit with no typing. No I/O here, so it runs in the browser
// (the pasted text never leaves it — only the fields below are sent) and in
// scripts/test-bankalerts.ts.
//
// Copied from Gmail the alert is a two-column table, so it arrives as
// "Label:<tab>value" lines, or as a label on one line and its value on the next.
// The reader therefore does not look at lines at all: it finds every known LABEL
// in the text and takes what sits between one label and the next as its value.
//
// The receiver's account number is never read. Of the sender's account number
// only the last 4 digits are kept.

import { parseAmount } from './reconciliationCore'
import { findDate, findTime, isPayproSender, parseBankAlert, refKey } from './settlementMatchCore'

export type AlertField = 'date' | 'amount' | 'reference'

export type AlertCredit = {
  /** YYYY-MM-DD, as printed on the alert (Pakistan time). */
  date: string | null
  /** HH:MM (24-hour) */
  time: string | null
  amountPkr: number | null
  senderName: string | null
  senderBank: string | null
  /** Last 4 digits of the sender's account, when the alert shows them. */
  senderAccountLast4: string | null
  reference: string | null
  /** PayPro payout (true) or a member's own bank transfer (false). */
  isPaypro: boolean
}

type Key = 'start' | 'receiverName' | 'receiverBank' | 'receiverAccount' | 'senderName' | 'senderBank' | 'senderAccount' | 'date' | 'time' | 'amount' | 'reference'

// "\s+" between words takes tabs and line breaks. Matched case-insensitively.
const LABELS: [Key, string][] = [
  ['receiverAccount', 'receiver\\s+(?:account|a\\/c|acc)(?:\\s+(?:no\\.?|number|#))?'],
  ['receiverName', 'receiver\\s+name'],
  ['receiverBank', 'receiver\\s+bank'],
  ['senderAccount', 'sender\\s+(?:account|a\\/c|acc)(?:\\s+(?:no\\.?|number|#))?'],
  ['senderName', 'sender\\s+name'],
  ['senderBank', 'sender\\s+bank'],
  ['date', 'transaction\\s+date'],
  ['time', 'transaction\\s+time'],
  ['reference', 'transaction\\s+(?:reference|ref\\.?|id)(?:\\s+(?:no\\.?|number|#))?'],
  ['amount', '(?:amount\\s+(?:transferred|credited|received)|transaction\\s+amount|credit\\s+amount)'],
]
const SCAN = new RegExp(`(?<![A-Za-z])(?:(dear\\s+tutor\\s*mint)|(?:${LABELS.map(([, re]) => `(${re})`).join('|')})\\s*[:=])`, 'gi')

type Hit = { key: Key; start: number; valueFrom: number }

function scan(text: string): Hit[] {
  const hits: Hit[] = []
  for (const m of text.matchAll(SCAN)) {
    const idx = m.slice(1).findIndex((g) => g !== undefined)
    if (idx < 0) continue
    const start = m.index ?? 0
    hits.push({ key: idx === 0 ? 'start' : LABELS[idx - 1][0], start, valueFrom: start + m[0].length })
  }
  return hits
}

/** The first non-empty line of a value, whitespace collapsed; null when empty. */
function firstLine(v: string | undefined): string | null {
  for (const line of (v ?? '').split('\n')) {
    const s = line.replace(/\s+/g, ' ').trim()
    if (s !== '') return s
  }
  return null
}

function amountOf(v: string | null): number | null {
  const m = (v ?? '').match(/\d[\d,]*(?:\.\d{1,2})?/)
  const n = m ? parseAmount(m[0]) : null
  return n !== null && n > 0 ? n : null
}

function fromFields(f: Partial<Record<Key, string>>): AlertCredit {
  const senderName = firstLine(f.senderName)
  const account = firstLine(f.senderAccount) ?? ''
  return {
    date: f.date ? findDate(f.date.replace(/\s+/g, ' ')) : null,
    time: f.time ? findTime(f.time.replace(/\s+/g, ' ')) : null,
    amountPkr: amountOf(firstLine(f.amount)),
    senderName,
    senderBank: firstLine(f.senderBank),
    senderAccountLast4: account.match(/(\d{4})\s*$/)?.[1] ?? null,
    reference: firstLine(f.reference)?.match(/[A-Za-z0-9][A-Za-z0-9/-]*/)?.[0] ?? null,
    isPaypro: isPayproSender(senderName),
  }
}

/**
 * Every bank credit in the pasted text, in the order pasted. A new alert starts
 * at each "Dear TUTOR MINT", after each Transaction Reference, or when a label
 * repeats. Text with none of the alert's labels is read as one sentence-style
 * alert (an SMS); text with nothing readable gives an empty list.
 */
export function parseBankAlerts(text: string): AlertCredit[] {
  const src = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ')
  const hits = scan(src)
  const out: AlertCredit[] = []
  let cur: Partial<Record<Key, string>> = {}
  const flush = () => {
    // Receiver lines alone are not a credit.
    if (Object.keys(cur).some((k) => !k.startsWith('receiver'))) out.push(fromFields(cur))
    cur = {}
  }
  hits.forEach((h, i) => {
    if (h.key === 'start') return flush()
    if (h.key in cur || 'reference' in cur) flush()
    cur[h.key] = src.slice(h.valueFrom, i + 1 < hits.length ? hits[i + 1].start : src.length)
  })
  flush()
  if (out.length > 0) return out

  const one = parseBankAlert(src)
  if (one.amountPkr === null && !one.date && !one.reference) return []
  return [{ ...one, senderAccountLast4: null, isPaypro: isPayproSender(one.senderName) }]
}

/** The required fields an alert is missing. */
export function missingFields(c: Pick<AlertCredit, 'date' | 'amountPkr' | 'reference'>): AlertField[] {
  const missing: AlertField[] = []
  if (!c.date) missing.push('date')
  if (c.amountPkr === null || !(c.amountPkr > 0)) missing.push('amount')
  if (refKey(c.reference) === '') missing.push('reference')
  return missing
}

export type AlertStatus =
  | { kind: 'ready' }
  /** Its reference is already recorded, or an earlier alert in this paste has it. */
  | { kind: 'saved'; inPaste: boolean }
  | { kind: 'unreadable'; missing: AlertField[] }

/** What happens to each pasted alert on Save: only 'ready' ones are saved. */
export function planAlerts(credits: Pick<AlertCredit, 'date' | 'amountPkr' | 'reference'>[], existingReferences: string[]): AlertStatus[] {
  const have = new Set(existingReferences.map(refKey))
  const seen = new Set<string>()
  return credits.map((c) => {
    const missing = missingFields(c)
    if (missing.length > 0) return { kind: 'unreadable', missing }
    const k = refKey(c.reference)
    if (have.has(k)) return { kind: 'saved', inPaste: false }
    if (seen.has(k)) return { kind: 'saved', inPaste: true }
    seen.add(k)
    return { kind: 'ready' }
  })
}

/** "Couldn't read: date/amount missing". */
export function unreadableText(missing: AlertField[]): string {
  return `Couldn't read: ${missing.join('/')} missing`
}

/** The note stored with a pasted credit: only the sender account's last 4 digits. */
export function alertNote(c: Pick<AlertCredit, 'senderAccountLast4'>): string | null {
  return c.senderAccountLast4 ? `Sender account ending ${c.senderAccountLast4}` : null
}
