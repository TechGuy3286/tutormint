/**
 * scripts/test-pr106h3.ts  —  npm run test:pr106h3
 *
 * PR106-H3: payments list de-dup (each payment once, count matches), the
 * one-time-fee checkout refusal, post-payment redirect to the dashboard with a
 * message (failed → Complete Your Verification), auto-advance on single-choice
 * onboarding steps only, and the member search hidden for tuitions_staff. Pure
 * logic (dedupe) + source scans of the server/client guards. No DB/network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { dedupeById } from '../lib/dedupe'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ------------------------------------------------- 1.3: payments de-dup -----
test('dedupeById keeps each id once, first occurrence, in order', () => {
  const rows = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'a', n: 99 }, { id: 'c', n: 3 }]
  assert.deepEqual(dedupeById(rows), [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }])
  assert.deepEqual(dedupeById([]), [])
})

test('the payments screen de-dupes both lists so each row shows once', () => {
  const q = read('app/admin/payments/PaymentQueue.tsx')
  assert.match(q, /import \{ dedupeById \} from '@\/lib\/dedupe'/)
  assert.match(q, /allPayments = dedupeById\(\[\.\.\.payments, \.\.\.morePayments\.items\]\)/)
  assert.match(q, /allSubs = dedupeById\(\[\.\.\.subscriptions, \.\.\.moreSubs\.items\]\)/)
})

// ------------------------------------------- urgent: one-time fee refusal ---
test('checkout refuses a second verification-fee purchase (server-side)', () => {
  const r = read('app/api/payments/checkout/route.ts')
  assert.match(r, /plan\.code === 'verified'/, 'guards the fee plan')
  assert.match(r, /verified_fee_paid_at \|\| approvedFee/, 'blocks when the fee is paid OR already approved')
  assert.match(r, /code: 'fee_already_paid'[^]*status: 409/, 'answers 409 fee_already_paid')
})

// --------------------------------------------- STEP 2: post-payment flow ----
test('a paid fee returns to the dashboard with a green message; a failed one to Complete Your Verification', () => {
  const ret = read('app/(site)/pay/return/page.tsx')
  assert.match(ret, /plan_code === 'verified'/, 'only the fee is redirected')
  assert.match(ret, /redirect\('\/tutor\/dashboard\?paid=1'\)/, 'paid → dashboard?paid=1')
  assert.match(ret, /redirect\('\/tutor\/complete-profile\?pay=failed'\)/, 'failed → the verification screen')
  const toast = read('components/VerifiedToast.tsx')
  assert.match(toast, /paid[^]*Payment received\. Thank you!/, 'the green message')
  assert.match(toast, /searchParams\.delete\('paid'\)/, 'the param is stripped so it fires once')
  const flow = read('components/tutor/NewOnboardingFlow.tsx')
  assert.match(flow, /Your last payment didn&rsquo;t go through/, 'the one-line failed notice')
})

test('reopening onboarding after the fee is paid goes to the dashboard', () => {
  const flow = read('components/tutor/NewOnboardingFlow.tsx')
  assert.match(flow, /if \(facts\.feePaid\) \{\s*\n?\s*void leave\('\/tutor\/dashboard'\)/, 'feePaid at verify → dashboard')
})

// --------------------------------------------- STEP 3: auto-advance ---------
test('single-choice steps auto-advance; multi-select steps do not', () => {
  const flow = read('components/tutor/NewOnboardingFlow.tsx')
  // the helper: green immediately + ~300ms advance, cancellable
  assert.match(flow, /setTimeout\(\(\) => \{ void saveAndNext\(payload, patch\) \}, 300\)/, 'the 0.3s auto-advance')
  // single-choice steps use it
  assert.match(flow, /onClick=\{\(\) => pickSingle\(\{ tutorProfile: \{ gender: val \} \}/, 'gender auto-advances')
  assert.match(flow, /onClick=\{\(\) => pickSingle\(\{ tutorProfile: \{ experience_years: b\.years \} \}/, 'experience auto-advances')
  // multi-select (job types / teaching) toggles, never pickSingle
  assert.match(flow, /onClick=\{\(\) => toggle\(name\)\}/, 'job types stay multi-select with Next')
  assert.ok(!/pickSingle\([^)]*job_types/.test(flow), 'job types do NOT auto-advance')
  // the fixed Next stays visible on the auto-advance steps (shell renders it)
  assert.match(flow, /onNext: \(\) => facts\.gender && advanceFrom\(facts, 'gender'\)/, 'gender keeps a working Next')
})

// --------------------------------------------- STEP 4: hide member search ---
test('the member search is hidden for tuitions_staff', () => {
  const layout = read('app/admin/layout.tsx')
  assert.match(layout, /showMemberSearch = actor\.adminRole !== 'tuitions_staff'/)
  assert.match(layout, /search=\{showMemberSearch \? <AdminSearch \/> : null\}/)
})
