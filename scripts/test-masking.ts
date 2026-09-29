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

// ── PR91 Part A — tuition text masking (partial phone + email) ──

import { maskTuitionText, extractTuitionContacts } from '../lib/maskTuition'

test('maskTuitionText: a phone keeps its first 4 digits, then dots', () => {
  const r = maskTuitionText('Please contact 0313-0042960 for details')
  assert.equal(r.masked, true)
  assert.equal(r.text, 'Please contact 0313-••••••• for details')
})

test('maskTuitionText: 03130042960 (no separator) → 0313•••••••', () => {
  assert.equal(maskTuitionText('call 03130042960 now').text, 'call 0313••••••• now')
})

test('maskTuitionText: an email becomes the email mask', () => {
  const r = maskTuitionText('email me at parent.name@gmail.com please')
  assert.equal(r.masked, true)
  assert.equal(r.text, 'email me at •••••@••••• please')
})

test('maskTuitionText: a fee range / years are NOT masked', () => {
  assert.equal(maskTuitionText('Budget is 15000-20000 per month').masked, false)
  assert.equal(maskTuitionText('exams in 2024 2025 2026').masked, false)
})

test('maskTuitionText: masks both a phone and an email in one string', () => {
  const r = maskTuitionText('WhatsApp 0300 1234567 or a@b.com')
  assert.equal(r.masked, true)
  assert.ok(r.text.includes('0300') && r.text.includes('•••••@•••••'))
  assert.ok(!r.text.includes('1234567'))
})

test('maskTuitionText: empty/no-contact text is unchanged', () => {
  assert.deepEqual(maskTuitionText('Home tutor needed for Grade 5'), {
    text: 'Home tutor needed for Grade 5',
    masked: false,
  })
  assert.deepEqual(maskTuitionText(null), { text: '', masked: false })
})

test('extractTuitionContacts: pulls the phone run and email out of the text', () => {
  const got = extractTuitionContacts('reach 0313-0042960 or teacher@school.pk', 'also 03009998877')
  assert.deepEqual(got.emails, ['teacher@school.pk'])
  // The raw runs are returned (the caller normalises); both phones present.
  assert.equal(got.phones.length, 2)
  assert.ok(got.phones.some((p) => p.includes('0313')))
  assert.ok(got.phones.some((p) => p.includes('03009998877')))
})

// ── PR92 — masked contact teaser ──

import { phoneTeaser, EMAIL_TEASER } from '../lib/maskTuition'

test('phoneTeaser: keeps first 4 digits then dots', () => {
  assert.equal(phoneTeaser('0313-0042960'), '0313-•••••••')
  // from a canonical MSISDN → local shape first
  assert.equal(phoneTeaser('923130042960', true), '0313 •••••••')
  assert.equal(phoneTeaser('', false), null)
  assert.equal(phoneTeaser(null), null)
  assert.equal(EMAIL_TEASER, '•••••@•••••')
})
