/**
 * scripts/test-hotfix-g4b.ts  —  npm run test:hotfixg4b
 *
 * HOTFIX-G4b: the final onboarding screen's "Get verified now" button reliably
 * reaches PayPro (same checkout contract + pending-invoice reuse as the proven
 * path), distinguishes a PayPro timeout from an our-side error in plain English,
 * logs the real error for staff, wraps the error line within 360px, and carries
 * no amount on the button. Source scans + pure messages. No browser/DB/network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { CHECKOUT_FAIL_MESSAGES } from '../components/tutor/useVerifyCheckout'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const HOOK = read('components/tutor/useVerifyCheckout.ts')
const FLOW = read('components/tutor/NewOnboardingFlow.tsx')
const ROUTE = read('app/api/payments/checkout/route.ts')

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}`)
  assert.ok(start >= 0, `${name} exists`)
  const after = src.indexOf('\nfunction ', start + 1)
  return src.slice(start, after === -1 ? undefined : after)
}

test('the final-screen request matches the working checkout contract', () => {
  assert.match(HOOK, /fetch\('\/api\/payments\/checkout'/, 'same endpoint as the verify flow')
  assert.match(HOOK, /body: JSON\.stringify\(\{ planCode: 'verified' \}\)/, "planCode 'verified', no payment method → the online path")
  // reuse/replace of a pending invoice is the route's job (unchanged, proven)
  assert.match(ROUTE, /startPayproCheckout\(/, 'routes through startPayproCheckout (reuses a < 24h pending invoice)')
})

test('redirect navigates; any non-redirect sets a reason, never a silent/raw failure', () => {
  assert.match(HOOK, /res\.ok && data\?\.mode === 'redirect' && data\.url/, 'a redirect navigates to PayPro')
  assert.match(HOOK, /window\.location\.assign\(data\.url\)/, 'off-origin full navigation')
  assert.match(HOOK, /setReason\(payproSide \? 'paypro' : 'ours'\)/, 'non-redirect → a distinguished reason')
  assert.ok(!/setFailed/.test(HOOK), 'no single vague "failed" flag any more')
})

test('PayPro timeout vs our error map to distinct plain-English lines', () => {
  assert.notEqual(CHECKOUT_FAIL_MESSAGES.paypro, CHECKOUT_FAIL_MESSAGES.ours, 'two distinct messages')
  assert.match(CHECKOUT_FAIL_MESSAGES.paypro, /PayPro is not responding right now\. Please try again in a few minutes\./, 'PayPro-timeout line')
  assert.match(CHECKOUT_FAIL_MESSAGES.ours, /We couldn.t start the payment\. Please try again, or message us on WhatsApp 0321 5872222\./, 'our-error line with WhatsApp')
  // 5xx / payment_failed / paypro_unavailable → PayPro; else our side
  assert.match(HOOK, /res\.status >= 500 \|\| data\?\.code === 'payment_failed' \|\| data\?\.code === 'paypro_unavailable'/, 'PayPro-side classification')
  // a network drop / abort is treated as "not responding"
  assert.match(HOOK, /catch \(e\)[^]*setReason\('paypro'\)/, 'network/abort → PayPro-not-responding')
})

test('the real error is logged for staff and the request is bounded (never shown raw, never hangs)', () => {
  assert.match(HOOK, /console\.error\('\[verify-checkout\] failed', res\.status/, 'logs status + code + error for staff')
  assert.match(HOOK, /new AbortController\(\)/, 'bounds the request')
  assert.match(HOOK, /setTimeout\(\(\) => controller\.abort\(\), 32_000\)/, '~32s client timeout (> route maxDuration)')
  // the member only ever sees a mapped line (the final screen renders no raw
  // server error text; the real error is logged in the hook, not shown)
  const g = fnBody(FLOW, 'GetVerifiedStep')
  assert.ok(!/data\?\.error|\.error\b/.test(g), 'raw server error text is not rendered on the screen')
})

test('the checkout route has room for a slow PayPro (no opaque 504)', () => {
  assert.match(ROUTE, /export const maxDuration = 30/, 'maxDuration 30s covers the 15s token + 15s order')
})

test('the error line fits 360px and the button carries no amount', () => {
  const g = fnBody(FLOW, 'GetVerifiedStep')
  // error line: centred, side padding, wraps (bounded width) — not cut off at the edges
  assert.match(g, /mx-auto max-w-xs px-2 text-center text-xs font-semibold leading-relaxed text-tm-red/, 'error line wraps within 360px with padding')
  assert.match(g, /CHECKOUT_FAIL_MESSAGES\[reason\]/, 'uses the shared reason message')
  // button carries no amount (PR106-G6 §13 removed "Rs 199" from the fee line too)
  assert.match(g, /\{busy \? 'Starting…' : 'Get verified now'\}/, 'button label has no amount')
  assert.equal((g.match(/Rs 199/g) || []).length, 0, 'no amount anywhere on the final screen')
  assert.match(g, /Spam Free Platform Fee\. We keep TutorMint clean of fake and spam accounts\./, 'fee line without the amount')
})

test('the dashboard card uses the same hardened hook + shared messages', () => {
  const c = read('components/tutor/GetVerifiedValueCard.tsx')
  assert.match(c, /useVerifyCheckout\(\)/, 'same hook')
  assert.match(c, /CHECKOUT_FAIL_MESSAGES\[reason\]/, 'same reason-based message')
  assert.ok(!/payment|\bfee\b/i.test(c), 'still no money words in the card file itself')
})
