import { test } from 'node:test'
import assert from 'node:assert/strict'

import { payproOrderAccepted } from '../lib/payments/payproVerify'

// PR104 §1 — the ONE PayPro "is it paid for our price?" rule. The guard that
// rejected every live order (|OrderAmountPaid − price| < 1) is replaced by:
// PAID + right order + bill == our price + paid ≥ our price (a gateway fee on
// top is fine).

const expected = { ourPrice: 199, ourRef: 'TM-ABC' }

test('199 bill / 199 paid → accept', () => {
  assert.equal(
    payproOrderAccepted({ orderStatus: 'PAID', amountPayable: 199, amountPaid: 199, orderNumber: 'TM-ABC' }, expected).accepted,
    true,
  )
})

test('199 bill / 206 paid (Rs 7 gateway fee on top) → accept', () => {
  assert.equal(
    payproOrderAccepted({ orderStatus: 'PAID', amountPayable: 199, amountPaid: 206, orderNumber: 'TM-ABC' }, expected).accepted,
    true,
  )
})

test('199 bill / 150 paid (underpaid) → reject', () => {
  const r = payproOrderAccepted({ orderStatus: 'PAID', amountPayable: 199, amountPaid: 150, orderNumber: 'TM-ABC' }, expected)
  assert.equal(r.accepted, false)
  assert.equal(r.accepted === false && r.reason, 'underpaid')
})

test('bill 150 vs ours 199 → reject (bill_mismatch)', () => {
  const r = payproOrderAccepted({ orderStatus: 'PAID', amountPayable: 150, amountPaid: 150, orderNumber: 'TM-ABC' }, expected)
  assert.equal(r.accepted, false)
  assert.equal(r.accepted === false && r.reason, 'bill_mismatch')
})

test('status UNPAID → reject (not_paid)', () => {
  const r = payproOrderAccepted({ orderStatus: 'UNPAID', amountPayable: 199, amountPaid: 0, orderNumber: 'TM-ABC' }, expected)
  assert.equal(r.accepted, false)
  assert.equal(r.accepted === false && r.reason, 'not_paid')
})

test('fee folded into AmountPayable (206 payable / 206 paid) → accept', () => {
  // PayPro may echo the payable as the fee-inclusive total; a payable ≥ our
  // price must not reject (PR104 — the PR103 bug must not reappear on this field).
  assert.equal(
    payproOrderAccepted({ orderStatus: 'PAID', amountPayable: 206, amountPaid: 206, orderNumber: 'TM-ABC' }, expected).accepted,
    true,
  )
})

test('AmountPayable not reported (0) / 206 paid → accept', () => {
  assert.equal(
    payproOrderAccepted({ orderStatus: 'PAID', amountPayable: 0, amountPaid: 206, orderNumber: 'TM-ABC' }, expected).accepted,
    true,
  )
})

test('wrong order number → reject; missing order number is tolerated', () => {
  const wrong = payproOrderAccepted({ orderStatus: 'PAID', amountPayable: 199, amountPaid: 206, orderNumber: 'TM-OTHER' }, expected)
  assert.equal(wrong.accepted, false)
  assert.equal(wrong.accepted === false && wrong.reason, 'wrong_order')
  // PayPro may omit OrderNumber in ggos — a blank one must not reject a good pay.
  assert.equal(
    payproOrderAccepted({ orderStatus: 'PAID', amountPayable: 199, amountPaid: 206, orderNumber: '' }, expected).accepted,
    true,
  )
})
