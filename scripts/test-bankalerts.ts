/**
 * scripts/test-bankalerts.ts — Bank credits by paste (owner, 11 Oct 2026): the
 * Faysal Bank alert reader, the save plan, "Ignore (not a sale)" and who may
 * save. Pure rules plus source scans; nothing touches a database.
 *
 *   npm run test:bankalerts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { alertNote, missingFields, parseBankAlerts, planAlerts, unreadableText } from '../lib/bankAlertCore'
import { parsePayproCsv } from '../lib/reconciliationCore'
import { buildBoard, matchSummary, monthCsv, monthView, NOT_A_SALE, withoutIgnored, type Credit } from '../lib/settlementMatchCore'
import { isReadOnlyRole, roleSatisfies, SCREEN_ACCESS } from '../lib/adminAccessCore'

const root = join(__dirname, '..')
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8')

const HEADER = [
  'FBL Transaction Alert',
  'From Faysal Bank <efbl@faysalbank.com>',
  'to me',
  'Dear TUTOR MINT (PVT) LIMITED,',
  'Your account has been credited via Inter Bank Funds Transfer. Below are the transaction details:',
].join('\n')

/** The owner's sample, as Gmail's two-column table pastes: label, TAB, value. */
const alert = (o: { sender?: string; bank?: string; date?: string; time?: string; amount?: string; ref?: string } = {}) =>
  [
    'Receiver Name:\tTUTOR MINT (PVT) LIMITED',
    'Receiver Bank:\tFBL',
    'Receiver Account No:\t3310****************5756',
    `Sender Name:\t${o.sender ?? 'PAYPRO PRIVATE LIMITED'}`,
    `Sender Bank:\t${o.bank ?? ''}`,
    'Sender Account No:\tPK87****************1949',
    `Transaction Date:\t${o.date ?? '09-Oct-2026'}`,
    `Transaction Time:\t${o.time ?? '12:26 PM'}`,
    `Amount Transferred:\t${o.amount ?? 'PKR 386.00/-'}`,
    `Transaction Reference:\t${o.ref ?? '2017435657'}`,
  ].join('\n')

const SAMPLE = {
  date: '2026-10-09',
  time: '12:26',
  amountPkr: 386,
  senderName: 'PAYPRO PRIVATE LIMITED',
  senderBank: null,
  senderAccountLast4: '1949',
  reference: '2017435657',
  isPaypro: true,
}

test('the exact sample reads with tabs, with labels and values on separate lines, and with the email header', () => {
  assert.deepEqual(parseBankAlerts(alert()), [SAMPLE])
  // Labels and values on separate lines (the empty Sender Bank is a blank line).
  assert.deepEqual(parseBankAlerts(alert().replace(/\t/g, '\n')), [SAMPLE])
  assert.deepEqual(parseBankAlerts(alert().replace(/\t/g, '\n\n')), [SAMPLE])
  // Windows line ends, the header lines, spaces instead of tabs, shouting labels.
  assert.deepEqual(parseBankAlerts(`${HEADER}\n${alert()}`.replace(/\n/g, '\r\n')), [SAMPLE])
  assert.deepEqual(parseBankAlerts(`${HEADER}\n${alert().replace(/\t/g, '   ')}`), [SAMPLE])
  assert.deepEqual(parseBankAlerts(alert().replace(/^[^\t]+/gm, (l) => l.toUpperCase()).replace(/:\t/g, ' :\t')), [SAMPLE])
  // The email's own "From Faysal Bank" line is not the sender of the money.
  assert.equal(parseBankAlerts(`${HEADER}\n${alert().replace(/\t/g, '\n')}`)[0].senderName, 'PAYPRO PRIVATE LIMITED')
  // Text after the reference (the email's footer) is not part of it.
  assert.equal(parseBankAlerts(`${alert()}\nRegards,\nFaysal Bank`)[0].reference, '2017435657')
})

test('an empty Sender Bank stays empty, and a filled one is read', () => {
  assert.equal(parseBankAlerts(alert())[0].senderBank, null)
  assert.equal(parseBankAlerts(alert().replace(/\t/g, '\n'))[0].senderBank, null)
  assert.equal(parseBankAlerts(alert({ bank: 'Meezan Bank' }))[0].senderBank, 'Meezan Bank')
})

