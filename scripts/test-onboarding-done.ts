// npm run test:onboardingdone — "Onboarding done" and the return to the tuition
// after paying (owner, 15 Oct 2026).
//
// The diagnosis found three defects; each has a test here that fails on the old
// code:
//   1. onboarded_at was stamped only by a leave button the new flow's paying
//      tutors never pressed → every finish path now goes through ONE server
//      function that stamps when (and only when) every required step is done;
//   2. the admin "Stopped at" loader read every tutor_subjects row for 80
//      tutors in one request — the 1,000-row cap made tutors with subjects read
//      as having none → a fake database that enforces the cap;
//   3. WhatsApp could be skipped although the step needs it, and the new flow
//      judged Contact by the old flow's rule (tagline + bio), sending tutors
//      back to it → the step rule per flow.
// Plus Part C: the return-to after PayPro and after a bank-transfer receipt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  NEW_FLOW_ORDER,
  FLOW_ORDER,
  ONBOARDING_DONE_STEPS,
  onboardingStepsComplete,
  stepDone,
  stepDoneIn,
  firstMissingStep,
  type FlowFacts,
  type FlowStepKey,
} from '../lib/tutorFlow'
import { stoppedAtLabel } from '../lib/onboardingStopCore'
import { flowFactsByTutor } from '../lib/onboardingStop'
import {
  afterFeeReturnPath,
  payChoiceHref,
  paymentReturnTo,
  APPLY_READY_PARAM,
  PAID_PARAM,
  RECEIPT_PARAM,
} from '../lib/returnTo'

const read = (p: string) => readFileSync(p, 'utf8')

const complete: FlowFacts = {
  fullName: 'Ayesha Khan', gender: 'female', city: 'Lahore', area: 'DHA', avatarUrl: 'https://x.supabase.co/storage/v1/object/public/avatars/a.jpg',
  headline: 'Maths tutor', bio: 'I teach maths.', experienceYears: 3, hourlyRate: 8000, jobTypes: ['Home Tutor'],
  degreesCount: 1, degreeDocCount: 0, degrees: [{ title: 'BSc' }], cnicNumber: '35202-1234567-1', cnicImagePath: 'y',
  subjectCount: 4, selfieDone: true, availabilityCount: 2, phoneVerified: true, whatsapp: '923001234567', feePaid: false,
  noDegreeYet: false, isSeed: false, isTeamAccount: false, isBanned: false, isSuspended: false, underReview: false,
  verificationStatus: null, imported: false, claimedAt: null,
}

// A facts object with exactly one required step undone.
function without(step: FlowStepKey): FlowFacts {
  const f = { ...complete }
  switch (step) {
    case 'gender': f.gender = null; break
    case 'city': f.city = null; break
    case 'area': f.area = null; break
    case 'level': case 'subjects': f.subjectCount = 0; break
    case 'jobtype': f.jobTypes = []; break
    case 'fee': f.hourlyRate = null; break
    case 'experience': f.experienceYears = null; break
    case 'degree': f.degreesCount = 0; f.degrees = []; break
    case 'availability': f.availabilityCount = 0; break
    case 'contact': f.whatsapp = null; break
    case 'photo': f.avatarUrl = null; break
    case 'selfie': f.selfieDone = false; break
    case 'cnic_number': f.cnicNumber = null; break
    case 'cnic_photos': f.cnicImagePath = null; break
    case 'tagline': f.headline = null; break
    default: break
  }
  return f
}

test('every required step answered = onboarding done, paid or not', () => {
  assert.equal(onboardingStepsComplete(complete), true)
  assert.equal(onboardingStepsComplete({ ...complete, feePaid: true }), true)
  // The fee is its own funnel step, after "Onboarding done".
  assert.ok(!ONBOARDING_DONE_STEPS.includes('verify'))
  assert.deepEqual(ONBOARDING_DONE_STEPS, NEW_FLOW_ORDER.filter((k) => k !== 'verify'))
})

test('no tutor is done with a required step missing (each step, one at a time)', () => {
  for (const step of ONBOARDING_DONE_STEPS) {
    assert.equal(onboardingStepsComplete(without(step)), false, `done although "${step}" is missing`)
    assert.equal(onboardingStepsComplete({ ...without(step), feePaid: true }), false, `paying skipped "${step}"`)
  }
  assert.equal(onboardingStepsComplete({ ...complete, phoneVerified: false }), false)
  assert.equal(onboardingStepsComplete({ ...complete, bio: '  ' }), false)
})

