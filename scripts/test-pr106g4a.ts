/**
 * scripts/test-pr106g4a.ts  —  npm run test:pr106g4a
 *
 * PR106-G4a: the new (staff-only) onboarding's Photo/Selfie/CNIC buttons, the
 * AI tagline & bio step, the Get-verified screen, and the dashboard "Complete
 * your payment" prompt. Pure logic (the AI brief/verifier) + source scans of the
 * SEPARATE NewOnboardingFlow — the shared CompleteProfileFlow and payment UI are
 * asserted untouched. No browser, no DB, no network, no real payment.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { NEW_FLOW_ORDER, stepDone, type FlowStepKey } from '../lib/tutorFlow'
import { parseTaglineReply, taglineForbidden, buildTaglineUser, TAGLINE_SYSTEM } from '../lib/ai/taglineBrief'
import type { OnboardingAnswers } from '../lib/onboarding/copy'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const FLOW = read('components/tutor/NewOnboardingFlow.tsx')

// ---------------------------------------------------------------- STEP 1 ----
test('Photo & Selfie show "Open camera" (navy) + "Choose from gallery" (green), tile tappable, no explanations', () => {
  assert.match(FLOW, /function CaptureButtons/, 'the shared capture buttons exist')
  assert.match(FLOW, /Open camera/, '"Open camera" button')
  assert.match(FLOW, /Choose from gallery/, '"Choose from gallery" button')
  assert.match(FLOW, /bg-tm-navy[^]*Open camera/, 'camera button is navy')
  assert.match(FLOW, /bg-tm-green-deep[^]*Choose from gallery/, 'gallery button is deep green')
  // the dashed tile is itself a button that opens the camera
  assert.match(FLOW, /border-dashed[^]*camRef\.current\?\.click/, 'dashed tile opens the camera')
  // the old PhotoCaptureTile and the selfie explanation line are gone
  assert.ok(!/PhotoCaptureTile/.test(FLOW), 'no PhotoCaptureTile import/usage left')
  assert.ok(!/Only our verification team sees your selfie/.test(FLOW), 'selfie explanation removed')
  assert.match(FLOW, /href="\/terms#identity"[^]*Terms/, 'one small Terms link remains')
})

// ---------------------------------------------------------------- STEP 2 ----
test('CNIC photos: Front/Back with "Take a photo" + "Upload a file", no side labels or verification line', () => {
  assert.match(FLOW, /function NewCnicPhotos/, 'inline CNIC photos step')
  assert.match(FLOW, /function CnicSideCapture/, 'per-side capture')
  assert.match(FLOW, /Take a photo/, '"Take a photo" button')
  assert.match(FLOW, /Upload a file/, '"Upload a file" button')
  assert.match(FLOW, /side="front"[^]*side="back"/, 'front and back side by side')
  // uploads to the shared documents endpoint, kind cnic, labelled by side
  assert.match(FLOW, /'kind', 'cnic'/, 'uploads as kind cnic')
  assert.match(FLOW, /'label', side/, 'labels front/back')
  assert.match(FLOW, /action: 'submit'/, 'submits for checking after both sides')
  // the removed Urdu side labels and the shared verification sentence
  assert.ok(!/سامنے کا رخ/.test(FLOW), 'front Urdu label removed')
  assert.ok(!/پچھلا رخ/.test(FLOW), 'back Urdu label removed')
  assert.ok(!/Only our verification team sees it/.test(FLOW), 'verification line removed from the new flow')
})

// ---------------------------------------------------------------- STEP 3 ----
test('a "tagline" step sits after CNIC photos and immediately before verify (so its button is "Finish")', () => {
  const i = (k: FlowStepKey) => NEW_FLOW_ORDER.indexOf(k)
  assert.ok(i('tagline') >= 0, 'tagline is in NEW_FLOW_ORDER')
  assert.ok(i('cnic_photos') < i('tagline'), 'after CNIC photos')
  assert.equal(NEW_FLOW_ORDER[i('tagline') + 1], 'verify', 'immediately before verify → Finish')
  // done when both headline and bio exist (stepDone reads only those two here)
  const mk = (headline: string | null, bio: string | null) =>
    ({ headline, bio }) as unknown as Parameters<typeof stepDone>[0]
  assert.equal(stepDone(mk('x', 'y'), 'tagline'), true)
  assert.equal(stepDone(mk('x', ''), 'tagline'), false)
})

test('the tagline step calls the AI route, prefills + lets you edit, and offers "Rewrite with AI"', () => {
  assert.match(FLOW, /function TaglineStep/, 'tagline step component')
  assert.match(FLOW, /fetch\('\/api\/tutor\/tagline', \{ method: 'POST' \}\)/, 'calls the AI route')
  assert.match(FLOW, /Rewrite with AI/, '"Rewrite with AI" action')
  assert.match(FLOW, /useState\(facts\.headline \?\? ''\)/, 'tagline prefilled from saved data, editable')
  assert.match(FLOW, /useState\(facts\.bio \?\? ''\)/, 'bio prefilled from saved data, editable')
})

test('the AI route exists and is self-scoped + rate-limited', () => {
  const r = read('app/api/tutor/tagline/route.ts')
  assert.match(r, /auth\.getUser\(\)/, 'reads the signed-in user')
  assert.match(r, /rateLimit\('ai_generate'/, 'rate-limited')
  assert.match(r, /generateTagline\(/, 'calls the generator')
})

// --------- STEP 3: the AI brief is pure, verified, and falls back -----------
test('parseTaglineReply reads the model JSON, or null when unusable', () => {
  assert.deepEqual(parseTaglineReply('{"tagline":"O Level Physics tutor in Lahore","bio":"I teach clearly."}'),
    { tagline: 'O Level Physics tutor in Lahore', bio: 'I teach clearly.' })
  assert.deepEqual(parseTaglineReply('Sure! {"tagline":"A","bio":"B"} hope that helps'),
    { tagline: 'A', bio: 'B' }, 'tolerates prose around the JSON')
  assert.equal(parseTaglineReply('no json here'), null)
  assert.equal(parseTaglineReply('{"tagline":123,"bio":"B"}'), null, 'wrong types rejected')
})

test('taglineForbidden blocks a phone/CNIC/address leak and passes clean copy', () => {
  assert.equal(taglineForbidden({ tagline: 'Maths tutor', bio: 'I teach Maths well.' }, {}), null, 'clean passes')
  assert.ok(taglineForbidden({ tagline: 'Call 03001234567', bio: 'ok' }, {}), 'phone blocked')
  assert.ok(taglineForbidden({ tagline: 'CNIC 3520112345671', bio: 'ok' }, {}), 'CNIC (13 digits) blocked')
  assert.ok(taglineForbidden({ tagline: 'Tutor', bio: 'Visit 42 Model Town Lahore' }, { address: '42 Model Town Lahore' }), 'own address blocked')
  assert.ok(taglineForbidden({ tagline: '', bio: 'x' }, {}), 'empty blocked')
  // a fee range (≤ 6 digits with separators) is allowed
  assert.equal(taglineForbidden({ tagline: 'Maths tutor', bio: 'Fees Rs 5,000 to 15,000.' }, {}), null, 'fee range allowed')
})

test('buildTaglineUser lists the facts given and omits the blanks; the system prompt forbids inventing', () => {
  const a: OnboardingAnswers = { city: 'Lahore', areas: ['Johar Town'], subjectNames: ['Physics'], levelNames: ['O Levels'], jobTypes: ['Home Tutor'], experienceBand: '3–5' }
  const u = buildTaglineUser(a)
  assert.match(u, /Lahore/); assert.match(u, /Physics/); assert.match(u, /O Levels/)
  const empty: OnboardingAnswers = { city: null, areas: [], subjectNames: [], levelNames: [], jobTypes: [], experienceBand: null }
  assert.ok(!/City:/.test(buildTaglineUser(empty)), 'omits a blank city')
  assert.match(TAGLINE_SYSTEM, /Invent NOTHING/i, 'never invent facts')
  assert.match(TAGLINE_SYSTEM, /Never promise/i, 'never promise tuitions/income')
})

// ---------------------------------------------------------------- STEP 4 ----
// NOTE: PR106-G4b SUPERSEDED G4a's "Complete verification" → TutorVerifyGate
// screen. The final screen is now "Complete Your Verification" going straight to
// PayPro (test:pr106g4b owns the full assertions). Here we only keep what still
// holds: a clean Get-verified screen with the commission message and none of the
// old clutter.
test('Get verified screen is clean (no CNIC card / Continue / Pay later clutter)', () => {
  assert.match(FLOW, /function GetVerifiedStep/, 'the clean Get-verified screen')
  assert.match(FLOW, /You pay no commission to TutorMint/, 'the commission message')
  for (const gone of ['being checked', 'documents received', 'Continue to become', 'Pay later']) {
    assert.ok(!new RegExp(gone).test(FLOW), `"${gone}" removed from the new flow`)
  }
})

// ---------------------------------------------------------------- STEP 5 ----
// NOTE: PR106-G4b gated this card behind the staff switch; the non-staff path
// still shows the pending-invoice prompt (test:pr106g4b owns the full gating).
test('the dashboard still shows "Complete your payment" to non-staff for an unpaid, unexpired invoice', () => {
  const page = read('app/(site)/tutor/dashboard/page.tsx')
  assert.match(page, /!staffNew && !ent\.verified \? await pendingPayproInvoice\(userId\)/, 'non-staff + unverified only')
  assert.match(page, /\{pendingInvoice && <CompletePaymentPrompt url=\{pendingInvoice\.url\}/, 'rendered only when an invoice exists')
  const helper = read('lib/payments/pendingInvoice.ts')
  assert.match(helper, /status', 'pending'/, 'only pending orders')
  assert.match(helper, /ageMs < DAY_MS && click2pay/, 'only < 24h with a Click2Pay link')
  const prompt = read('components/tutor/CompletePaymentPrompt.tsx')
  assert.match(prompt, /Complete payment/, 'red button reopening the invoice')
  assert.match(prompt, /href=\{url\}/, 'links to the same invoice url')
})

// ------------------- the guardrails this PR must not cross ------------------
test('CompleteProfileFlow and the shared payment UI are NOT changed by this PR', () => {
  const cpf = read('components/tutor/CompleteProfileFlow.tsx')
  assert.ok(!/NewOnboardingFlow|CaptureButtons|NewCnicPhotos|pendingPayproInvoice|CompletePaymentPrompt/.test(cpf),
    'CompleteProfileFlow does not reference any of the new onboarding pieces')
  // NOTE: G4a reused TutorVerifyGate on the final screen; PR106-G4b SUPERSEDED
  // that — the final screen now calls /api/payments/checkout directly, so the
  // flow no longer imports TutorVerifyGate. (test:pr106g4b covers the new path.)
})