test('amount formats: PKR x.00/- and Rs 1,000', () => {
  const amount = (a: string) => parseBankAlerts(alert({ amount: a }))[0].amountPkr
  assert.equal(amount('PKR 386.00/-'), 386)
  assert.equal(amount('Rs 1,000'), 1000)
  assert.equal(amount('Rs. 12,500.50'), 12500.5)
  assert.equal(amount('PKR 199/-'), 199)
  assert.equal(amount(''), null)
})

test('date and time formats', () => {
  const at = (date: string, time = '12:26 PM') => {
    const c = parseBankAlerts(alert({ date, time }))[0]
    return [c.date, c.time]
  }
  assert.deepEqual(at('09-Oct-2026'), ['2026-10-09', '12:26'])
  assert.deepEqual(at('9/10/2026'), ['2026-10-09', '12:26'], 'day first')
  assert.deepEqual(at('2026-10-09'), ['2026-10-09', '12:26'])
  assert.deepEqual(at('09 October 2026', '12:05 AM'), ['2026-10-09', '00:05'])
  assert.deepEqual(at('09-Oct-2026', '11:59 PM'), ['2026-10-09', '23:59'], 'the printed day is kept — no time-zone shift')
  assert.deepEqual(at('09-Oct-2026', '14:35'), ['2026-10-09', '14:35'])
})

test('PAYPRO in the sender makes it a PayPro payout; anyone else is a member’s bank transfer', () => {
  assert.equal(parseBankAlerts(alert())[0].isPaypro, true)
  assert.equal(parseBankAlerts(alert({ sender: 'PayPro Pvt Ltd' }))[0].isPaypro, true)
  assert.equal(parseBankAlerts(alert({ sender: 'MUHAMMAD AHMED KHAN' }))[0].isPaypro, false)
})

test('two alerts pasted together, or a whole thread, become a list of credits', () => {
  const second = alert({ sender: 'MUHAMMAD AHMED KHAN', bank: 'HBL', date: '10-Oct-2026', time: '09:05 AM', amount: 'Rs 1,000', ref: 'FT26283ABC' })
  const two = parseBankAlerts(`${HEADER}\n${alert()}\n\n${HEADER}\n${second}`)
  assert.equal(two.length, 2)
  assert.deepEqual(two[0], SAMPLE)
  assert.deepEqual(two[1], { date: '2026-10-10', time: '09:05', amountPkr: 1000, senderName: 'MUHAMMAD AHMED KHAN', senderBank: 'HBL', senderAccountLast4: '1949', reference: 'FT26283ABC', isPaypro: false })
  // No "Dear TUTOR MINT" between them: the Transaction Reference ends an alert.
  assert.equal(parseBankAlerts(`${alert()}\n${second}`).length, 2)
  assert.equal(parseBankAlerts(`${alert()}\n${second}`.replace(/\t/g, '\n')).length, 2)
  assert.equal(parseBankAlerts([alert(), second, alert({ ref: '3' })].join('\n> ')).length, 3)
  assert.deepEqual(parseBankAlerts('hello'), [])
  assert.deepEqual(parseBankAlerts(HEADER), [])
})

test('a duplicate reference is skipped; a missing required field is named', () => {
  const list = parseBankAlerts([alert(), alert({ ref: 'NEW-1' }), alert({ ref: 'new-1' }), alert({ date: 'soon', amount: 'n/a', ref: 'R4' })].join('\n'))
  assert.equal(list.length, 4)
  const plan = planAlerts(list, ['2017-435657 '])
  assert.deepEqual(plan[0], { kind: 'saved', inPaste: false }, 'already recorded — not saved again')
  assert.deepEqual(plan[1], { kind: 'ready' })
  assert.deepEqual(plan[2], { kind: 'saved', inPaste: true }, 'the same reference twice in one paste is saved once')
  assert.deepEqual(plan[3], { kind: 'unreadable', missing: ['date', 'amount'] })
  assert.equal(unreadableText(['date', 'amount']), "Couldn't read: date/amount missing")
  assert.deepEqual(missingFields({ date: null, amountPkr: null, reference: null }), ['date', 'amount', 'reference'])
  assert.equal(plan.filter((p) => p.kind === 'ready').length, 1, 'Save 1 credit')

  // The server skips a duplicate too, and the database has the last word.
  const lib = read('lib', 'settlementMatch.ts')
  assert.ok(lib.includes('export async function addBankCredits') && lib.includes('duplicate: !!r.duplicate'))
  assert.ok(lib.includes("error?.code === '23505'"))
  const route = read('app', 'api', 'admin', 'payments', 'settlement', 'credits', 'route.ts')
  assert.ok(route.includes('only.duplicate ? 409 : 400'))
})

