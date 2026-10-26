/**
 * scripts/test-pay-loop.ts — the payment-page loop hotfix (owner, 26 Oct 2026).
 *   npm run test:payloop
 *
 * 1. Walks every tutor payment state from the dashboard → each payment entry
 *    point → back to the dashboard, following the SERVER's automatic redirects
 *    (the dashboard/onboarding gate and lib/payChooseRouteCore, the one function
 *    /pay/choose obeys). Fails on any redirect loop or a chain over 4 hops.
 * 2. The bounce guard: a request we redirected into /pay/choose ourselves that
 *    would be redirected again is stopped, never redirected.
 * 3. The "Your verification" sheet opens only from a tap, is drawn in a portal
 *    on <body>, and no hover-lifting card can capture an open dialog.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { PAY_HOP_PARAM, payChooseRoute, withPayHop } from '../lib/payChooseRouteCore'
import { safeReturnTo } from '../lib/returnTo'

type TutorState = {
  name: string
  feePaid: boolean
  /** A PayPro checkout the dashboard offers to finish ("Complete your payment"). */
  payproPending: 'none' | 'before_cutoff' | 'after_cutoff' | 'blocked'
  receiptWaiting: boolean
  docsApproved: boolean
  onboarded: boolean
  hasCity: boolean
  hasSubjects: boolean
}

const BASE: TutorState = {
  name: '', feePaid: false, payproPending: 'none', receiptWaiting: false,
  docsApproved: false, onboarded: false, hasCity: true, hasSubjects: true,
}

const STATES: TutorState[] = [
  { ...BASE, name: 'unpaid (Samia)' },
  { ...BASE, name: 'unpaid, profile empty', hasCity: false, hasSubjects: false },
  { ...BASE, name: 'unpaid, onboarded', onboarded: true },
  { ...BASE, name: 'PayPro checkout started before the cut-off', payproPending: 'before_cutoff' },
  { ...BASE, name: 'PayPro checkout started after the cut-off', payproPending: 'after_cutoff' },
  { ...BASE, name: 'PayPro checkout blocked (new orders refused)', payproPending: 'blocked' },
  { ...BASE, name: 'bank receipt waiting', receiptWaiting: true },
  { ...BASE, name: 'paid, documents pending', feePaid: true, onboarded: true },
  { ...BASE, name: 'fully verified', feePaid: true, onboarded: true, docsApproved: true },
]

const PLANS: Record<string, { code: string; audience: string; pricePkr: number }> = {
  verified: { code: 'verified', audience: 'tutor', pricePkr: 199 },
  premium: { code: 'premium', audience: 'tutor', pricePkr: 499 },
  featured: { code: 'featured', audience: 'tutor', pricePkr: 999 },
  parent_featured: { code: 'parent_featured', audience: 'parent', pricePkr: 999 },
}

/** What the server does with one request: render it, or redirect it. */
function serve(url: string, s: TutorState): { render: true } | { redirect: string } | { stopped: string } {
  const [path, query = ''] = url.split('?')
  const q = new URLSearchParams(query)
  if (path === '/tutor/dashboard') {
    // lib/onboardingGate needsOnboarding
    const needs = !s.onboarded && (!s.hasCity || !s.hasSubjects)
    return needs ? { redirect: '/tutor/onboarding' } : { render: true }
  }
  if (path === '/tutor/onboarding') {
    // the page's own loop guard
    return s.onboarded ? { redirect: '/tutor/dashboard' } : { render: true }
  }
  if (path === '/tutor/verify') return s.feePaid ? { redirect: '/tutor/dashboard' } : { redirect: '/tutor/complete-profile?step=verify' }
  if (path === '/pay/choose') {
    const planCode = (q.get('plan') ?? '').trim()
    const r = payChooseRoute({
      planCode,
      returnTo: safeReturnTo(q.get('next')),
      hop: q.get(PAY_HOP_PARAM) === '1',
      role: 'tutor',
      plan: PLANS[planCode] ?? null,
      feePaid: s.feePaid,
    })
    if (r.kind === 'redirect') return { redirect: r.to }
    if (r.kind === 'stopped') return { stopped: r.wouldGoTo }
    return { render: true }
  }
  // complete-profile, membership-plans, a tuition page: render for a tutor.
  return { render: true }
}

/** Follow automatic redirects; fail on a repeat or a long chain. */
function land(start: string, s: TutorState): string {
  const seen = [start]
  let at = start
  for (let i = 0; i < 5; i++) {
    const r = serve(at, s)
    if ('render' in r || 'stopped' in r) return at
    assert.ok(!seen.includes(r.redirect), `${s.name}: redirect loop ${[...seen, r.redirect].join(' → ')}`)
    seen.push(r.redirect)
    at = r.redirect
  }
  assert.fail(`${s.name}: redirect chain too long ${seen.join(' → ')}`)
}

