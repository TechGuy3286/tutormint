/**
 * scripts/test-pay-page-cleanup.ts — the payment page clean-up and the Urdu
 * line on /membership-plans (owner, 26 Oct 2026). Source scans + pure rules.
 *   npm run test:paypagecleanup
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { bankCopyRows, COPYABLE_KEYS } from '../lib/payments/bankCopyCore'
import { receiptFileProblem } from '../lib/payments/receiptCore'

const read = (p: string) => readFileSync(p, 'utf8')
const CHOICE = read('app/(site)/pay/choose/PayChoice.tsx')
const PAGE = read('app/(site)/pay/choose/page.tsx')
const NAV = read('app/(site)/pay/manual/[ref]/OrderPageNav.tsx')
const ROUTE = read('app/api/payments/receipt/route.ts')

test('every removal from the payment page', () => {
  assert.match(PAGE, /<Breadcrumbs showBack=\{false\}/, 'the "Back to Tutor dashboard" link is gone; the breadcrumb stays')
  assert.doesNotMatch(PAGE, /'اپنی تصدیق مکمل کریں'/, 'the Urdu fee heading is gone')
  assert.doesNotMatch(PAGE, /One-time\. Non-refundable\./)
  assert.doesNotMatch(CHOICE, /You don’t need a Faysal Bank account|You can pay from any bank or wallet app/)
  assert.doesNotMatch(CHOICE, /Copy all details|CopyAll|copyAllText/)
  assert.doesNotMatch(CHOICE, /1\. Send |2\. Take a screenshot|3\. Upload it below/)
  assert.doesNotMatch(CHOICE, /A photo \(JPG, PNG, WebP\) or PDF, up to 5 MB\./)
  assert.doesNotMatch(CHOICE, /Transaction ID \/ reference \(optional\)/)
  assert.doesNotMatch(CHOICE, /setTxn|form\.set\('transactionId'/, 'no transaction ID box or field')
})

test('every change and what stays', () => {
  // The fee card heading changed again on 27 Oct 2026 — see test-fee-card.
  assert.match(PAGE, /\{FEE_CARD_TITLE\}/)
  assert.match(NAV, /<span>Back<\/span>/)
  assert.doesNotMatch(NAV, /واپس/, '"Back واپس" is now "Back"')
  assert.match(CHOICE, /export const WHATSAPP_US = 'WhatsApp us'/)
  assert.doesNotMatch(CHOICE, /Need help\? WhatsApp us/)
  // The WhatsApp logo sits on the left of the label.
  const btn = CHOICE.slice(CHOICE.indexOf('data-whatsapp-button'))
  assert.ok(btn.indexOf('/whatsapp.png') < btn.indexOf('{WHATSAPP_US}'))
  assert.match(PAGE, /Complete your verification/)
  assert.match(CHOICE, /PAY_BY_TRANSFER_LINE/)
  assert.match(CHOICE, /کسی بھی بینک ایپ، جاز کیش یا ایزی پیسہ سے اس اکاؤنٹ میں رقم بھیجیں، رسید کا اسکرین شاٹ لیں اور نیچے اپ لوڈ کریں۔/, 'the Urdu steps line, unchanged')
  assert.match(CHOICE, /'Upload receipt'/)
  assert.match(CHOICE, /'Send receipt'/)
  assert.match(PAGE, /Runs for 30 days\. Non-refundable\./, 'a plan keeps its own line')
})

test('Copy only on the account number and IBAN; the rows stay', () => {
  const rows = bankCopyRows({ bankName: 'Example Bank', accountTitle: 'Example Ltd', accountNumber: '0000 1111 2222 3333', iban: 'PK00 EXMP 0000 1111 2222 3333', raastId: null }, 'Rs 100')
  assert.deepEqual(rows.map((r) => r.label), ['Account title', 'Bank', 'Account number', 'IBAN', 'Amount'])
  assert.deepEqual(rows.filter((r) => r.copyable).map((r) => r.key), ['accountNumber', 'iban'])
  assert.deepEqual([...COPYABLE_KEYS], ['accountNumber', 'iban'])
  assert.match(CHOICE, /\{copyable && <button/)
})

test('receipts are accepted without a transaction ID; a wrong file still says why', () => {
  assert.match(ROUTE, /String\(form\.get\('transactionId'\) \?\? ''\)/, 'the field is optional')
  assert.match(ROUTE, /reference: transactionId \|\| null/, 'old values and the column stay')
  assert.ok(receiptFileProblem({ type: 'text/plain', size: 10 }), 'a wrong type is refused with a message')
  assert.ok(receiptFileProblem({ type: 'image/png', size: 50 * 1024 * 1024 }), 'a big file is refused with a message')
  assert.equal(receiptFileProblem({ type: 'image/png', size: 1000 }), null)
  assert.match(CHOICE, /setError\(f \? receiptFileProblem/, 'the message shows on picking a file')
})

test('the exact Urdu line on /membership-plans', () => {
  const ACTIVATION_URDU = /export const ACTIVATION_URDU = '([^']+)'/.exec(read('components/PackagesTable.tsx'))?.[1]
  assert.equal(
    ACTIVATION_URDU,
    'ادائیگی بینک ٹرانسفر کے ذریعے کریں — JazzCash، Easypaisa یا کسی بھی بینک ایپ سے Raast کے ذریعے — اور رسید اپ لوڈ کریں۔ تصدیق کے بعد آپ کا اکاؤنٹ فعال کر دیا جائے گا۔',
  )
  const table = read('components/PackagesTable.tsx')
  assert.match(table, /\{ACTIVATION_URDU\}/)
  assert.doesNotMatch(table, /آن لائن ادائیگی \(جاز کیش، ایزی پیسہ، کارڈ\) خود بخود فعال ہو جاتی ہے/)
})

test('the Terms still say the fee is one-time and non-refundable (not changed)', () => {
  const terms = read('app/(site)/terms/page.tsx')
  assert.match(terms, /It is paid once, never renews/)
  assert.match(terms, /It is non-refundable/)
})
