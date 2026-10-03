/**
 * scripts/test-pr106g3c.ts  —  npm run test:pr106g3c
 *
 * PR106-G3c: a SEPARATE NewOnboardingFlow (CompleteProfileFlow untouched by this
 * PR), StepShell with a truly-fixed visualViewport button, full-screen overlay,
 * area chips (demand API + add-new), Education rows, Contact missing-items-only,
 * and the Payment settings link/title. Source scans + the pages' routing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { showNewOnboarding } from '../lib/onboardingMode'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

test('NewOnboardingFlow is a separate component rendered only when showNewOnboarding is true', () => {
  assert.ok(existsSync(join(ROOT, 'components/tutor/NewOnboardingFlow.tsx')), 'the new component exists')
  for (const p of ['app/(site)/tutor/onboarding/page.tsx', 'app/(site)/tutor/complete-profile/page.tsx']) {
    const s = read(p)
    assert.match(s, /if \(newFlow\) \{\s*\n\s*return <NewOnboardingFlow/, `${p} routes to NewOnboardingFlow when newFlow`)
    assert.match(s, /showNewOnboarding\(await getOnboardingMode\(\)/, `${p} resolves the switch`)
  }
  // The switch still gates: staff-only means a normal tutor does not get it.
  assert.equal(showNewOnboarding('staff', false), false)
  assert.equal(showNewOnboarding('staff', true), true)
})

test('CompleteProfileFlow is NOT modified by this PR (still the live flow)', () => {
  // It keeps its own render + the PR106-G3 variant; this PR added nothing to it.
  const f = read('components/tutor/CompleteProfileFlow.tsx')
  assert.ok(!/NewOnboardingFlow|StepShell/.test(f), 'CompleteProfileFlow does not reference the new component/shell')
})

test('StepShell button is position: fixed with a visualViewport keyboard offset, "Next"/"Finish" text', () => {
  const s = read('components/onboarding/StepShell.tsx')
  assert.match(s, /window\.visualViewport/, 'uses visualViewport')
  assert.match(s, /addEventListener\('resize'/, 'listens for keyboard resize')
  assert.match(s, /fixed inset-x-0/, 'the button bar is position: fixed')
  assert.match(s, /style=\{\{\s*\n?\s*bottom: kb/, 'the bar is lifted by the keyboard inset')
  assert.ok(!/sticky bottom-/.test(s), 'no sticky button')
  // The flow supplies "Next"/"Finish".
  const f = read('components/tutor/NewOnboardingFlow.tsx')
  assert.match(f, /isLastBeforeVerify \? 'Finish' : 'Next'/, 'Finish on the last step, Next otherwise')
  assert.ok(!/Save & continue/.test(f), 'never "Save & continue"')
})

test('the overlay covers the whole viewport and hides site chrome', () => {
  const s = read('components/onboarding/StepShell.tsx')
  assert.match(s, /fixed inset-0 z-\[60\]/, 'full-screen overlay above the navbar')
  assert.match(s, /Finish later/, 'the minimal header')
  assert.match(s, /Tutor<span className="text-tm-red">Mint/, 'logo, no site navbar')
})

test('area step: demand API, no city re-ask, add-your-own fallback', () => {
  assert.ok(existsSync(join(ROOT, 'app/api/onboarding/areas/route.ts')), 'the demand API exists')
  const api = read('app/api/onboarding/areas/route.ts')
  assert.match(api, /listed tutors with that area\) \+ \(open tuitions/, 'demand = tutors + tuitions')
  const f = read('components/tutor/NewOnboardingFlow.tsx')
  assert.match(f, /Which areas in \$\{city\}\?/, 'heading names the city, no re-ask')
  assert.match(f, /Add .\{q\.trim\(\)\}/, 'can add a typed area the list does not have')
  assert.ok(!/Add a second city|Choose up to 2 cities/.test(f), 'no city-step leftovers')
})

test('Education: three rows, one typed degree required, removed texts absent', () => {
  const f = read('components/tutor/NewOnboardingFlow.tsx')
  assert.match(f, /while \(base\.length < 3\)/, 'three rows always shown')
  assert.match(f, /Type at least one degree/, 'one typed degree required')
  assert.ok(!/Add certificate \(optional\)|Add another degree|No degree to add yet|Only you and our verification team/.test(f), 'removed texts absent')
  assert.ok(!/اختیاری/.test(f), 'no "(اختیاری)" anywhere in the new flow')
})

test('Contact shows only missing items: mobile-signup vs email-signup', () => {
  const f = read('components/tutor/NewOnboardingFlow.tsx')
  // mobile-signup (phoneVerified) → whatsapp, email; email-signup → mobile, whatsapp.
  assert.match(f, /facts\.phoneVerified \? \(\['whatsapp', 'email'\] as const\) : \(\['mobile', 'whatsapp'\] as const\)/, 'per-signup screens')
  assert.ok(!/Email address<\/|Change email/.test(f), 'no email sub-heading / change-email')
})

test('Payment settings link in the nav + button, and the page title is "Payment settings"', () => {
  assert.match(read('lib/adminNav.ts'), /\/admin\/payments\/settings', label: 'Settings'.*screen: 'paymentsSwitches'/, 'owner-only nav item')
  assert.match(read('app/admin/payments/page.tsx'), /href="\/admin\/payments\/settings"[\s\S]*?Settings/, 'a Settings button on the payments page')
  assert.match(read('app/admin/payments/settings/page.tsx'), /Payment settings<\/h1>/, 'page title is "Payment settings"')
})
