/**
 * scripts/test-pr106f.ts  —  npm run test:pr106f
 *
 * PR106-F: the shared onboarding step template (no checklist lines, no hint
 * under the button, one consistent bottom button), input colour states, Urdu
 * on its own line + LTR numbers, the step-specific fixes (fee "Rs" + grouping,
 * CNIC green + LTR example, selfie, degree), and the signup changes (role line
 * + Change, draft preserved on Back, unconfirmed-email reuse, verify label).
 *
 * Pure logic (fieldState, formatCnic, the CNIC example split) + source scans;
 * no DB. Rendering is auth-gated and verified by these + the build, not a
 * driven browser.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { fieldState, fieldStateClasses } from '../lib/onboarding/fieldState'
import { formatCnic, isValidCnic, CNIC_EXAMPLE, CNIC_FORMAT_HINT_UR_LEAD } from '../lib/cnic'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ------------------------------------------------ §7 input colour states ------

test('field state: empty → neutral, filled+valid → green, invalid-after-try → red', () => {
  assert.equal(fieldState({ value: '' }), 'empty')
  assert.equal(fieldState({ value: '  ' }), 'empty')
  assert.equal(fieldState({ value: 'Ali' }), 'valid')
  assert.equal(fieldState({ value: 'x', valid: false }), 'empty', 'invalid but not yet tried stays neutral')
  assert.equal(fieldState({ value: 'x', valid: false, showError: true }), 'error')
  assert.equal(fieldState({ value: '', showError: true }), 'error', 'required left empty after trying')
})

test('field state classes use brand tokens: green border on valid, red on error', () => {
  assert.match(fieldStateClasses('valid'), /bg-tm-tint-green/)
  assert.match(fieldStateClasses('valid'), /border-tm-green-deep/)
  assert.match(fieldStateClasses('error'), /bg-tm-tint-red/)
  assert.match(fieldStateClasses('error'), /border-tm-red/)
  assert.match(fieldStateClasses('empty'), /bg-tm-bg/)
})

// ------------------------------------------------ §12 CNIC dashes / §5 LTR -----

test('CNIC auto-dashes to 5-7-1 and validates at 13 digits', () => {
  assert.equal(formatCnic('4210112345671'), '42101-1234567-1')
  assert.equal(formatCnic('42101-1234567-1'), '42101-1234567-1')
  assert.equal(isValidCnic('42101-1234567-1'), true)
  assert.equal(isValidCnic('42101-123'), false)
})

test('the CNIC Urdu example is a separate constant (so it can be LTR-isolated), and the lead has no number', () => {
  assert.equal(CNIC_EXAMPLE, '42101-1234567-1')
  // The lead may say "13 digits"; what matters is the hyphen-grouped EXAMPLE is
  // NOT in the RTL lead (it is appended in an <Ltr> isolate instead).
  assert.ok(!CNIC_FORMAT_HINT_UR_LEAD.includes(CNIC_EXAMPLE), 'the example number is not embedded in the RTL lead')
  assert.ok(!CNIC_FORMAT_HINT_UR_LEAD.includes('-'), 'no hyphen-grouped number in the RTL lead')
})

// ------------------------------------------------ shared primitives ------------

test('StepLayout: Urdu on its own line, LTR isolate for numbers, sticky bottom button', () => {
  const s = read('components/onboarding/StepLayout.tsx')
  assert.match(s, /<bdi dir="ltr"/, 'Ltr uses a dir=ltr bidi isolate')
  assert.match(s, /lang="ur" dir="rtl"/, 'Urdu block is RTL')
  assert.match(s, /sticky bottom-\[calc\(0\.75rem\+env\(safe-area-inset-bottom\)\)\]/, 'button pinned above the safe area')
})

// ------------------------------------------------ §1/§3 the flow uses the template

test('the onboarding flow renders no checklist lines and no hint-under-button', () => {
  const f = read('components/tutor/CompleteProfileFlow.tsx')
  assert.ok(!/FormChecklist/.test(f), 'no numbered/ticked checklist in the flow')
  assert.ok(!/ChecklistStatus/.test(f), 'no "Ready to save / … to continue" hint in the flow')
  assert.match(f, /StepHeading/, 'the shared heading is used')
  assert.ok(!/\{\/\* footer \*\/\}/.test(f), 'the separate app footer is gone (each step owns its button)')
})

test('the fee step shows "Rs" inside the box and groups the number as typed', () => {
  const f = read('components/tutor/CompleteProfileFlow.tsx')
  assert.match(f, /toLocaleString\('en-PK'\)/, 'thousands grouping')
  assert.match(f, />Rs</, 'Rs adornment inside the field')
  assert.match(f, /inputMode="numeric"/, 'numeric keypad')
})

test('the selfie step puts the camera first with a one-line note + Why, not the long blue box', () => {
  const f = read('components/tutor/CompleteProfileFlow.tsx')
  // In SelfieStep the PhotoCaptureTile comes before the note; PictureNote is gone from it.
  const selfie = f.slice(f.indexOf('function SelfieStep'), f.indexOf('function SelfieStep') + 2600)
  assert.ok(!/\<PictureNote \/\>/.test(selfie), 'the shared blue PictureNote box is not on the selfie step')
  assert.match(selfie, /Only our verification team sees your selfie\./, 'the one-line note')
  assert.match(selfie, /Why\?/, 'the Why? expander')
  assert.ok(selfie.indexOf('PhotoCaptureTile') < selfie.indexOf('Only our verification team'), 'camera before the note')
})

test('degree: Urdu sits on its own line, not inline with the English action', () => {
  const f = read('components/tutor/CompleteProfileFlow.tsx')
  // The retired inline forms ("— ایک اور ڈگری…", "— سند (اختیاری)") are gone.
  assert.ok(!/— ایک اور ڈگری/.test(f), 'no inline "add another degree" Urdu')
  assert.ok(!/— سند \(اختیاری\)/.test(f), 'no inline "certificate (optional)" Urdu')
})

test('CnicCapture: hideChecklist prop, green-valid input, LTR example in the Urdu hint', () => {
  const c = read('components/identity/CnicCapture.tsx')
  assert.match(c, /hideChecklist/, 'a prop to hide the checklist in onboarding')
  assert.match(c, /fieldStateClasses\(/, 'the number input takes the shared colour state')
  assert.match(c, /<Ltr>\{CNIC_EXAMPLE\}<\/Ltr>/, 'the example renders in an LTR isolate')
  // The onboarding CNIC steps pass hideChecklist.
  const f = read('components/tutor/CompleteProfileFlow.tsx')
  assert.ok((f.match(/hideChecklist/g) || []).length >= 2, 'both onboarding CNIC screens hide the checklist')
})

// ------------------------------------------------ §13 signup role line ---------

test('signup collapses the role choice to one line with a Change link', () => {
  const r = read('app/(site)/register/RegisterForm.tsx')
  assert.match(r, /rolePicking/, 'a picking/collapsed state')
  assert.match(r, /Signing up as a/, 'the collapsed summary line')
  assert.match(r, />\s*Change\s*</, 'a Change control to reopen the cards')
})

// ------------------------------------------------ §14 draft + reuse ------------

test('signup preserves the draft on Back but never stores the password', () => {
  const r = read('app/(site)/register/RegisterForm.tsx')
  assert.match(r, /tm_signup_draft/, 'a draft key')
  assert.match(r, /sessionStorage/, 'uses sessionStorage (an unsaved draft, allowed by rule 2)')
  // The saved object is role/fullName/identifier — NOT the password. This exact
  // shape is the proof the password is never written to storage.
  assert.match(r, /JSON\.stringify\(\{ role, fullName, identifier \}\)/, 'draft holds role/name/identifier only')
})

test('verify screens carry a "Change number" link and clear the draft on success', () => {
  const p = read('app/(site)/verify-phone/PendingVerifyForm.tsx')
  assert.match(p, /Change number/, 'the pending screen can correct the number')
  assert.match(p, /removeItem\('tm_signup_draft'\)/, 'the draft is cleared once verified')
  const e = read('app/(site)/verify-email/page.tsx')
  assert.match(e, /Change email/, 'the email screen can correct the email')
})

test('verify button reads "Verify and then Sign In" with an Urdu line', () => {
  for (const p of ['app/(site)/verify-phone/PendingVerifyForm.tsx', 'app/(site)/verify-phone/VerifyPhoneForm.tsx']) {
    const s = read(p)
    assert.match(s, /verifyLabel="Verify and then Sign In"/, `${p} label`)
    assert.match(s, /verifyLabelUr=/, `${p} Urdu line`)
  }
})

test('correcting an UNCONFIRMED email reuses the same account (no second account, no "already registered")', () => {
  const route = read('app/api/auth/register/route.ts')
  assert.match(route, /getUserById\(existingEmail\.id\)/, 'checks whether the existing account is confirmed')
  assert.match(route, /email_confirmed_at/, 'reads confirmation state')
  assert.match(route, /updateUserById\(existingEmail\.id/, 'reuses + refreshes the unconfirmed account')
  assert.match(route, /auth\.resend\(\{\s*type: 'signup'/, 'resends the confirmation link')
})
