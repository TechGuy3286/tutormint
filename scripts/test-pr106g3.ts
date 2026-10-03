/**
 * scripts/test-pr106g3.ts  —  npm run test:pr106g3
 *
 * PR106-G3 part 1: the New-onboarding rollout switch, the PayPro mode line, and
 * the new flow's order + Gender first step. Pure logic + source scans. The new
 * flow is gated to staff by the switch; the live flow keeps FLOW_ORDER.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { parseOnboardingMode, showNewOnboarding } from '../lib/onboardingMode'
import { payproModeFrom } from '../lib/payments/paymentOpen'
import { NEW_FLOW_ORDER, FLOW_ORDER, firstMissingStep, stepDone } from '../lib/tutorFlow'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ----------------------------------------------- the switch (§1) -------------

test('onboarding mode parses to a safe default of "staff"', () => {
  assert.equal(parseOnboardingMode('off'), 'off')
  assert.equal(parseOnboardingMode('everyone'), 'everyone')
  assert.equal(parseOnboardingMode('staff'), 'staff')
  assert.equal(parseOnboardingMode(null), 'staff', 'unset → staff')
  assert.equal(parseOnboardingMode('garbage'), 'staff', 'unknown → staff')
})

test('the switch routes the right flow; a normal tutor never sees the new flow while "staff only"', () => {
  // off → nobody
  assert.equal(showNewOnboarding('off', true), false)
  assert.equal(showNewOnboarding('off', false), false)
  // staff → staff only
  assert.equal(showNewOnboarding('staff', true), true, 'staff sees it')
  assert.equal(showNewOnboarding('staff', false), false, 'normal tutor does NOT')
  // everyone → all
  assert.equal(showNewOnboarding('everyone', true), true)
  assert.equal(showNewOnboarding('everyone', false), true)
})

// ----------------------------------------------- PayPro mode (§4) ------------

test('PayPro mode is derived from the configured facts, never the secret', () => {
  assert.equal(payproModeFrom({ configured: true, sandbox: false }), 'live')
  assert.equal(payproModeFrom({ configured: true, sandbox: true }), 'sandbox')
  assert.equal(payproModeFrom({ configured: false, sandbox: false }), 'not_set')
})

// ----------------------------------------------- new order + gender ----------

test('the new flow order starts with Gender and both flows share the same step keys/data', () => {
  assert.equal(NEW_FLOW_ORDER[0], 'gender', 'Gender is first')
  assert.ok(!FLOW_ORDER.includes('gender'), 'the current flow never shows gender as a step')
  assert.ok(!NEW_FLOW_ORDER.includes('name'), 'signup name is never re-asked')
  // Every new-flow step is an existing step key OR one of the two new-flow-only
  // steps whose data the old flow still collects (gender + tagline/bio live on
  // the old flow's 'contact' step), so switching flows loses nothing. (PR106-G4a
  // added 'tagline'.)
  for (const k of NEW_FLOW_ORDER) {
    assert.ok(k === 'gender' || k === 'tagline' || FLOW_ORDER.includes(k), `${k} is a shared step`)
  }
})

test('a brand-new tutor opens at Gender in the new flow, at City in the current flow', () => {
  const blank = {
    fullName: 'Ali', gender: null, city: null, area: null, avatarUrl: null, headline: null, bio: null,
    experienceYears: null, hourlyRate: null, jobTypes: [], degreesCount: 0, degreeDocCount: 0, degrees: [],
    cnicNumber: null, cnicImagePath: null, subjectCount: 0, selfieDone: false, availabilityCount: 0,
    phoneVerified: true, whatsapp: null, feePaid: false, noDegreeYet: false, isSeed: false,
    isTeamAccount: false, isBanned: false, isSuspended: false, underReview: false, verificationStatus: null,
    imported: false, claimedAt: null,
  } as never
  assert.equal(firstMissingStep(blank, NEW_FLOW_ORDER), 'gender')
  assert.equal(firstMissingStep(blank, FLOW_ORDER), 'city')
  assert.equal(stepDone({ gender: 'trans' } as never, 'gender'), true)
  assert.equal(stepDone({ gender: null } as never, 'gender'), false)
})

// ----------------------------------------------- wiring (source scans) -------

test('the admin switch UI + route + the onboarding pages are wired', () => {
  assert.match(read('app/admin/payments/settings/page.tsx'), /OnboardingModeForm/, 'switch UI on the settings page')
  assert.match(read('app/admin/payments/settings/page.tsx'), /PayPro mode/, 'PayPro mode line')
  assert.match(read('app/api/admin/onboarding-mode/route.ts'), /ONBOARDING_MODE_KEY/, 'the save route')
  for (const p of ['app/(site)/tutor/onboarding/page.tsx', 'app/(site)/tutor/complete-profile/page.tsx']) {
    assert.match(read(p), /showNewOnboarding\(await getOnboardingMode\(\)/, `${p} resolves the switch`)
    assert.match(read(p), /newFlow=\{newFlow\}/, `${p} passes newFlow`)
  }
})

test('the flow renders the gender chips and threads the order; the current flow is unchanged (FLOW_ORDER default)', () => {
  const f = read('components/tutor/CompleteProfileFlow.tsx')
  assert.match(f, /const ORDER = newFlow \? NEW_FLOW_ORDER : FLOW_ORDER/, 'order chosen by variant')
  assert.match(f, /stepKey === 'gender'/, 'the gender step renders')
  assert.match(f, /'trans', 'Trans', 'border-tm-green-deep bg-tm-green-deep'/, 'Trans chip, deep green fill')
  assert.match(f, /hideGender=\{newFlow\}/, 'contact step does not re-ask gender in the new flow')
})
