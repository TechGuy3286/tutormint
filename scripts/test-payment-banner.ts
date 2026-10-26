/**
 * scripts/test-payment-banner.ts — the "payment started, not finished" banner,
 * /pay/choose with no plan, and the "Other methods" option (owner, 17 Oct 2026).
 *   npm run test:paymentbanner
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  bannerFor,
  checkoutLine,
  checkoutProblem,
  closable,
  closeReasonFor,
  continueHref,
  RECEIPT_LINE,
  type BannerPayment,
  type BannerPlan,
  type Holdings,
} from '../lib/paymentBannerCore'
import { defaultPayChoose, payChooseHref } from '../lib/payChooseDefault'

const ROOT = join(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const NOW = Date.parse('2026-10-17T11:14:00Z')
const H = 36e5
const PLANS = new Map<string, BannerPlan>([
  ['verified', { code: 'verified', name: 'Verified', audience: 'tutor', pricePkr: 199 }],
  ['premium', { code: 'premium', name: 'Premium', audience: 'tutor', pricePkr: 499 }],
  ['featured', { code: 'featured', name: 'Featured', audience: 'tutor', pricePkr: 999 }],
  ['parent_featured', { code: 'parent_featured', name: 'Featured', audience: 'parent', pricePkr: 999 }],
])
const tutor = (o: Partial<Holdings> = {}): Holdings => ({ audience: 'tutor', feePaid: false, activePlans: [], approved: [], ...o })
const pay = (o: Partial<BannerPayment> = {}): BannerPayment => ({
  id: '11111111-1111-4111-8111-111111111111',
  planCode: 'premium',
  status: 'pending',
  createdAt: new Date(NOW - 2 * H).toISOString(),
  provider: 'paypro',
  providerRef: 'TM-1',
  hasReceipt: false,
  ...o,
})

test('no banner for a verified tutor with an old Verification Fee checkout (the record Ali saw)', () => {
  const ali = pay({ planCode: 'verified', provider: 'manual', createdAt: '2026-10-01T16:00:19Z' })
  const h = tutor({ feePaid: true, approved: [{ planCode: 'verified', at: '2026-10-02T08:49:51Z' }] })
  assert.equal(checkoutProblem(ali, h, PLANS, NOW), 'already_paid')
  assert.equal(bannerFor([ali], h, PLANS, NOW, 'Verification Fee'), null)
  // Fee stamped by a grant (no approved payment) still counts as "already has it".
  assert.equal(checkoutProblem(pay({ planCode: 'verified' }), tutor({ feePaid: true }), PLANS, NOW), 'already_has_it')
  // A plan the member holds now is not offered either.
  assert.equal(checkoutProblem(pay(), tutor({ feePaid: true, activePlans: ['premium'] }), PLANS, NOW), 'already_has_it')
})

test('no banner after 48 hours', () => {
  const h = tutor({ feePaid: true })
  assert.equal(checkoutProblem(pay({ createdAt: new Date(NOW - 47.9 * H).toISOString() }), h, PLANS, NOW), null)
  assert.equal(checkoutProblem(pay({ createdAt: new Date(NOW - 48.1 * H).toISOString() }), h, PLANS, NOW), 'too_old')
  assert.equal(bannerFor([pay({ createdAt: new Date(NOW - 72 * H).toISOString() })], h, PLANS, NOW, 'Verification Fee'), null)
  assert.equal(closeReasonFor('too_old'), 'expired')
})

test('the banner names the plan and amount, and Continue opens that plan', () => {
  const b = bannerFor([pay()], tutor({ feePaid: true }), PLANS, NOW, 'Verification Fee')
  assert.ok(b && b.kind === 'checkout')
  assert.equal(b.planCode, 'premium')
  assert.equal(b.continueHref, '/pay/choose?plan=premium')
  assert.equal(checkoutLine(b.label, b.pricePkr), 'Premium — Rs 499: payment started, not finished.')
  assert.equal(checkoutLine('Featured', 1999), 'Featured — Rs 1,999: payment started, not finished.')
  const fee = bannerFor([pay({ planCode: 'verified' })], tutor(), PLANS, NOW, 'Verification Fee')
  assert.ok(fee && fee.kind === 'checkout')
  assert.equal(fee.label, 'Verification Fee')
  assert.equal(fee.continueHref, continueHref('verified'))
  // A plan for the other audience, or with no plan at all, is not a valid checkout.
  assert.equal(checkoutProblem(pay({ planCode: 'parent_featured' }), tutor(), PLANS, NOW), 'no_valid_checkout')
  assert.equal(checkoutProblem(pay({ planCode: null }), tutor(), PLANS, NOW), 'no_valid_checkout')
  // The newest payable checkout wins over an older stale one.
  const older = pay({ id: 'a', planCode: 'verified', createdAt: '2026-10-01T00:00:00Z' })
  const b2 = bannerFor([older, pay({ id: 'b' })], tutor({ feePaid: true }), PLANS, NOW, 'Verification Fee')
  assert.ok(b2 && b2.kind === 'checkout' && b2.paymentId === 'b')
  const page = read('components/membership-plans/PaymentBanner.tsx')
  assert.match(page, /href=\{banner\.continueHref\}/)
})

test('Cancel marks the checkout cancelled and deletes nothing', () => {
  assert.equal(checkoutProblem(pay({ closedAt: new Date(NOW).toISOString() }), tutor({ feePaid: true }), PLANS, NOW), 'closed')
  const lib = read('lib/paymentBanner.ts')
  const route = read('app/api/payments/checkout/cancel/route.ts')
  for (const src of [lib, route]) assert.ok(!/\.delete\(/.test(src), 'no delete')
  assert.match(lib, /checkout_close_reason: 'cancelled_by_member'/)
  assert.match(lib, /\.eq\('user_id', userId\)/, 'own checkout only')
  assert.match(lib, /\.eq\('status', 'pending'\)/)
  assert.ok(!/status: '/.test(lib.slice(lib.indexOf('.update('))), 'the status is not changed')
  assert.match(route, /auth\.getUser\(\)/)
  assert.match(route, /logActivity\(/)
  assert.match(read('supabase/migrations/185_checkout_closed.sql'), /add column if not exists checkout_closed_at/)
})

test('an approved payment, a refund or a waiting receipt is never closed', () => {
  assert.equal(closable({ status: 'approved', hasReceipt: false, refundedAt: null }), false)
  assert.equal(closable({ status: 'rejected', hasReceipt: false, refundedAt: null }), false)
  assert.equal(closable({ status: 'pending', hasReceipt: true, refundedAt: null }), false)
  assert.equal(closable({ status: 'pending', hasReceipt: false, refundedAt: '2026-10-10T00:00:00Z' }), false)
  assert.equal(closable({ status: 'pending', hasReceipt: false, refundedAt: null }), true)
  assert.equal(closeReasonFor('receipt'), null)
  assert.equal(closeReasonFor('not_pending'), null)
  assert.equal(closeReasonFor('refunded'), null)
  const script = read('scripts/dataop-close-stale-checkouts.ts')
  assert.ok(!/delete from/i.test(script), 'the clean-up deletes nothing')
  assert.match(script, /status = 'pending' and refunded_at is null and checkout_closed_at is null/)
  assert.match(script, /screenshot_path is null and coalesce\(btrim\(reference\), ''\) = ''/)
})

test('a receipt waiting for approval shows its own message and no continue link', () => {
  const r = pay({ planCode: 'verified', provider: 'manual', hasReceipt: true, createdAt: '2026-10-01T00:00:00Z' })
  const b = bannerFor([r], tutor(), PLANS, NOW, 'Verification Fee')
  assert.deepEqual(b, { kind: 'receipt', planCode: 'verified', label: 'Verification Fee' })
  assert.equal(RECEIPT_LINE, 'Receipt received — we’re checking it.')
  // A receipt wins over a payable checkout.
  const b2 = bannerFor([pay(), r], tutor({ feePaid: true }), PLANS, NOW, 'Verification Fee')
  assert.equal(b2?.kind, 'receipt')
  const comp = read('components/membership-plans/PaymentBanner.tsx')
  const receiptBranch = comp.slice(comp.indexOf("banner.kind === 'receipt'"), comp.indexOf('const cancel'))
  assert.ok(!/href=/.test(receiptBranch), 'no continue link')
})

test('/pay/choose with no plan', () => {
  assert.equal(defaultPayChoose({ role: 'tutor', feePaid: false }), '/pay/choose?plan=verified')
  assert.equal(defaultPayChoose({ role: 'tutor', feePaid: false, returnTo: '/tuitions/lahore/x-abc123' }), '/pay/choose?plan=verified&next=%2Ftuitions%2Flahore%2Fx-abc123')
  assert.equal(defaultPayChoose({ role: 'tutor', feePaid: true }), '/membership-plans?for=tutors')
  assert.equal(defaultPayChoose({ role: 'parent', feePaid: false }), '/membership-plans?for=parents')
  // Signed out: to login, coming back to the bare /pay/choose.
  assert.equal(payChooseHref(''), '/pay/choose')
  const page = read('app/(site)/pay/choose/page.tsx')
  assert.match(page, /const here = payChooseHref\(planCode, returnTo\)/)
  assert.match(page, /if \(!session\) redirect\(`\/login\?next=\$\{encodeURIComponent\(here\)\}`\)/)
  // The no-plan default now lives in the shared route function (hotfix,
  // 26 Oct 2026), which the page calls only after the session check.
  assert.ok(page.indexOf('if (!session)') < page.indexOf('payChooseRoute({'), 'login comes first')
  assert.match(read('lib/payChooseRouteCore.ts'), /if \(!f\.planCode\) \{\n\s+return \{ kind: 'redirect', to: withPayHop\(defaultPayChoose\(/)
})

test('the Faysal Bank logo and name are not on the "Other methods" option row', () => {
  // PayPro retired (owner, 26 Oct 2026): there is no option row any more — the
  // bank panel shows straight away. Still no bank logo anywhere on the screen.
  const choice = read('app/(site)/pay/choose/PayChoice.tsx')
  assert.ok(!/<Logo|<img src=\{logos/.test(choice), 'no bank logo')
  assert.ok(!/name="pay-via"/.test(choice), 'no method radio row')
  assert.match(choice, /OTHER_METHODS_TITLE = 'Other methods'/)
  assert.match(choice, /OTHER_METHODS_SUB = 'Any bank app, Easypaisa or ATM transfer — activated after we check your receipt'/)
  assert.match(choice, /ANY_BANK_LINE = 'You can pay from any bank or wallet app\. You don’t need a Faysal Bank account\.'/)
  // The line sits above the account details, inside the bank panel.
  const panel = choice.slice(choice.indexOf('data-bank-panel'))
  assert.ok(panel.indexOf('ANY_BANK_LINE') < panel.indexOf('<dl>'))
  assert.ok(!/faysal-bank/.test(read('app/(site)/pay/choose/page.tsx')), 'the bank logo is no longer passed')
  // PayPro retired: no JazzCash (PayPro) option and no "activates automatically".
  assert.doesNotMatch(choice, /JazzCash \(PayPro\)|Activates automatically/)
})