test('account numbers: the receiver’s is never read, the sender’s only as its last 4 digits', () => {
  const [c] = parseBankAlerts(`${HEADER}\n${alert()}`)
  const kept = JSON.stringify({ ...c, note: alertNote(c) })
  assert.ok(!/3310|5756|PK87|\*/.test(kept), kept)
  assert.equal(alertNote(c), 'Sender account ending 1949')
  assert.equal(alertNote({ senderAccountLast4: null }), null)
  // The pasted text itself is never sent: the form posts the read fields only.
  const ui = read('app', 'admin', 'finance', 'settlement', 'AddBankCredits.tsx')
  assert.ok(ui.includes('JSON.stringify({ credits: list })'))
  assert.ok(!/body:[^\n]*\btext\b/.test(ui))
})

test('after saving, each credit says what it matched', () => {
  const rows = parsePayproCsv(read('scripts', 'fixtures', 'paypro-orders-settled.csv'))
  const mk = (o: Partial<Credit> & { id: string; amountPkr: number }): Credit => ({ date: '2026-10-09', time: null, senderName: 'PAYPRO PRIVATE LIMITED', senderBank: null, reference: `REF-${o.id}`, note: null, isPaypro: true, ...o })
  const board = buildBoard({ rows, credits: [mk({ id: 'c1', amountPkr: 386 }), mk({ id: 'c2', amountPkr: 7 })], ourPaypro: [], receipts: [], links: [], nowIso: '2026-10-11T06:00:00Z' })
  assert.deepEqual(matchSummary(board, 'c1'), { matched: true, text: 'Matched to 2 JazzCash orders settled 9 Oct' })
  assert.deepEqual(matchSummary(board, 'c2'), { matched: false, text: 'No match yet' })
  assert.deepEqual(matchSummary(board, 'nope'), { matched: false, text: 'No match yet' })
})

