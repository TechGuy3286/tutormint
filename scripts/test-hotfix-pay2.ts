/**
 * scripts/test-hotfix-pay2.ts  —  npm run test:hotfixpay2
 *
 * HOTFIX-PAY2: PayPro rejects a CustomerName with a digit (the real "Test Tutor
 * 6" failure), mislabelled as "PayPro not responding"; and a refresh resumed at
 * the CNIC step because the onboarding flow hardcoded the CNIC facts to null.
 *   - payproCustomerName strips digits/symbols (pure, unit-tested).
 *   - a PayPro DECLINE (reason 'rejected' → code payment_failed) maps to the
 *     our-error line; only a timeout/5xx (reason 'unavailable' → paypro_unavailable)
 *     maps to "PayPro not responding".
 *   - the gap-flow reads the REAL CNIC state, so an uploaded CNIC counts as done
 *     and a refresh resumes at the first genuinely unfinished step.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { payproCustomerName } from '../lib/payments/payproName'
import { stepDone, firstMissingStep, NEW_FLOW_ORDER, type FlowFacts } from '../lib/tutorFlow'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// --------------------------------------------- STEP 1: checkout name --------
test('payproCustomerName drops digits/symbols that PayPro rejects, keeps a real name', () => {
  assert.equal(payproCustomerName('Test Tutor 6'), 'Test Tutor') // the real failing case
  assert.equal(payproCustomerName('Ali Khan'), 'Ali Khan')
  assert.equal(payproCustomerName("Muhammad Bilal-Ahmed O'Neil"), "Muhammad Bilal-Ahmed O'Neil")
  assert.equal(payproCustomerName('  Ayesha   Siddiqui  '), 'Ayesha Siddiqui') // collapsed/trimmed
  assert.equal(payproCustomerName('12345'), 'Customer') // nothing left → fallback
  assert.equal(payproCustomerName(''), 'Customer')
  assert.equal(payproCustomerName(null), 'Customer')
  assert.ok(!/\d/.test(payproCustomerName('Grade 10 Teacher 2024')), 'never sends a digit to PayPro')
})

test('createPayproOrder uses the sanitiser and classifies the failure reason', () => {
  const pp = read('lib/payments/paypro.ts')
  assert.match(pp, /CustomerName: payproCustomerName\(o\.customerName\)/, 'the order sends the sanitised name')
  // a thrown request (timeout/connection) → unavailable; a declined order → rejected
  assert.match(pp, /PayPro create-order failed\.', reason: 'unavailable'/, 'timeout/connection → unavailable')
  assert.match(pp, /PayPro create-order failed: \$\{desc\}`, reason: 'rejected'/, 'PayPro declined our order → rejected (our bug)')
})

// --------------------------------------------- STEP 2: honest messages ------
test('the route maps reason to an honest code; the hook maps the code to the right line', () => {
  const route = read('app/api/payments/checkout/route.ts')
  assert.match(route, /started\.reason === 'unavailable' \? 'paypro_unavailable' : 'payment_failed'/, 'unavailable→paypro code, else our code')
  const hook = read('components/tutor/useVerifyCheckout.ts')
  assert.match(hook, /data\?\.code === 'paypro_unavailable' \|\| \(!data\?\.code && res\.status >= 500\)/, 'only a real outage is "PayPro not responding"')
  // the two member lines are unchanged and distinct
  assert.match(hook, /PayPro is not responding right now/, 'PayPro-down line')
  assert.match(hook, /message us on WhatsApp 0321 5872222/, 'our-error line with WhatsApp')
})

// --------------------------------------------- STEP 3/4: CNIC recognition ---
test('the gap-flow reads the REAL CNIC state (no hardcoded null) and resumes correctly', () => {
  const flow = read('components/tutor/NewOnboardingFlow.tsx')
  assert.ok(!/cnicNumber: null, cnicImagePath: null/.test(flow), 'the CNIC hardcode is gone')
  assert.match(flow, /cnicNumber: f\.cnicNumber, cnicImagePath: \(f\.cnicFrontPreview && f\.cnicBackPreview\) \? 'y' : null/, 'projects the real CNIC facts')
  assert.match(flow, /cnic_number/, 'load() fetches the saved CNIC number')

  // A tutor with a saved number + both CNIC docs: both CNIC steps read done.
  const base = {
    fullName: 'T', gender: 'male', city: 'Islamabad', area: 'F-8', avatarUrl: 'a', headline: 'h', bio: 'b',
    experienceYears: 10, hourlyRate: 5000, jobTypes: ['Home Tutor'], degreesCount: 2, degreeDocCount: 0,
    degrees: [{}, {}], cnicNumber: '35502-6457892-3', cnicImagePath: 'y', subjectCount: 12, selfieDone: true,
    availabilityCount: 15, phoneVerified: true, whatsapp: '03004811501', feePaid: false, noDegreeYet: false,
    isSeed: false, isTeamAccount: false, isBanned: false, isSuspended: false, underReview: false,
    verificationStatus: null, imported: false, claimedAt: null,
  } as unknown as FlowFacts
  assert.equal(stepDone(base, 'cnic_number'), true, 'saved CNIC number → cnic_number done')
  assert.equal(stepDone(base, 'cnic_photos'), true, 'both CNIC images → cnic_photos done')
  // Everything done except the fee → a refresh resumes at the final verify step,
  // NOT at CNIC.
  assert.equal(firstMissingStep(base, NEW_FLOW_ORDER), 'verify', 'resumes at the final screen, not CNIC')

  // Missing CNIC images → cnic_photos is the first unfinished step (honest).
  const noCnic = { ...base, cnicImagePath: null } as FlowFacts
  assert.equal(stepDone(noCnic, 'cnic_photos'), false, 'no CNIC image → not done')
  assert.equal(firstMissingStep(noCnic, NEW_FLOW_ORDER), 'cnic_photos', 'resumes at CNIC only when genuinely missing')
})