test('new flow: Contact is mobile + WhatsApp; tagline is its own later step (no loop back)', () => {
  const atTagline = { ...complete, headline: null, bio: null }
  // Old flow's Contact includes tagline + bio; the new flow's does not.
  assert.equal(stepDone(atTagline, 'contact'), false)
  assert.equal(stepDoneIn(atTagline, 'contact', FLOW_ORDER), false)
  assert.equal(stepDoneIn(atTagline, 'contact', NEW_FLOW_ORDER), true)
  assert.equal(firstMissingStep(atTagline, NEW_FLOW_ORDER), 'tagline')
  assert.equal(stoppedAtLabel(atTagline), 'Tagline and bio')
  // WhatsApp missing still stops at Contact.
  assert.equal(firstMissingStep({ ...complete, whatsapp: '' }, NEW_FLOW_ORDER), 'contact')
  assert.equal(stoppedAtLabel({ ...complete, whatsapp: '' }), 'Contact')
})

test('the WhatsApp screen cannot be skipped (it is a required part of Contact)', () => {
  const src = read('components/tutor/NewOnboardingFlow.tsx')
  const wa = src.slice(src.indexOf("headingEn: 'Your WhatsApp number'"), src.indexOf("headingEn: 'Your WhatsApp number'") + 900)
  assert.match(wa, /nextDisabled: !waValid/)
  assert.doesNotMatch(wa, /else next\(\)/)
})

// ---- the 1,000-row cap: a fake database that enforces it ------------------
type Row = Record<string, unknown>
function fakeAdmin(tables: Record<string, Row[]>, cap = 1000): SupabaseClient {
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])]
    let head = false
    let range: [number, number] | null = null
    const q = {
      select(_cols: string, opts?: { count?: string; head?: boolean }) { head = !!opts?.head; return q },
      in(col: string, vals: unknown[]) { rows = rows.filter((r) => vals.includes(r[col])); return q },
      eq(col: string, v: unknown) { rows = rows.filter((r) => r[col] === v); return q },
      order() { return q },
      range(a: number, b: number) { range = [a, b]; return q },
      then(resolve: (v: unknown) => void) {
        if (head) return resolve({ data: null, count: rows.length, error: null })
        let out = rows
        if (range) out = out.slice(range[0], range[1] + 1)
        return resolve({ data: out.slice(0, cap), error: null })
      },
    }
    return q
  }
  return { from } as unknown as SupabaseClient
}

test('"Stopped at" facts count every tutor\'s subjects past the 1,000-row cap', async () => {
  const ids = ['t-many', 't-few', 't-one']
  const subjects: Row[] = [
    ...Array.from({ length: 1200 }, (_, i) => ({ tutor_id: 't-many', master_id: i })),
    ...Array.from({ length: 5 }, (_, i) => ({ tutor_id: 't-few', master_id: i })),
    { tutor_id: 't-one', master_id: 1 },
  ]
  const admin = fakeAdmin({
    profiles: ids.map((id) => ({ id, full_name: 'X', city: 'Lahore', phone_verified_at: '2026-10-10', whatsapp: '923001234567', cnic_number: null })),
    tutor_profiles: ids.map((id) => ({ id, city: 'Lahore', degrees: [], availability_list: null, job_types: [] })),
    tutor_subjects: subjects,
    user_documents: [],
  })
  const facts = await flowFactsByTutor(admin, ids)
  assert.equal(facts.get('t-many')?.subjectCount, 1200)
  assert.equal(facts.get('t-few')?.subjectCount, 5)
  assert.equal(facts.get('t-one')?.subjectCount, 1)
  // The loader must never read subject ROWS for a list of tutors in one go.
  assert.doesNotMatch(read('lib/onboardingStop.ts'), /from\('tutor_subjects'\)\.select\('tutor_id'\)\.in\(/)
})

// ---- every finish path goes through the one stamping function ---------------
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

test('nothing writes onboarded_at except lib/onboardingDone', () => {
  const writers = [...walk('app'), ...walk('lib'), ...walk('components')].filter((p) =>
    /onboarded_at:\s*(new Date|at\b|now|\S+\.toISOString)/.test(read(p)),
  )
  assert.deepEqual(writers.map((p) => p.replace(/\\/g, '/')), ['lib/onboardingDone.ts'])
  const done = read('lib/onboardingDone.ts')
  assert.match(done, /onboardingStepsComplete\(facts\)/)
  assert.match(done, /\.is\('onboarded_at', null\)/)
})

test('every way of finishing onboarding asks the server to stamp it', () => {
  const route = read('app/api/tutor/onboarding/route.ts')
  assert.match(route, /if \(body\.complete \|\| body\.dismiss\)/)
  assert.match(route, /markOnboardedIfComplete\(user\.id, body\.complete \? 'flow' : 'leave'\)/)
  assert.match(route, /markOnboardedIfComplete\(user\.id, 'onboarding_submit'\)/)
  const flow = read('components/tutor/NewOnboardingFlow.tsx')
  // Reaching the fee step or the last screen (the paying tutor's path).
  assert.match(flow, /stepKey === 'verify' \|\| stepKey === 'final'\) && !completeSent\.current/)
  assert.match(flow, /JSON\.stringify\(\{ complete: true \}\)/)
  assert.doesNotMatch(flow, /dismiss: true/)
  assert.match(read('app/api/profile/save/route.ts'), /markOnboardedIfComplete\(user\.id, 'profile_save'\)/)
  assert.match(read('app/api/documents/upload/route.ts'), /markOnboardedIfComplete\(user\.id, 'document_upload'\)/)
  assert.match(read('app/api/identity/route.ts'), /markOnboardedIfComplete\(user\.id, 'cnic_submit'\)/)
  // Paying inside onboarding: the fee activation stamps too, never skipping a step.
  assert.match(read('lib/payments/activate.ts'), /markOnboardedIfComplete\(userId, 'fee_paid'\)/)
})