test('"Ignore (not a sale)": unlinked, not counted as unmatched, never deleted, owner only and audited', () => {
  const rows = parsePayproCsv(read('scripts', 'fixtures', 'paypro-orders-settled.csv'))
  const c: Credit = { id: 'c1', date: '2026-10-09', time: null, amountPkr: 386, senderName: 'PAYPRO PRIVATE LIMITED', senderBank: null, reference: 'R1', note: null, isPaypro: true }
  const stray: Credit = { ...c, id: 'c2', amountPkr: 5000, senderName: 'OWNER DEPOSIT', reference: 'R2', isPaypro: false }
  const build = (links: Parameters<typeof buildBoard>[0]['links']) => buildBoard({ rows, credits: [c, stray], ourPaypro: [], receipts: [], links, nowIso: '2026-10-11T06:00:00Z' })

  const before = monthView(build([]), [], '2026-10')
  assert.ok(before.attention.some((a) => a.kind === 'credit_unmatched' && a.creditId === 'c2'))

  const board = build([
    { transferId: 'c1', kind: 'none', target: NOT_A_SALE, note: 'saved twice by mistake' },
    { transferId: 'c2', kind: 'none', target: NOT_A_SALE, note: 'my own deposit' },
  ])
  const ignored = board.credits.find((x) => x.id === 'c1')!
  assert.deepEqual([ignored.state, ignored.match, ignored.ignoreNote], ['ignored', null, 'saved twice by mistake'], 'an ignored credit is not matched automatically either')
  const after = monthView(board, [], '2026-10')
  assert.ok(!after.attention.some((a) => a.kind === 'credit_unmatched'), 'no longer counts as unmatched')
  assert.equal(after.cards.unmatched, before.cards.unmatched - 1)
  assert.equal(after.cards.netSettled, 0)
  assert.equal(after.credits.length, 2, 'still on record')
  // Excluded from every money total and from the CSV; still listed on the page.
  assert.ok(!monthCsv(after).includes('R1') && !monthCsv(after).includes('R2'), 'not in the CSV export')
  assert.ok(monthCsv(before).includes('Bank credit,2026-10-09,R1'))
  assert.deepEqual(withoutIgnored([c, stray], new Set(['c2'])).map((x) => x.id), ['c1'])
  assert.deepEqual(withoutIgnored([c, stray], new Set()).length, 2, '"Back to automatic" counts it again')
  for (const f of ['finance.ts', 'settlement.ts']) {
    const src = read('lib', f)
    assert.ok(src.includes('ignoredCreditIds()') && src.includes('withoutIgnored('), `lib/${f} leaves ignored credits out of its totals`)
  }
  const ig = read('lib', 'ignoredCredits.ts')
  assert.ok(ig.includes(".eq('kind', 'none').eq('target', NOT_A_SALE).is('removed_at', null)"))
  assert.ok(read('app', 'admin', 'finance', 'settlement', 'SettlementsBoard.tsx').includes("c.state === 'ignored' ? CARD.replace('bg-white', 'bg-tm-bg') : CARD"), 'greyed, still listed')
  // A plain unlink is still a hold that DOES count as unmatched.
  const held = monthView(build([{ transferId: 'c2', kind: 'none', target: null, note: 'checking' }]), [], '2026-10')
  assert.ok(held.attention.some((a) => a.kind === 'credit_unmatched' && a.creditId === 'c2'))

  const lib = read('lib', 'settlementMatch.ts')
  assert.ok(lib.includes("[{ ...base, kind: 'none', target: NOT_A_SALE }]"))
  assert.ok(lib.includes("'settlement.ignore'"), 'audited')
  assert.ok(lib.includes("if (input.action !== 'auto' && !note)"), 'a note is required')
  assert.ok(!/from\('bank_transfers'\)\s*\.delete\(/.test(lib), 'a credit is never deleted')
  const route = read('app', 'api', 'admin', 'payments', 'settlement', 'links', 'route.ts')
  assert.ok(route.includes("z.enum(['link', 'unlink', 'ignore', 'auto'])"))
  assert.ok(route.includes('checkAdminRole(...SCREEN_ACCESS.finance)'))
  const ui = read('app', 'admin', 'finance', 'settlement', 'SettlementsBoard.tsx')
  assert.ok(ui.includes('Ignore (not a sale)') && ui.includes("openLink(c, 'ignore')"))
})

test('owner and Partner only: other staff cannot reach a credit or ignore one', () => {
  assert.deepEqual(SCREEN_ACCESS.finance, [])
  assert.equal(roleSatisfies('owner', SCREEN_ACCESS.finance), true)
  assert.equal(isReadOnlyRole('partner'), false) // full management since 13 Oct 2026 (was view-only)
  for (const r of ['admin', 'operations', 'tuitions_staff'] as const) assert.equal(roleSatisfies(r, SCREEN_ACCESS.finance), false, r)

  const route = read('app', 'api', 'admin', 'payments', 'settlement', 'credits', 'route.ts')
  assert.equal((route.match(/checkAdminRole\(\.\.\.SCREEN_ACCESS\.finance\)/g) ?? []).length, 2, 'GET and POST are both gated')
  // checkAdminRole refuses a Partner's POST (403, view-only) and a signed-out one (401).
  const auth = read('lib', 'adminAuth.ts')
  assert.ok(auth.includes('!roleMayWrite(actor.adminRole, allowed)) && !opts.self'))
  assert.ok(auth.includes("status: 401, error: 'Admin access required.'"))
  // The paste form is rendered only inside the block the Partner never gets.
  const ui = read('app', 'admin', 'finance', 'settlement', 'SettlementsBoard.tsx')
  const writeBlock = ui.slice(ui.indexOf('{!readOnly && (\n        <section'))
  assert.ok(ui.includes('useAdminReadOnly()') && writeBlock.includes('<AddBankCredits'))
  assert.equal((ui.match(/<AddBankCredits/g) ?? []).length, 1)
})

test('the form: paste only, read without a button, one Save, a warning first, by hand behind a link', () => {
  const ui = read('app', 'admin', 'finance', 'settlement', 'AddBankCredits.tsx')
  assert.ok(ui.includes('Paste one or more Faysal Bank alerts'))
  assert.ok(ui.includes('useMemo(() => parseBankAlerts(text), [text])'), 'read as soon as text is pasted')
  assert.ok(!ui.includes('Fill in from this text'))
  assert.ok(ui.includes("Credits can't be deleted after saving. Save ${creditsWord(n)}?"))
  assert.ok(ui.includes('`Save ${creditsWord(ready.length)}`'))
  assert.ok(ui.includes('Enter by hand instead'))
  assert.ok(ui.includes('Already saved') && ui.includes('unreadableText(status.missing)'))
})
