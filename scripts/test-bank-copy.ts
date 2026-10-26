/**
 * scripts/test-bank-copy.ts — the copyable bank details on the payment page
 * (owner, 26 Oct 2026). Invented account details only.
 *   npm run test:bankcopy
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { bankCopyRows, compactNumber, copyAllText, COPIED_MS, DEFAULT_BANK_NAME, groupsOf4 } from '../lib/payments/bankCopyCore'
import { SETTING_KEYS } from '../lib/payments/manual'
import { MASKED_BANK_FIELDS } from '../lib/ownerAlertCore'
import { SCREEN_ACCESS } from '../lib/adminAccessCore'

const D = {
  bankName: 'Faysal Bank',
  accountTitle: 'Example Learning Pvt Ltd',
  accountNumber: '0123 4567 8901 2345',
  iban: 'PK00 FAYS 0123 4567 8901 2345',
  raastId: null as string | null,
}

test('numbers are shown in groups of 4 and copied without spaces', () => {
  assert.equal(groupsOf4('PK00FAYS0123456789012345'), 'PK00 FAYS 0123 4567 8901 2345')
  assert.equal(compactNumber('0123-4567 8901 2345'), '0123456789012345')
  const rows = bankCopyRows(D)
  const acc = rows.find((r) => r.key === 'accountNumber')!
  assert.equal(acc.display, '0123 4567 8901 2345')
  assert.equal(acc.copy, '0123456789012345')
  const iban = rows.find((r) => r.key === 'iban')!
  assert.equal(iban.copy, 'PK00FAYS0123456789012345')
  assert.doesNotMatch(iban.copy, /\s/)
})

test('rows in the owner’s order; Raast ID only when set; amount last', () => {
  assert.deepEqual(bankCopyRows(D).map((r) => r.label), ['Account title', 'Bank', 'Account number', 'IBAN'])
  const withRaast = bankCopyRows({ ...D, raastId: '0300 0000000' }, 'Rs 199')
  assert.deepEqual(withRaast.map((r) => r.label), ['Account title', 'Bank', 'Account number', 'IBAN', 'Raast ID', 'Amount'])
  assert.equal(withRaast.find((r) => r.key === 'raastId')!.copy, '03000000000')
  assert.equal(bankCopyRows({ ...D, bankName: null })[1].display, DEFAULT_BANK_NAME)
})

test('"Copy all details" is one tidy message with numbers unspaced', () => {
  const text = copyAllText({ ...D, raastId: '0300 0000000' }, 'Rs 199')
  assert.equal(
    text,
    [
      'TutorMint bank transfer details',
      'Account title: Example Learning Pvt Ltd',
      'Bank: Faysal Bank',
      'Account number: 0123456789012345',
      'IBAN: PK00FAYS0123456789012345',
      'Raast ID: 03000000000',
      'Amount: Rs 199',
    ].join('\n'),
  )
})

test('"Copied ✓" stays 2 seconds; the page has a Copy all button and big tap targets', () => {
  assert.equal(COPIED_MS, 2000)
  const src = readFileSync('app/(site)/pay/choose/PayChoice.tsx', 'utf8')
  assert.match(src, /Copied ✓/)
  assert.match(src, /Copy all details/)
  assert.match(src, /copyAllText\(bank, amount\)/)
  assert.match(src, /min-h-\[48px\] min-w-\[88px\]/)
})

test('details come from settings; only the Owner edits them; every edit is logged, masked', () => {
  assert.equal(SETTING_KEYS.raastId, 'pay.raast_id')
  assert.deepEqual(SCREEN_ACCESS.paymentGateways, [])
  const route = readFileSync('app/api/admin/payments/bank-details/route.ts', 'utf8')
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.paymentGateways\)/)
  assert.match(route, /requireFreshAuth/)
  assert.match(route, /logAdminAction/)
  assert.match(route, /SETTING_KEYS\.raastId/)
  for (const f of ['accountNumber', 'iban', 'raastId']) assert.ok((MASKED_BANK_FIELDS as readonly string[]).includes(f), f)
  // No account value is hard-coded in the payment page.
  const choice = readFileSync('app/(site)/pay/choose/PayChoice.tsx', 'utf8')
  assert.doesNotMatch(choice, /PK\d{2}[A-Z]{4}\d{6,}/)
})
