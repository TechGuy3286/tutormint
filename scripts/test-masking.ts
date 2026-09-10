// npm run test:masking
//
// The masking rule must catch Pakistani mobiles and CNICs in every shape a
// person types them, and must NOT fire on the ordinary numbers of a
// parent-tutor thread — fee ranges, price lists, years, dates. The second half
// is the point: masking "My budget is 15000-20000" reads as the other side
// smuggling a contact number, and a false positive there is worse than a miss.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { maskPhoneNumbers } from '../lib/masking'

// A number is caught wherever it sits in the sentence, so each case is wrapped
// in ordinary words too — the outcome must not depend on the number standing
// alone.
function masks(input: string): boolean {
  return maskPhoneNumbers(input).masked && maskPhoneNumbers(`please call ${input} thanks`).masked
}

function leaves(input: string): boolean {
  return !maskPhoneNumbers(input).masked && !maskPhoneNumbers(`note: ${input} ok`).masked
}

const MASKED = [
  '0300 1234567',
  '03001234567',
  '+92 300 1234567',
  '923001234567',
  '00923001234567',
  '3001234567',
  '0 3 0 0 1 2 3 4 5 6 7',
  '0300-123-4567',
  '35202-1234567-8', // CNIC
]

const NOT = [
  '15000-20000',
  '2000 2500 3000',
  '2019 2020 2021',
  '10.09.2026',
  'I can do 2000 per month',
  'Fees: 2000, 2500, 3000',
]

for (const n of MASKED) {
  test(`masks: ${n}`, () => {
    assert.equal(masks(n), true, `${n} should be masked`)
  })
}

for (const n of NOT) {
  test(`leaves: ${n}`, () => {
    assert.equal(leaves(n), true, `${n} should NOT be masked`)
  })
}

test('the masked number is actually replaced, surrounding text kept', () => {
  const r = maskPhoneNumbers('call me on 0300 1234567 tomorrow')
  assert.equal(r.masked, true)
  assert.match(r.text, /^call me on .+ tomorrow$/)
  assert.equal(/\d/.test(r.text.replace(/tomorrow/, '')), false) // no digits left in the mobile
})

test('a real mobile between two prices is still caught (PATTERNS), prices are not', () => {
  const r = maskPhoneNumbers('budget 15000-20000, reach me 0300 1234567')
  assert.equal(r.masked, true)
  assert.match(r.text, /15000-20000/) // the range survives
})

test('empty / null input is a no-op', () => {
  assert.equal(maskPhoneNumbers('').masked, false)
  assert.equal(maskPhoneNumbers(null).masked, false)
  assert.equal(maskPhoneNumbers(undefined).masked, false)
})
