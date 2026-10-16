// scripts/test-my-signups.ts — "My sign-ups" (owner, 16 Oct 2026).
//   npm run test:mysignups
// Pure rules (lib/mySignupsCore) plus source checks on the loader, routes and
// page. The live checks — the database refusing another staff member's rows,
// and the counts matching Team activity — are scripts/test-my-signups-live.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  FORBIDDEN_FIELD,
  MY_SIGNUP_ROW_KEYS,
  NEXT_STEP_TEMPLATE,
  claimReason,
  claimRow,
  countedInMonth,
  countedReason,
  creditRow,
  filterRows,
  EMPTY_FILTERS,
  newSignupNoticeTitle,
  nextStepOf,
  realEmail,
  stepOf,
  type MemberFacts,
} from '../lib/mySignupsCore'
import { targetScope } from '../lib/staffTargetsCore'
import { mayViewStaff } from '../lib/staffSignupsCore'

const NOW = Date.parse('2026-10-16T10:00:00Z')

const tutor = (over: Partial<MemberFacts> = {}): MemberFacts => ({
  role: 'tutor',
  signedUpAt: '2026-10-10T08:00:00Z',
  mobileVerifiedAt: '2026-10-10T08:05:00Z',
  onboardedAt: '2026-10-11T08:00:00Z',
  docsSubmitted: true,
  postedAt: null,
  paidAt: null,
  refunded: false,
  ...over,
})

const bodies = Object.fromEntries(Object.values(NEXT_STEP_TEMPLATE).map((t) => [t.key, `Hi {name}, next: {link}`]))
const row = (facts: MemberFacts, extra: Partial<Parameters<typeof creditRow>[0]> = {}) =>
  creditRow({
    memberId: 'm1',
    staffId: 's1',
    name: 'Ayesha Khan',
    phone: '03001234567',
    waNumber: '923001234567',
    email: 'ayesha@example.com',
    city: 'Lahore',
    creditedBy: 'link',
    facts,
    templateBodies: bodies,
    siteUrl: (p) => `https://www.tutormint.org${p}`,
    ...extra,
  })

test('a row carries exactly the allowed keys and none of the forbidden ones', () => {
  const r = row(tutor())
  assert.deepEqual(Object.keys(r).sort(), [...MY_SIGNUP_ROW_KEYS].sort())
  for (const k of Object.keys(r)) assert.ok(!FORBIDDEN_FIELD.test(k), `forbidden key ${k}`)
  const c = claimRow({ memberId: 'm2', staffId: 's1', name: 'X', maskedPhone: '0300•••••67', role: 'tutor', claimedAt: '2026-10-12T00:00:00Z', status: 'pending', reason: null })
  assert.deepEqual(Object.keys(c).sort(), [...MY_SIGNUP_ROW_KEYS].sort())
  // Paid is yes/no and a date only.
  const paid = row(tutor({ paidAt: '2026-10-12T09:00:00Z' }))
  assert.equal(paid.paid, true)
  assert.equal(paid.paidAt, '2026-10-12T09:00:00Z')
})

