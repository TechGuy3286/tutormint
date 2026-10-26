/**
 * scripts/test-bank-reader.ts — the Faysal Bank email reader (owner, 26 Oct 2026).
 *   npm run test:bankreader
 *
 * Every name, number and address below is invented.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  decideCredit,
  dkimPass,
  FAYSAL_SENDER,
  isPayproPayout,
  mailboxLock,
  parseFaysalAlert,
  readerErrorCategory,
  readerFailingAlert,
  systemDomains,
  type ExistingCredit,
  type ParsedCredit,
} from '../lib/bankEmailCore'
import { runBankReaderWith, type CreditStore, type MailboxPort } from '../lib/bankEmailRun'

const SYS = systemDomains('imap.hostinger.com')
const PASS = 'mx.example.net; dkim=pass header.d=faysalbank.com header.s=s1; spf=pass smtp.mailfrom=faysalbank.com'
const FAIL = 'mx.example.net; dkim=fail header.d=faysalbank.com; spf=pass'

// Format 1 — RAAST Fund Transfer (a table).
const RAAST_HTML = `<p>Dear Customer,</p><p>Your account has been credited.</p>
<table>
<tr><td>Receiver Name</td><td>EXAMPLE LEARNING PVT LTD</td></tr>
<tr><td>Receiver Account Number</td><td>0000111122223333</td></tr>
<tr><td>Sender Name</td><td>AYESHA KHAN</td></tr>
<tr><td>Sender Account Number</td><td>PK00ABCD0000000000004321</td></tr>
<tr><td>Transaction Amount</td><td>PKR 199.00</td></tr>
<tr><td>Date and Time</td><td>23-Oct-26 11:55 PM</td></tr>
<tr><td>Transaction Reference</td><td>123456789012</td></tr>
</table>`

// Format 2 — FBL Transaction Alert (IBFT), blank sender name, masked account, "/-".
const IBFT_HTML = `<div>Your account has been credited through Inter Bank Funds Transfer.</div>
<table>
<tr><td>Receiver Name</td><td>EXAMPLE LEARNING PVT LTD</td></tr>
<tr><td>Receiver Bank</td><td>FAYSAL BANK</td></tr>
<tr><td>Receiver Account No</td><td>0000111122223333</td></tr>
<tr><td>Sender Name</td><td></td></tr>
<tr><td>Sender Bank</td><td>BAFL</td></tr>
<tr><td>Sender Account No</td><td>XXXXXXXXXXXXXXXX</td></tr>
<tr><td>Transaction Date</td><td>19-Oct-2026</td></tr>
<tr><td>Transaction Time</td><td>08:31 PM</td></tr>
<tr><td>Amount Transferred</td><td>PKR 200.00/-</td></tr>
<tr><td>Transaction Reference</td><td>9876543210</td></tr>
</table>`

test('format 1 (RAAST): every field, two-digit year, last 4 digits only', () => {
  const r = parseFaysalAlert({ subject: 'RAAST Fund Transfer', html: RAAST_HTML })
  assert.equal(r.kind, 'credit')
  const c = r as ParsedCredit
  assert.deepEqual(
    { ...c },
    { kind: 'credit', channel: 'raast', amountPkr: 199, date: '2026-10-23', time: '23:55', senderName: 'AYESHA KHAN', senderBank: null, senderLast4: '4321', reference: '123456789012' },
  )
  // Never the receiver's account number, never the full sender account.
  assert.doesNotMatch(JSON.stringify(c), /0000111122223333|PK00ABCD/)
})

test('format 2 (IBFT): blank sender name, fully masked account, "/-" amount, four-digit year', () => {
  const r = parseFaysalAlert({ subject: 'FBL Transaction Alert', html: IBFT_HTML }) as ParsedCredit
  assert.equal(r.kind, 'credit')
  assert.equal(r.channel, 'ibft')
  assert.equal(r.amountPkr, 200)
  assert.equal(r.date, '2026-10-19')
  assert.equal(r.time, '20:31')
  assert.equal(r.senderName, null)
  assert.equal(r.senderBank, 'BAFL')
  assert.equal(r.senderLast4, null)
  assert.equal(r.reference, '9876543210')
})

test('plain-text alerts with "Label: value" lines also parse', () => {
  const text = 'Your account has been credited.\nSender Name: BILAL AHMED\nTransaction Amount: PKR 1,500.00\nDate and Time: 01-Nov-2026 09:05 AM\nTransaction Reference: 111122223333'
  const r = parseFaysalAlert({ subject: 'RAAST Fund Transfer', text }) as ParsedCredit
  assert.equal(r.amountPkr, 1500)
  assert.equal(r.time, '09:05')
  assert.equal(r.senderName, 'BILAL AHMED')
})

test('credits only: a debit or a notice is ignored; a credit without its fields is unreadable', () => {
  assert.equal(parseFaysalAlert({ subject: 'FBL Transaction Alert', html: '<p>Your account has been debited.</p>' }).kind, 'not_credit')
  assert.equal(parseFaysalAlert({ subject: 'Monthly statement', text: 'Your statement is ready.' }).kind, 'not_credit')
  const bad = parseFaysalAlert({ subject: 'RAAST Fund Transfer', html: '<p>Your account has been credited.</p><p>Sender Name</p><p>X</p>' })
  assert.equal(bad.kind, 'unreadable')
})

test('safety lock: any non-bank sender in 30 days locks; provider system mail does not', () => {
  assert.equal(mailboxLock([FAYSAL_SENDER, FAYSAL_SENDER.toUpperCase(), 'no-reply@accounts.google.com', 'notice@hostinger.com'], SYS).locked, false)
  const l = mailboxLock([FAYSAL_SENDER, 'friend@example.com'], SYS)
  assert.equal(l.locked, true)
  assert.equal(l.otherSenders, 1)
  // A look-alike bank domain is not the bank.
  assert.equal(mailboxLock(['efbl@faysalbank.com.example.org'], SYS).locked, true)
  // gmail.com is not system mail even for a Gmail mailbox.
  assert.equal(mailboxLock(['someone@gmail.com'], systemDomains('imap.gmail.com')).locked, true)
})

test('DKIM must pass for faysalbank.com', () => {
  assert.equal(dkimPass(PASS), true)
  assert.equal(dkimPass('mx; dkim=pass header.d=mail.faysalbank.com'), true)
  assert.equal(dkimPass(FAIL), false)
  assert.equal(dkimPass('mx; dkim=pass header.d=faysalbank.com.example.org'), false)
  assert.equal(dkimPass('mx; dkim=pass header.d=example.org'), false)
  assert.equal(dkimPass(null), false)
  assert.equal(dkimPass(['mx; spf=pass', PASS]), true)
})

const credit = (over: Partial<ParsedCredit> = {}): ParsedCredit => ({
  kind: 'credit', channel: 'raast', amountPkr: 199, date: '2026-10-23', time: '23:55', senderName: 'AYESHA KHAN', senderBank: null, senderLast4: '4321', reference: '123456789012', ...over,
})
const ex = (over: Partial<ExistingCredit>): ExistingCredit => ({ id: 'x', reference: null, amountPkr: 199, date: '2026-10-23', time: '23:50', senderName: null, source: 'manual', messageId: null, ...over })

test('dedupe: by reference, then against a hand-entered credit (15 minutes, same or blank name)', () => {
  assert.deepEqual(decideCredit(credit(), [ex({ id: 'a', reference: '123456789012', source: 'email' })]), { action: 'duplicate', creditId: 'a' })
  assert.deepEqual(decideCredit(credit(), [ex({ id: 'b', senderName: 'Ayesha  Khan' })]), { action: 'link', creditId: 'b' })
  assert.deepEqual(decideCredit(credit(), [ex({ id: 'c', senderName: null })]), { action: 'link', creditId: 'c' })
  assert.equal(decideCredit(credit(), [ex({ id: 'd', senderName: 'SOMEONE ELSE' })]).action, 'add')
  assert.equal(decideCredit(credit(), [ex({ id: 'e', time: '23:30' })]).action, 'add')
  assert.equal(decideCredit(credit(), [ex({ id: 'f' }), ex({ id: 'g', time: '23:58' })]).action, 'unclear')
  assert.equal(decideCredit(credit(), [ex({ id: 'h', time: null })]).action, 'unclear')
  assert.equal(decideCredit(credit({ amountPkr: 200 }), [ex({ id: 'i' })]).action, 'add')
})

test('a PayPro payout is told apart by its sender name', () => {
  assert.equal(isPayproPayout('PAYPRO PRIVATE LIMITED'), true)
  assert.equal(isPayproPayout('AYESHA KHAN'), false)
  assert.equal(isPayproPayout(null), false)
})

// ---------------------------------------------------------------------------
// A full run against a fake mailbox

type Mail = { uid: number; from: string; auth: string; subject: string; html: string; messageId: string }

function fakeMailbox(mails: Mail[]) {
  const opened: number[] = []
  const marked: number[] = []
  const headersRead: number[] = []
  const port: MailboxPort = {
    async listSince() {
      return mails.map((m) => ({ uid: m.uid, from: m.from, keywords: new Set<string>() }))
    },
    async headers(uid) {
      headersRead.push(uid)
      const m = mails.find((x) => x.uid === uid)!
      return { authResults: [m.auth], messageId: m.messageId, subject: m.subject, date: new Date('2026-10-23T19:00:00Z') }
    },
    async body(uid) {
      opened.push(uid)
      const m = mails.find((x) => x.uid === uid)!
      return { subject: m.subject, text: null, html: m.html }
    },
    async markProcessed(uid) {
      marked.push(uid)
    },
  }
  return { port, opened, marked, headersRead }
}

function fakeStore(existing: ExistingCredit[] = []) {
  const added: (ParsedCredit & { gateway: string; messageId: string | null })[] = []
  const linked: [string, string | null][] = []
  const alerts: { kind: string; ref: string; title: string; detail?: string | null }[] = []
  const store: CreditStore = {
    async existingCredits() {
      return existing
    },
    async knownMessageIds() {
      return new Set()
    },
    async addCredit(c) {
      added.push(c)
      return { id: `new-${added.length}` }
    },
    async linkCredit(id, mid) {
      linked.push([id, mid])
    },
    async alert(a) {
      alerts.push(a)
    },
  }
  return { store, added, linked, alerts }
}

const NOW = new Date('2026-10-26T10:00:00Z')

test('the lock trips on a non-Faysal sender WITHOUT reading any header or body', async () => {
  const mb = fakeMailbox([
    { uid: 1, from: FAYSAL_SENDER, auth: PASS, subject: 'RAAST Fund Transfer', html: RAAST_HTML, messageId: '<a@x>' },
    { uid: 2, from: 'friend@example.com', auth: '', subject: 'hello', html: '<p>private</p>', messageId: '<b@x>' },
  ])
  const st = fakeStore()
  const r = await runBankReaderWith(mb.port, st.store, { now: NOW, sysDomains: SYS })
  assert.equal(r.status, 'locked')
  assert.deepEqual(mb.opened, [])
  assert.deepEqual(mb.headersRead, [])
  assert.deepEqual(mb.marked, [])
  assert.equal(st.added.length, 0)
  assert.equal(st.alerts[0].kind, 'mailbox_locked')
  assert.equal(st.alerts[0].title, "This mailbox isn't bank-only")
  assert.doesNotMatch(JSON.stringify(st.alerts), /friend@example\.com/)
})

test('a run: credits added, DKIM failure not opened, unreadable flagged, non-credit ignored, nothing activated', async () => {
  const mb = fakeMailbox([
    { uid: 1, from: FAYSAL_SENDER, auth: PASS, subject: 'RAAST Fund Transfer', html: RAAST_HTML, messageId: '<1@bank>' },
    { uid: 2, from: FAYSAL_SENDER, auth: FAIL, subject: 'RAAST Fund Transfer', html: RAAST_HTML, messageId: '<2@bank>' },
    { uid: 3, from: FAYSAL_SENDER, auth: PASS, subject: 'RAAST Fund Transfer', html: '<p>Your account has been credited.</p>', messageId: '<3@bank>' },
    { uid: 4, from: FAYSAL_SENDER, auth: PASS, subject: 'FBL Transaction Alert', html: '<p>Your account has been debited.</p>', messageId: '<4@bank>' },
    { uid: 5, from: FAYSAL_SENDER, auth: PASS, subject: 'FBL Transaction Alert', html: IBFT_HTML.replace('<td>Sender Name</td><td></td>', '<td>Sender Name</td><td>PAYPRO PVT LTD</td>'), messageId: '<5@bank>' },
    { uid: 6, from: 'no-reply@accounts.google.com', auth: '', subject: 'Security alert', html: '<p>secret</p>', messageId: '<6@g>' },
  ])
  const st = fakeStore()
  const r = await runBankReaderWith(mb.port, st.store, { now: NOW, sysDomains: SYS })
  assert.equal(r.status, 'ok')
  if (r.status !== 'ok') return
  // The DKIM failure (2) and the system mail (6) are never opened.
  assert.deepEqual(mb.opened.sort(), [1, 3, 4, 5])
  assert.ok(!mb.headersRead.includes(6), 'system mail is not even header-read')
  assert.equal(r.added, 2)
  assert.equal(r.unverified, 1)
  assert.equal(r.unreadable, 1)
  assert.equal(r.ignored, 1)
  assert.deepEqual(st.added.map((a) => a.gateway), ['manual', 'paypro'])
  assert.deepEqual(st.added.map((a) => a.messageId), ['<1@bank>', '<5@bank>'])
  assert.deepEqual(
    st.alerts.map((a) => [a.kind, a.title]),
    [
      ['email_unverified', "Couldn't verify sender"],
      ['email_unreadable', "Couldn't read this email"],
    ],
  )
  // Unreadable shows only the subject and the date.
  assert.match(st.alerts[1].detail ?? '', /^Subject: RAAST Fund Transfer · received /)
  assert.deepEqual(mb.marked.sort(), [1, 2, 3, 4, 5])
  // Only the last 4 digits of a sender account are ever handed to the store.
  assert.doesNotMatch(JSON.stringify(st.added), /PK00ABCD|0000111122223333/)
})

test('a run links an email to a credit typed in by hand, and skips a known reference', async () => {
  const mb = fakeMailbox([{ uid: 1, from: FAYSAL_SENDER, auth: PASS, subject: 'RAAST Fund Transfer', html: RAAST_HTML, messageId: '<1@bank>' }])
  const st = fakeStore([ex({ id: 'hand', senderName: 'AYESHA KHAN' })])
  const r = await runBankReaderWith(mb.port, st.store, { now: NOW, sysDomains: SYS })
  assert.equal(r.status === 'ok' && r.linked, 1)
  assert.deepEqual(st.linked, [['hand', '<1@bank>']])
  assert.equal(st.added.length, 0)
})

test('the reader never activates, approves or grants anything, and never logs secrets', () => {
  const run = readFileSync('lib/bankEmailRun.ts', 'utf8')
  const io = readFileSync('lib/bankEmailReader.ts', 'utf8')
  for (const src of [run, io]) {
    assert.doesNotMatch(src, /activatePayment|reviewed_at|verified_fee_paid_at|\.from\('payments'\)|\.from\('subscriptions'\)/)
    assert.doesNotMatch(src, /console\.(log|info|warn|error)/)
  }
  // Errors are reduced to plain words, never the host or the user.
  assert.equal(readerErrorCategory(new Error('getaddrinfo ENOTFOUND imap.example.org')), 'Could not connect to the mailbox')
  assert.equal(readerErrorCategory(new Error('Invalid credentials for user@example.org')), 'Sign-in to the mailbox failed')
  assert.doesNotMatch(readerErrorCategory(new Error('boom user@example.org')), /example/)
  // The body is never stored: the store only receives parsed fields.
  assert.doesNotMatch(io, /\bbody:|html:\s*c\.|text:\s*c\./)
})

test('the reader is OFF by default, and the red alert waits an hour', () => {
  const sql = readFileSync('supabase/migrations/200_paypro_retire_bank_reader.sql', 'utf8')
  assert.match(sql, /enabled boolean not null default false/)
  assert.match(sql, /status text not null default 'off'/)
  const now = new Date('2026-10-26T12:00:00Z')
  assert.equal(readerFailingAlert({ enabled: true, status: 'error', errorSince: '2026-10-26T11:30:00Z' }, now), false)
  assert.equal(readerFailingAlert({ enabled: true, status: 'error', errorSince: '2026-10-26T10:30:00Z' }, now), true)
  assert.equal(readerFailingAlert({ enabled: false, status: 'error', errorSince: '2026-10-26T10:30:00Z' }, now), false)
  assert.equal(readerFailingAlert({ enabled: true, status: 'running', errorSince: null }, now), false)
})

test('the switch is Owner only, needs the password again, and is logged', () => {
  const route = readFileSync('app/api/admin/finance/bank-reader/route.ts', 'utf8')
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.finance\)/)
  assert.match(route, /requireFreshAuth/)
  assert.match(route, /action: 'finance\.bank_reader'/)
  assert.doesNotMatch(route, /BANK_IMAP_(HOST|USER|PASSWORD)\b(?!.*names)/)
})