/** The payment links each dashboard state offers (the taps a tutor can make). */
function entryPoints(s: TutorState): string[] {
  const links = ['/pay/choose', '/pay/choose?plan=verified', '/pay/choose?plan=premium', '/membership-plans?for=tutors', '/tutor/verify']
  if (!s.feePaid && !s.receiptWaiting) links.push('/tutor/complete-profile?step=verify') // the sheet's "Pay Verification Fee"
  if (s.payproPending !== 'none' && !s.feePaid && !s.receiptWaiting) links.push('/pay/choose?plan=verified') // "Pay by bank transfer"
  links.push('/pay/choose?plan=verified&next=%2Ftuitions%2Flahore%2Fexample-abc123') // from a tuition's Apply
  return links
}

test('every state: dashboard → each payment page → back settles with no loop', () => {
  for (const s of STATES) {
    const home = land('/tutor/dashboard', s)
    assert.ok(home === '/tutor/dashboard' || home === '/tutor/onboarding', `${s.name}: dashboard landed on ${home}`)
    for (const link of entryPoints(s)) {
      const page = land(link, s)
      // A tutor who still owes the fee always ends on a page that can take it.
      if (!s.feePaid && link.startsWith('/pay/choose?plan=verified')) {
        assert.ok(page.startsWith('/pay/choose?plan=verified'), `${s.name}: ${link} ended on ${page}`)
      }
      // Paid tutors are never left on the fee's payment page.
      if (s.feePaid && link.startsWith('/pay/choose?plan=verified')) {
        assert.ok(!page.startsWith('/pay/choose'), `${s.name}: paid tutor kept on ${page}`)
      }
      // And back again.
      const back = land('/tutor/dashboard', s)
      assert.equal(back, home, `${s.name}: back from ${link} landed on ${back}`)
    }
  }
})

test('the bounce guard: our own redirect into /pay/choose is never redirected again', () => {
  // A paid tutor reaching the fee page through our own redirect (the race the
  // guard exists for): stopped, nothing to pay, no redirect.
  const r = payChooseRoute({ planCode: 'verified', returnTo: null, hop: true, role: 'tutor', plan: PLANS.verified, feePaid: true })
  assert.equal(r.kind, 'stopped')
  assert.equal(r.kind === 'stopped' ? r.payPlan : 'x', null)
  // An unpaid tutor stopped on a plan page is shown the fee's bank page.
  const r2 = payChooseRoute({ planCode: 'premium', returnTo: null, hop: true, role: 'tutor', plan: PLANS.premium, feePaid: false })
  assert.equal(r2.kind, 'stopped')
  assert.equal(r2.kind === 'stopped' ? r2.payPlan : null, 'verified')
  // Without our hop flag the normal redirects still happen.
  assert.equal(payChooseRoute({ planCode: 'verified', returnTo: null, hop: false, role: 'tutor', plan: PLANS.verified, feePaid: true }).kind, 'redirect')
  // The default redirect into /pay/choose carries the flag; others do not.
  const d = payChooseRoute({ planCode: '', returnTo: null, hop: false, role: 'tutor', plan: null, feePaid: false })
  assert.equal(d.kind === 'redirect' ? d.to : '', '/pay/choose?plan=verified&hop=1')
  assert.equal(withPayHop('/membership-plans?for=tutors'), '/membership-plans?for=tutors')
  // The page obeys the shared function and logs a stop with ids only.
  const page = readFileSync('app/(site)/pay/choose/page.tsx', 'utf8')
  assert.match(page, /payChooseRoute\(/)
  assert.match(page, /\[pay-redirect-guard\] stopped user=\$\{userId\}/)
  assert.doesNotMatch(page, /redirect\(\(returnTo && afterFeeReturnPath/, 'the old inline redirects are gone')
})

test('the verification sheet opens only on a tap and is drawn on <body>', () => {
  const dialog = readFileSync('components/tutor/VerifyBenefitsDialog.tsx', 'utf8')
  assert.match(dialog, /createPortal\(/)
  assert.match(dialog, /document\.body/)
  assert.doesNotMatch(dialog, /setOpen|router\.(push|replace|refresh)/, 'the sheet never opens or navigates by itself')
  for (const f of ['components/tutor/VerifyBadgeControl.tsx', 'components/tutor/NewOnboardingFlow.tsx']) {
    const src = readFileSync(f, 'utf8')
    // Every setOpen(true)/setBenefits(true) sits in an onClick, never in an effect.
    const opens = src.match(/set(Open|Benefits)\(true\)/g) ?? []
    const inClick = src.match(/onClick=\{\(\) => set(Open|Benefits)\(true\)\}/g) ?? []
    assert.equal(opens.length, inClick.length, `${f}: the sheet is opened outside a tap`)
    assert.doesNotMatch(src, /useEffect\([^)]*set(Open|Benefits)\(true\)/)
  }
})

test('a hover-lifting card never captures an open dialog', () => {
  const css = readFileSync('app/globals.css', 'utf8')
  const lift = css.slice(css.indexOf('Hover lift on cards'), css.indexOf('prefers-reduced-motion: reduce', css.indexOf('Hover lift on cards')))
  const blocks = lift.split(':where(.rounded-2xl.border, .rounded-3xl.border):not(').slice(1)
  assert.equal(blocks.length, 3)
  for (const b of blocks) assert.match(b.slice(0, 260), /:where\(:has\(\[role='dialog'\], \[aria-modal='true'\]\)\)/)
})
