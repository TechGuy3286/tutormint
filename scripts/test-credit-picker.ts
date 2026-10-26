/**
 * scripts/test-credit-picker.ts — "Record a bank payment" credit picker (owner,
 * 27 Oct 2026): only unlinked credits, never matched ones, never PayPro
 * payouts, never above Rs 5,000; the selected amount on top, then newest; an
 * inline "+ Add a credit" that returns with the new credit selected.
 * Invented data only.   npm run test:creditpicker
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { PICKER_MAX_PKR, pickerCredits, pickerOffers, sortPickerCredits, type PickerCreditFacts } from '../lib/bankPaymentLinkCore'

const read = (p: string) => readFileSync(p, 'utf8')
const c = (id: string, o: Partial<PickerCreditFacts>): PickerCreditFacts & { id: string } => ({
  id,
  state: 'unmatched',
  isPaypro: false,
  amountPkr: 199,
  date: '2026-10-20',
  time: '10:00',
  ...o,
})

test('only unlinked credits are offered', () => {
  assert.equal(pickerOffers(c('a', {})), true)
  assert.equal(pickerOffers(c('b', { state: 'held' })), true, 'unlinked by hand = free')
  assert.equal(pickerOffers(c('c', { state: 'matched' })), false, 'already matched (any rule, the automatic receipt guess included)')
  assert.equal(pickerOffers(c('d', { state: 'ignored' })), false, 'not a sale')
  assert.equal(pickerOffers(c('e', { state: null })), false)
})

test('never a PayPro payout, never above Rs 5,000', () => {
  assert.equal(PICKER_MAX_PKR, 5000)
  assert.equal(pickerOffers(c('p', { isPaypro: true })), false)
  assert.equal(pickerOffers(c('x', { amountPkr: 5000 })), true)
  assert.equal(pickerOffers(c('y', { amountPkr: 5000.5 })), false)
  assert.equal(pickerOffers(c('z', { amountPkr: 25000 })), false)
  assert.equal(pickerOffers(c('0', { amountPkr: 0 })), false)
})

test('credits for the selected amount come first, then newest first', () => {
  const list = [
    c('old499', { amountPkr: 499, date: '2026-10-01' }),
    c('new199', { amountPkr: 199, date: '2026-10-25', time: '09:00' }),
    c('new199late', { amountPkr: 199, date: '2026-10-25', time: '18:30' }),
    c('mid499', { amountPkr: 499, date: '2026-10-10' }),
    c('paid', { state: 'matched', amountPkr: 499, date: '2026-10-26' }),
  ]
  assert.deepEqual(pickerCredits(list, 499).map((x) => x.id), ['mid499', 'old499', 'new199late', 'new199'])
  assert.deepEqual(pickerCredits(list, null).map((x) => x.id), ['new199late', 'new199', 'mid499', 'old499'])
  assert.deepEqual(sortPickerCredits(list.slice(0, 2), 199).map((x) => x.id), ['new199', 'old499'])
})

test('the server list and the picker both use this rule; Add a credit returns selected', () => {
  const server = read('lib/bankPaymentLink.ts')
  assert.ok(server.includes('.filter((c) => pickerOffers('))
  assert.ok(!/\.filter\(\(c\) => creditLinkable\(/.test(server), 'the picker no longer offers automatically matched credits')
  const ui = read('components/admin/LinkBankCredit.tsx')
  assert.ok(ui.includes('sortPickerCredits(credits, selectedPrice)'))
  assert.ok(ui.includes('Add a credit'))
  assert.ok(ui.includes('<AddBankCredits'))
  assert.ok(ui.includes('setCreditId(added.id)'), 'the new credit is selected after saving')
  const add = read('app/admin/finance/settlement/AddBankCredits.tsx')
  assert.ok(add.includes('onSaved?.(got.filter((g) => g.ok).map((g) => g.reference))'))
  assert.ok(add.includes('isPaypro: false'), 'from a member payment a typed credit is the member’s own transfer')
})
