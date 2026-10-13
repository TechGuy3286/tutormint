/**
 * scripts/test-email-confirm.ts — npm run test:emailconfirm
 *
 * Email confirmation no longer blocks onboarding (owner, 13 Oct 2026): a tutor
 * can finish onboarding and pay with an unconfirmed email; a verified mobile is
 * still required. Pure rules + source checks — no network, no database.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  confirmEmailSig,
  confirmEmailSigValid,
  confirmEmailUrl,
  emailReminderNeeded,
  mayEmailAddress,
  tutorAccessWith,
} from '../lib/emailConfirmCore'
import { NEW_FLOW_ORDER, missingSteps, stepDone, type FlowFacts } from '../lib/tutorFlow'
import { missingSummary } from '../lib/onboarding/missingItems'
import { render } from '../lib/notify/templates'

const SECRET = 'test-secret'
const read = (p: string) => readFileSync(p, 'utf8')

/** A tutor who has done every step and paid. Note: no email field exists here. */
const complete: FlowFacts = {
  fullName: 'Ayesha Khan', gender: 'female', city: 'Lahore', area: 'Gulberg', avatarUrl: 'https://x/a.jpg', headline: 'Maths tutor', bio: 'I teach maths.',
  experienceYears: 3, hourlyRate: 8000, jobTypes: ['Home Tutor'], degreesCount: 1, degreeDocCount: 0, degrees: [{ title: 'BSc' }],
  cnicNumber: '35202-1234567-1', cnicImagePath: 'y', subjectCount: 4, selfieDone: true, availabilityCount: 2,
  phoneVerified: true, whatsapp: '923001234567', feePaid: true, noDegreeYet: false, isSeed: false, isTeamAccount: false,
  isBanned: false, isSuspended: false, underReview: false, verificationStatus: null, imported: false, claimedAt: null,
}

test('an unconfirmed email blocks nothing: sign-in, onboarding and payment', () => {
  assert.deepEqual(tutorAccessWith({ emailPending: true, phoneVerified: true }), { signIn: true, onboarding: true, pay: true })
  // …and it is the MOBILE that is still required.
  assert.deepEqual(tutorAccessWith({ emailPending: true, phoneVerified: false }), { signIn: true, onboarding: false, pay: false })
  assert.deepEqual(tutorAccessWith({ emailPending: false, phoneVerified: false }), { signIn: true, onboarding: false, pay: false })
})

test('onboarding completes with an unconfirmed email — no step reads the email at all', () => {
  // Every step done, the fee paid: nothing is missing whatever the email's state.
  assert.deepEqual(missingSteps(complete, NEW_FLOW_ORDER), [])
  assert.equal(missingSummary(complete).missing.length, 0)
  assert.ok(!('email' in complete) && !('emailConfirmed' in complete))
  // The last step before payment is reachable, and payment is its own step.
  const unpaid = { ...complete, feePaid: false }
  assert.deepEqual(missingSteps(unpaid, NEW_FLOW_ORDER), ['verify'])
  // The mobile, though, is required to finish.
  assert.equal(stepDone({ ...complete, phoneVerified: false }, 'contact'), false)
})

test('payment never asks whether the email is confirmed', () => {
  for (const f of ['app/api/payments/checkout/route.ts', 'app/(site)/pay/choose/page.tsx', 'app/api/payments/receipt/route.ts', 'lib/payments/activate.ts']) {
    assert.ok(!/email_pending_confirm|email_confirmed_at|emailPending/.test(read(f)), `${f} must not gate on the email`)
  }
  // Neither does the onboarding gate or the flow's step rule.
  for (const f of ['lib/onboardingGate.ts', 'lib/tutorFlow.ts']) assert.ok(!/email_pending_confirm|email_confirmed/.test(read(f)), f)
})

test('a tutor who signs up with an email is signed in at once; parents are unchanged', () => {
  const src = read('app/api/auth/register/route.ts')
  const tutor = src.slice(src.indexOf("if (body.role === 'tutor') {"), src.indexOf('// signUp (not admin.createUser) so Supabase sends the confirmation email and\n    // leaves the account unconfirmed with no session. The link'))
  assert.ok(tutor.includes('email_confirm: true'), 'the account can sign in')
  assert.ok(tutor.includes('extra: { email_pending_confirm: true }'), 'the email is marked as waiting')
  assert.ok(tutor.includes('signInWithPassword') && tutor.includes("'/tutor/onboarding'"))
  assert.ok(tutor.includes('sendConfirmEmail('))
  // The parent path still creates an unconfirmed account and waits for the link.
  assert.ok(src.includes('supabase.auth.signUp({') && src.includes('/verify-email?to='))
})