test('the loader and route never read or return CNIC, documents, receipts, payment or OTP fields', () => {
  const lib = readFileSync('lib/mySignups.ts', 'utf8')
  // The payment amount itself is never read (a refunded amount only decides a yes/no).
  assert.ok(!/[ ,']amount_pkr/.test(lib), 'reads a payment amount')
  for (const bad of ['screenshot_path', 'provider_ref', 'reference', 'iban', 'phone_otps', 'payment-proofs', 'storage_path', 'file_path']) {
    assert.ok(!lib.includes(bad), `lib/mySignups.ts mentions ${bad}`)
  }
  // CNIC fields are read only to work out a yes/no — never copied into a row.
  assert.ok(!/cnic_number\s*:/.test(lib) && !/cnicNumber/.test(lib))
  const route = readFileSync('app/api/admin/my-signups/route.ts', 'utf8')
  assert.match(route, /rows: page\.rows, card: page\.card, link:/)
  // A synthetic login address is never shown as an email.
  assert.equal(realEmail('923001234567@users.tutormint.org'), null)
})

test('a staff member cannot ask for another staff member\'s list', () => {
  const route = readFileSync('app/api/admin/my-signups/route.ts', 'utf8')
  assert.ok(!/searchParams|request\.url|params/.test(route), 'the route reads nothing from the request')
  assert.match(route, /loadMySignupsPage\(gate\.actor\.id\)/)
  const page = readFileSync('app/admin/my-signups/page.tsx', 'utf8')
  assert.match(page, /loadMySignupsPage\(actor\.id\)/)
  assert.ok(!/searchParams/.test(page))
  // The lists behind Team activity keep their own check.
  assert.equal(mayViewStaff({ id: 'a', adminRole: 'tuitions_staff' }, 'b'), false)
  assert.equal(mayViewStaff({ id: 'a', adminRole: 'admin' }, 'b'), true)
  // A WhatsApp tap is logged only for one's own sign-ups (or a viewable list).
  const lib = readFileSync('lib/mySignups.ts', 'utf8')
  assert.match(lib, /mayViewStaff\(\{ id: actor\.id, adminRole: actor\.adminRole \}, credit\.staff_id/)
})

test('steps and next steps — tutors', () => {
  assert.equal(nextStepOf(tutor({ mobileVerifiedAt: null, onboardedAt: null })), 'verify_mobile')
  assert.equal(nextStepOf(tutor({ onboardedAt: null })), 'finish_profile')
  assert.equal(nextStepOf(tutor({ docsSubmitted: false })), 'upload_documents')
  assert.equal(nextStepOf(tutor()), 'pay_fee')
  assert.equal(nextStepOf(tutor({ paidAt: '2026-10-12T09:00:00Z' })), 'done')
  assert.equal(stepOf(tutor({ mobileVerifiedAt: null, onboardedAt: null })), 'signed_up')
  assert.equal(stepOf(tutor({ onboardedAt: null })), 'mobile_verified')
  assert.equal(stepOf(tutor()), 'onboarded')
  assert.equal(row(tutor()).nextStepLabel, 'Pay Verification Fee')
  assert.match(row(tutor()).waLink ?? '', /^https:\/\/wa\.me\/923001234567\?text=Hi%20Ayesha/)
})

test('steps and next steps — parents', () => {
  const parent = (o: Partial<MemberFacts> = {}) => tutor({ role: 'parent', onboardedAt: null, ...o })
  assert.equal(nextStepOf(parent({ mobileVerifiedAt: null })), 'verify_mobile')
  assert.equal(nextStepOf(parent()), 'post_tuition')
  assert.equal(nextStepOf(parent({ postedAt: '2026-10-12T00:00:00Z' })), 'buy_plan')
  assert.equal(stepOf(parent({ postedAt: '2026-10-12T00:00:00Z' })), 'posted')
  assert.equal(row(parent({ postedAt: '2026-10-12T00:00:00Z' })).stepLabel, 'Posted a tuition')
  assert.equal(nextStepOf(parent({ postedAt: 'x', paidAt: '2026-10-13T00:00:00Z' })), 'done')
})

test('counted and the not-counted reasons', () => {
  assert.equal(countedReason(tutor({ paidAt: '2026-10-12T09:00:00Z' })), null)
  assert.equal(countedReason(tutor()), 'not_paid')
  assert.equal(countedReason(tutor({ refunded: true })), 'refunded')
  assert.equal(claimReason('pending', null), 'claim_waiting')
  assert.equal(claimReason('rejected', 'That account is already credited to someone.'), 'other_link')
  assert.equal(claimReason('rejected', 'Only accounts that signed up in the last 30 days can be claimed.'), 'outside_30')
  // A claim not credited shows a masked number, no email, no WhatsApp.
  const c = claimRow({ memberId: 'm2', staffId: 's1', name: 'X', maskedPhone: '0300•••••67', role: 'tutor', claimedAt: '2026-10-12T00:00:00Z', status: 'pending', reason: null })
  assert.equal(c.email, null)
  assert.equal(c.waLink, null)
  assert.equal(c.notCountedLabel, 'Claim waiting for Owner')
})

test('filters, search by phone, newest first, counted this month', () => {
  const a = row(tutor({ paidAt: '2026-10-12T09:00:00Z' }), { memberId: 'a', name: 'Ali', phone: '03211234567' })
  const b = { ...row(tutor({ signedUpAt: '2026-09-20T00:00:00Z' })), memberId: 'b', name: 'Bilal', signedUpAt: '2026-09-20T00:00:00Z' }
  const rows = [b, a]
  assert.deepEqual(filterRows(rows, EMPTY_FILTERS, NOW).map((r) => r.memberId), ['a', 'b'])
  assert.deepEqual(filterRows(rows, { ...EMPTY_FILTERS, counted: 'counted' }, NOW).map((r) => r.memberId), ['a'])
  assert.deepEqual(filterRows(rows, { ...EMPTY_FILTERS, month: 'last' }, NOW).map((r) => r.memberId), ['b'])
  assert.deepEqual(filterRows(rows, { ...EMPTY_FILTERS, q: '0321 1234' }, NOW).map((r) => r.memberId), ['a'])
  assert.deepEqual(filterRows(rows, { ...EMPTY_FILTERS, q: 'bil' }, NOW).map((r) => r.memberId), ['b'])
  assert.equal(countedInMonth(rows, NOW), 1)
})

test('in-house staff get no target and no pace', () => {
  // The month card reads the Team activity board as the staff member alone.
  assert.equal(targetScope('self', false), 'self')
  assert.equal(targetScope('self', true), 'target_self')
  const lib = readFileSync('lib/mySignups.ts', 'utf8')
  assert.match(lib, /loadTargetBoard\(\{ id: staffId, adminRole: 'self' \}/)
  assert.match(lib, /kind: 'in_house', month, paid:/)
  const page = readFileSync('app/admin/my-signups/page.tsx', 'utf8')
  // The in-house branch shows the count and nothing about targets or pace.
  const inHouse = page.slice(page.indexOf(') : ('), page.indexOf('{page.link'))
  assert.ok(!/target|pace|Needed|Counting/i.test(inHouse.replace(/card\.paid/g, '')))
})

test('the new sign-up notice', () => {
  assert.equal(newSignupNoticeTitle('Sara Ali', 'tutor'), 'New sign-up through your link: Sara Ali (Tutor)')
  assert.equal(newSignupNoticeTitle('Omar', 'parent'), 'New sign-up through your link: Omar (Parent)')
  const lib = readFileSync('lib/staffSignups.ts', 'utf8')
  assert.match(lib, /kind: 'staff_signup'/)
})

test('page opens and WhatsApp taps are logged', () => {
  assert.match(readFileSync('app/admin/my-signups/page.tsx', 'utf8'), /after\(\(\) => logMySignupsOpen/)
  assert.match(readFileSync('lib/mySignups.ts', 'utf8'), /staff\.my_signups_whatsapp/)
  assert.match(readFileSync('components/admin/SignupRows.tsx', 'utf8'), /\/api\/admin\/my-signups\/whatsapp/)
})
