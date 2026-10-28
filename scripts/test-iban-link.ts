// scripts/test-iban-link.ts — /pay/choose: the IBAN behind a small link under
// the account number (owner, 28 Oct 2026).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bankCopyRows, splitBankRows, IBAN_LINK_LABEL } from '../lib/payments/bankCopyCore'

const bank = { bankName: 'Faysal Bank', accountTitle: 'Tutor Mint', accountNumber: '1234567890123', iban: 'PK00FAYS0001234567890123' }

test('the IBAN is not in the main rows; the account number keeps its Copy', () => {
  const { main, iban } = splitBankRows(bankCopyRows(bank as never, 'Rs 199'))
  assert.ok(!main.some((r) => r.key === 'iban'))
  const acct = main.find((r) => r.key === 'accountNumber')!
  assert.equal(acct.copyable, true)
  assert.ok(iban && iban.copyable, 'the IBAN keeps its own Copy when revealed')
  assert.equal(iban!.copy, 'PK00FAYS0001234567890123')
  assert.deepEqual(main.map((r) => r.key), ['accountTitle', 'bankName', 'accountNumber', 'amount'], 'nothing else changes')
})

test('no IBAN → no link; no account number → the IBAN stays in view', () => {
  assert.equal(splitBankRows(bankCopyRows({ ...bank, iban: '' } as never)).iban, null)
  const only = splitBankRows(bankCopyRows({ ...bank, accountNumber: '' } as never))
  assert.equal(only.iban, null)
  assert.ok(only.main.some((r) => r.key === 'iban'))
})

test('the page reveals the IBAN with the link under the account number', () => {
  assert.equal(IBAN_LINK_LABEL, 'Your app asks for IBAN? Tap here')
  const src = readFileSync('app/(site)/pay/choose/PayChoice.tsx', 'utf8')
  assert.match(src, /<BankRows rows=\{bankCopyRows\(bank, amount\)\} \/>/)
  assert.match(src, /r\.key === 'accountNumber' && iban &&/)
  assert.match(src, /onClick=\{\(\) => setShowIban\(true\)\}/)
  assert.match(src, /\{IBAN_LINK_LABEL\}/)
})