test('the mobile is verified before the steps, by SMS, when it is not yet', () => {
  const flow = read('components/tutor/NewOnboardingFlow.tsx')
  assert.ok(flow.includes("if (!facts.phoneVerified && stepKey !== 'final' && stepKey !== 'contact') {"))
  assert.ok(flow.includes('<MobileVerifyScreen facts={facts}'))
})

test('the reminder shows only for a real address that is waiting', () => {
  assert.equal(emailReminderNeeded({ email: 'a@example.com', pending: true }), true)
  assert.equal(emailReminderNeeded({ email: 'a@example.com', pending: false }), false)
  assert.equal(emailReminderNeeded({ email: '923001234567@users.tutormint.org', pending: true }), false)
  assert.equal(emailReminderNeeded({ email: null, pending: true }), false)
  const dash = read('app/(site)/tutor/dashboard/page.tsx')
  assert.ok(dash.includes('{emailToConfirm && <EmailConfirmReminder email={emailToConfirm} />}'))
  assert.ok(read('components/account/EmailConfirmReminder.tsx').includes('Resend email'))
  assert.ok(read('app/api/account/email/resend/route.ts').includes('sendConfirmEmail(user.id'))
})

test('an address that is waiting receives the confirmation email and nothing else', () => {
  const waiting = { email: 'a@example.com', pending: true }
  assert.equal(mayEmailAddress(waiting, 'confirm_email'), true)
  for (const id of ['welcome', 'plan_activated', 'verification_fee_paid', 'tuition_match', 'admin_message']) assert.equal(mayEmailAddress(waiting, id), false, id)
  assert.equal(mayEmailAddress({ email: 'a@example.com', pending: false }, 'plan_activated'), true)
  assert.ok(read('lib/notify/index.ts').includes('mayEmailAddress('))
  assert.ok(read('lib/matchEmail.ts').includes('if (prof.email_pending_confirm) return'))
})

test('the link confirms one address on one account, and only we can make it', () => {
  const url = new URL(confirmEmailUrl('https://www.tutormint.org', 'user-1', 'A@Example.com', SECRET))
  assert.equal(url.pathname, '/api/auth/confirm-email')
  assert.equal(url.searchParams.get('e'), 'a@example.com')
  const sig = url.searchParams.get('s')!
  assert.equal(confirmEmailSigValid('user-1', 'a@example.com', sig, SECRET), true)
  assert.equal(confirmEmailSigValid('user-2', 'a@example.com', sig, SECRET), false, 'another account')
  assert.equal(confirmEmailSigValid('user-1', 'b@example.com', sig, SECRET), false, 'another address')
  assert.equal(confirmEmailSigValid('user-1', 'a@example.com', sig, 'other-secret'), false)
  assert.equal(confirmEmailSigValid('user-1', 'a@example.com', sig, ''), false, 'no secret, no confirmation')
  assert.equal(confirmEmailSig('u', 'X@Y.com', SECRET), confirmEmailSig('u', 'x@y.com', SECRET))
  // The route clears the flag only through the signature check.
  const lib = read('lib/emailConfirm.ts')
  assert.ok(lib.includes('confirmEmailSigValid(input.userId, input.email, input.sig, secret())'))
  assert.ok(lib.includes('email_pending_confirm: false'))
})

test('the confirmation email says the account works meanwhile, in plain English', () => {
  const mail = render({ id: 'confirm_email', name: 'ayesha', url: 'https://www.tutormint.org/api/auth/confirm-email?u=1' })
  assert.equal(mail.essential, true)
  assert.ok(mail.text.includes('You can keep using your TutorMint account in the meantime'))
  assert.ok(mail.text.includes('https://www.tutormint.org/api/auth/confirm-email?u=1'))
  assert.ok(!/Rs\.?\s?\d/.test(mail.text))
})

test('the existing email-only tutors are switched by a script that deletes nothing', () => {
  const op = read('scripts/dataop-open-email-tutors.ts')
  assert.ok(op.includes("p.role === 'tutor'") && op.includes('email_confirm: true') && op.includes('email_pending_confirm: true'))
  assert.ok(op.includes("action: 'member.email_unblock'"))
  assert.ok(!/\.delete\(|deleteUser/.test(op))
})
