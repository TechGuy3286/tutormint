/**
 * scripts/test-pr106g.ts  —  npm run test:pr106g
 *
 * PR106-G STEP 1–3 (what shipped in this pass): the onboarding overlay header
 * (no site Navbar / Login), the sign-in and signup layouts, and the OTP screen.
 * Source scans only; the onboarding internals (STEP 4–6) are a follow-up.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ---------------------------------------------- STEP 1: onboarding header ------

test('onboarding is a full-screen overlay above the site navbar, with a Finish later link and no Login', () => {
  const f = read('components/tutor/CompleteProfileFlow.tsx')
  assert.match(f, /fixed inset-0 z-\[60\]/, 'overlay covers the site navbar (z-50)')
  assert.match(f, /Finish later/, 'the Finish later link')
  assert.match(f, /Tutor<span className="text-tm-red">Mint<\/span>/, 'the TutorMint logo wordmark')
  assert.ok(!/>Login</.test(f), 'no Login control in the flow')
})

// ---------------------------------------------- STEP 2: sign in ----------------

test('sign-in page: no explanation text, outlined Create-account button, exactly one WhatsApp icon', () => {
  const s = read('app/(site)/login/LoginForm.tsx')
  assert.ok(!/Tutors, parents and schools all sign in here/.test(s), 'explanation removed')
  assert.match(s, /border-tm-navy bg-white text-xs font-bold text-tm-navy/, 'outlined Create account button')
  assert.match(s, />\s*Create an account\s*</, 'Create an account present')
  assert.match(s, /aria-label="Message us on WhatsApp"/, 'the round WhatsApp icon button')
  assert.equal((s.match(/aria-label="Message us on WhatsApp"/g) || []).length, 1, 'exactly one WhatsApp icon')
  assert.match(s, /Forgot your password\?/, 'forgot-password link kept')
})

// ---------------------------------------------- STEP 2: signup -----------------

test('signup page: two radios nothing preselected, no helper text, one consent line, outlined Sign in, no WhatsApp', () => {
  const s = read('app/(site)/register/RegisterForm.tsx')
  assert.match(s, /useState<Role \| null>\(null\)/, 'nothing preselected')
  assert.match(s, /disabled=\{loading \|\| !acceptedTerms \|\| !role\}/, 'Create disabled until a role is chosen')
  assert.ok(!/Signing up as a/.test(s), 'the PR106-F collapse line is gone')
  assert.ok(!/Free to join/.test(s), 'the "Free to join" helper removed')
  assert.ok(!/Use a mobile number or an email/.test(s), 'the identifier helper removed')
  assert.match(s, /I accept the/, 'single consent line')
  assert.ok(!/use my profile photo/.test(s), 'the inline photo-consent paragraph is gone (it lives in Terms)')
  assert.ok(!/wa\.me|aria-label="[^"]*WhatsApp|WhatsApp us/.test(s), 'no WhatsApp UI on signup')
  // The outlined "Sign in" button under Create account.
  assert.match(s, /border border-tm-navy bg-white[^"]*text-tm-navy[\s\S]*?Sign in/, 'outlined Sign in button')
})

test('the photo-use consent removed from signup still lives on the Terms page', () => {
  const t = read('app/(site)/terms/page.tsx')
  assert.match(t, /profile photograph and the public details/, 'Terms carries the promotional-use consent')
})

// ---------------------------------------------- STEP 3: OTP screen -------------

test('OTP screen: green "OTP sent", Verify-and-sign-in, change-number + use-email links, no blue/grey boxes, no WhatsApp', () => {
  const p = read('app/(site)/verify-phone/PendingVerifyForm.tsx')
  assert.match(p, /OTP sent to \{sentTo\}/, 'green OTP-sent line')
  assert.match(p, /verifyLabel="Verify and then Sign In"/, 'the verify button label')
  assert.match(p, /Change number/, 'change-number link')
  assert.match(p, /Use email instead/, 'use-email-instead link')
  assert.ok(!/OtpAlreadySentNotice/.test(p), 'the blue "already sent" box is gone')
  assert.ok(!/Didn.t get the code\?/.test(p), 'the grey "Didn\'t get the code?" box is gone')
  assert.ok(!/wa\.me|aria-label="[^"]*WhatsApp|WhatsApp us/.test(p), 'no WhatsApp UI on the pending OTP screen')
})

test('the pending OTP screen hides the support box; the authenticated gate keeps it', () => {
  const page = read('app/(site)/verify-phone/page.tsx')
  assert.match(page, /showSupport=\{false\}/, 'pending screen hides support')
  assert.match(page, /showSupport\n/, 'authenticated gate passes showSupport (true)')
  assert.match(page, /showSupport && \(waHref \|\| support\.email\)/, 'the support box is gated on showSupport')
  assert.match(page, /•••• /, 'the masked number format')
})