// ---- Part C: back to the tuition after paying -------------------------------
test('return-to: paid and receipt paths, same-site only', () => {
  const tuition = '/tuitions/lahore/home-tutor-grade-5-abc123'
  assert.equal(payChoiceHref('verified', tuition), `/pay/choose?plan=verified&next=${encodeURIComponent(tuition)}`)
  assert.equal(payChoiceHref('verified', 'https://evil.com'), '/pay/choose?plan=verified')
  assert.equal(payChoiceHref('verified', '//evil.com'), '/pay/choose?plan=verified')
  assert.equal(afterFeeReturnPath(tuition, 'paid'), `${tuition}?${APPLY_READY_PARAM}=1&${PAID_PARAM}=1`)
  assert.equal(afterFeeReturnPath(tuition, 'receipt'), `${tuition}?${APPLY_READY_PARAM}=1&${RECEIPT_PARAM}=1`)
  assert.equal(afterFeeReturnPath(`${tuition}?apply=1`, 'paid'), `${tuition}?apply=1&paid=1`)
  for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '/%2F%2Fevil.com', '/tutor/dashboard', '/pay/choose?plan=verified', '/admin', null, '']) {
    assert.equal(afterFeeReturnPath(bad, 'paid'), null, `followed ${bad}`)
  }
  assert.equal(paymentReturnTo('verified', tuition), tuition)
  assert.equal(paymentReturnTo('premium', tuition), null)
  assert.equal(paymentReturnTo('verified', '//evil.com'), null)
  assert.equal(paymentReturnTo('verified', 42), null)
})

test('return-to after PayPro success and after a bank-transfer receipt (wiring)', () => {
  const flow = read('components/tutor/NewOnboardingFlow.tsx')
  assert.match(flow, /payChoiceHref\('verified', returnTo\)/)
  const choose = read('app/(site)/pay/choose/page.tsx')
  assert.match(choose, /const returnTo = safeReturnTo\(next\)/)
  const payChoice = read('app/(site)/pay/choose/PayChoice.tsx')
  // PayPro retired (owner, 26 Oct 2026): the bank-transfer receipt carries the return-to.
  assert.doesNotMatch(payChoice, /useVerifyCheckout\(/)
  assert.match(payChoice, /form\.set\('returnTo', returnTo\)/)
  assert.match(payChoice, /afterFeeReturnPath\(returnTo, 'receipt'\)/)
  assert.match(read('components/tutor/useVerifyCheckout.ts'), /JSON\.stringify\(returnTo \? \{ planCode, returnTo \} : \{ planCode \}\)/)
  // Stored on the payment by the server, through the same-site rule.
  assert.match(read('app/api/payments/checkout/route.ts'), /paymentReturnTo\(plan\.code as string, body\.returnTo\)/)
  assert.match(read('app/api/payments/receipt/route.ts'), /paymentReturnTo\(planCode, form\.get\('returnTo'\)\)/)
  // PayPro success → the tuition with "You're ready — tap Apply".
  assert.match(read('app/(site)/pay/return/page.tsx'), /redirect\(afterFeeReturnPath\(payment\.return_to as string \| null, 'paid'\) \?\? '\/tutor\/dashboard\?paid=1'\)/)
  const panel = read('app/(site)/tuitions/[city]/[slug]/ApplyPanel.tsx')
  assert.match(panel, /You’re ready — tap Apply\./)
  assert.match(panel, /You can apply as soon as we approve it\./)
  assert.match(panel, /disabled=\{state !== 'idle' \|\| !!block \|\| feeReceiptPending\}/)
  // A bank transfer approved later: the notification links back to the tuition.
  assert.match(read('lib/payments/activate.ts'), /href: afterFeeReturnPath\(payment\.return_to as string \| null, 'paid'\) \?\? '\/tutor\/dashboard'/)
  const mig = read('supabase/migrations/174_payment_return_to.sql')
  assert.match(mig, /add column if not exists return_to text/)
  assert.match(mig, /left\(return_to, 2\) <> '\/\/'/)
})
