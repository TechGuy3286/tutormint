/**
 * scripts/test-pay-choice.ts  —  npm run test:paychoice
 *
 * The payment choice screen and the bank-transfer receipt (owner, 11 Oct 2026):
 * JazzCash (PayPro) or "Other method" with a receipt upload that staff approve.
 * Pure rules + source scans. No browser, database or network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  RECEIPT_MAX_BYTES,
  RECEIPT_MESSAGES,
  bankDetailsComplete,
  bankTransferVisible,
  channelLabel,
  priceLine,
  receiptFileProblem,
  receiptIsPdf,
  receiptStateOf,
  receiptUnderReview,
  supportWaLink,
} from '../lib/payments/receiptCore'
import { payLogoSrcFrom } from '../lib/payments/logos'
import { SCREEN_ACCESS, isReadOnlyRole, roleSatisfies } from '../lib/adminAccessCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const PAGE = read('app/(site)/pay/choose/page.tsx')
const CHOICE = read('app/(site)/pay/choose/PayChoice.tsx')
const RECEIPT_ROUTE = read('app/api/payments/receipt/route.ts')
const CHECKOUT = read('app/api/payments/checkout/route.ts')
const DECIDE = read('app/api/admin/payments/decide/route.ts')
const ACTIVATE = read('lib/payments/activate.ts')

const BANK = { bankName: 'Faysal Bank', accountTitle: 'Tutor Mint (Private) Limited', accountNumber: '0000000000000000', iban: null }

// ------------------------------------------------ the amount, from config ----
test('the choice screen shows the amount from the plans row, never a typed figure', () => {
  assert.equal(priceLine({ code: 'verified', price_pkr: 199 }), 'one-time fee Rs 199')
  assert.equal(priceLine({ code: 'premium', price_pkr: 499 }), 'Rs 499 / month')
  assert.equal(priceLine({ code: 'verified', price_pkr: 250 }), 'one-time fee Rs 250', 'a changed price changes the screen')
  assert.equal(priceLine({ code: 'featured', price_pkr: 1500 }), 'Rs 1,500 / month')

  assert.match(PAGE, /from\('plans'\)\.select\('code, name, audience, price_pkr'\)/, 'the page reads the price from plans')
  assert.match(PAGE, /priceLine\(price\)/, 'the package card prints the plan price')
  assert.match(PAGE, /amount=\{rupees\(price\.price_pkr\)\}/, 'the bank panel amount is the same plan price')
  for (const src of [PAGE, CHOICE]) {
    assert.ok(!/Rs\.?\s?\d/.test(src), 'no rupee figure is typed into the screen')
    assert.ok(!/\b(199|499|999)\b/.test(src), 'no price literal')
  }
  assert.match(PAGE, /Complete your verification/, 'the title')
})

// ------------------------------------------------ PayPro path unchanged ------
test('PayPro is retired: no JazzCash (PayPro) option; the checkout hook is unchanged for orders already started', () => {
  // Owner, 26 Oct 2026: the choice screen offers bank transfer only.
  assert.doesNotMatch(CHOICE, /useVerifyCheckout\(/, 'the choice screen starts no PayPro checkout')
  assert.doesNotMatch(CHOICE, /Continue to JazzCash|JazzCash \(PayPro\)/, 'no PayPro option')
  const hook = read('components/tutor/useVerifyCheckout.ts')
  assert.match(hook, /fetch\('\/api\/payments\/checkout'/, 'same endpoint')
  assert.match(hook, /body: JSON\.stringify\(returnTo \? \{ planCode, returnTo \} : \{ planCode \}\)/, 'no payment method → the online (PayPro) path')
  // The route itself: same order creation, amount from the plan.
  assert.match(CHECKOUT, /startPayproCheckout\(\{/, 'creates the PayPro order')
  assert.match(CHECKOUT, /amountPkr: plan\.price_pkr as number/, 'amount from the plan, never the request')
  // Gateway payments activate with no staff approval…
  assert.match(read('app/api/payments/webhook/route.ts'), /activatePayment\(\{ paymentId: payment\.id as string, source: 'gateway' \}\)/)
  assert.match(read('lib/payments/payproReconcile.ts'), /activatePayment\(\{ paymentId: row\.id, source: 'gateway' \}\)/)
  // …and staff cannot approve one by hand.
  assert.match(DECIDE, /payment\.provider !== 'manual'/, 'only a bank transfer is decided by staff')
  // The receipt route never activates anything.
  assert.ok(!/activatePayment/.test(RECEIPT_ROUTE), 'a receipt upload activates nothing')
})

test('every paid checkout opens the choice screen first', () => {
  // The fee's choice screen, carrying the tuition to come back to (owner, 15 Oct 2026).
  assert.match(read('components/upgrade/TutorVerifyGate.tsx'), /router\.push\(payChoiceHref\('verified', /)
  assert.match(read('components/tutor/NewOnboardingFlow.tsx'), /<Link href=\{payChoiceHref\('verified', returnTo\)\}/)
  assert.match(read('components/tutor/GetVerifiedValueCard.tsx'), /href="\/pay\/choose\?plan=verified"/)
  const buy = read('components/membership-plans/BuyButton.tsx')
  assert.match(buy, /router\.push\(`\/pay\/choose\?plan=\$\{encodeURIComponent\(planCode\)\}`\)/, 'Premium / Featured too')
  for (const p of ['components/upgrade/TutorVerifyGate.tsx', 'components/membership-plans/BuyButton.tsx', 'components/tutor/NewOnboardingFlow.tsx', 'components/tutor/GetVerifiedValueCard.tsx']) {
    assert.ok(!read(p).includes('/api/payments/checkout\''), `${p} no longer starts a checkout itself`)
  }
})

// ------------------------------------------------ "Other method" hidden ------
test('"Other method" is hidden when the bank details are empty or the switch is off', () => {
  assert.equal(bankDetailsComplete(BANK), true)
  assert.equal(bankDetailsComplete({ ...BANK, accountNumber: null, iban: 'PK00FAYS0000000000000000' }), true, 'an IBAN alone is enough')
  assert.equal(bankDetailsComplete({ bankName: null, accountTitle: null, accountNumber: null, iban: null }), false)
  assert.equal(bankDetailsComplete({ ...BANK, accountNumber: ' ', iban: '' }), false, 'no account number and no IBAN')
  assert.equal(bankDetailsComplete({ ...BANK, accountTitle: '' }), false)
  assert.equal(bankDetailsComplete(null), false)

  assert.equal(bankTransferVisible(true, BANK), true)
  assert.equal(bankTransferVisible(false, BANK), false, 'switch off')
  assert.equal(bankTransferVisible(true, { ...BANK, bankName: '' }), false, 'details empty')

  assert.match(read('lib/payments/receipt.ts'), /bankTransferVisible\(bankTransferOn\(settings\), details\) \? details : null/)
  assert.match(CHOICE, /if \(!bank\) \{/, 'the bank panel renders only with details')
  assert.match(RECEIPT_ROUTE, /if \(!\(await loadBankPanel\(\)\)\)/, 'the server refuses it too')
  // The details come from the owner's settings, not from the code.
  for (const src of [PAGE, CHOICE]) {
    assert.ok(!/PK\d{2}[A-Z0-9]{4}/.test(src), 'no IBAN in the code')
    // The one sentence that names the bank does so to say no account there is
    // needed (owner, 17 Oct 2026); the details themselves come from settings.
    assert.ok(!/Faysal/.test(src.replace(/You don’t need a Faysal Bank account./g, '')), 'no bank name in the code')
  }
})

test('the bank details are entered by the owner only, on Payment gateways', () => {
  assert.match(read('app/api/admin/payments/bank-details/route.ts'), /checkAdminRole\(\.\.\.SCREEN_ACCESS\.paymentGateways\)/)
  const page = read('app/admin/payments/settings/gateways/page.tsx')
  assert.match(page, /id="bank-details"/)
  assert.match(page, /<BankDetailsForm/)
  assert.match(read('app/admin/payments/settings/gateways/GatewaysClient.tsx'), /Show bank transfer to members/)
  for (const r of ['admin', 'operations', 'tuitions_staff'] as const) {
    assert.equal(roleSatisfies(r, SCREEN_ACCESS.paymentGateways), false, r)
  }
})

// ------------------------------------------------ the receipt file -----------
test('a receipt is a JPG, PNG, WebP or PDF of at most 5 MB', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
    assert.equal(receiptFileProblem({ type, size: 1024 }), null, type)
  }
  for (const type of ['image/gif', 'image/heic', 'video/mp4', 'text/html', 'application/zip', '']) {
    assert.match(receiptFileProblem({ type, size: 1024 }) ?? '', /JPG, PNG or WebP image, or a PDF/, type || '(none)')
  }
  assert.equal(receiptFileProblem({ type: 'image/png', size: RECEIPT_MAX_BYTES }), null, 'exactly 5 MB')
  assert.match(receiptFileProblem({ type: 'image/png', size: RECEIPT_MAX_BYTES + 1 }) ?? '', /larger than 5 MB/)
  assert.match(receiptFileProblem(null) ?? '', /Choose a photo or PDF/)
  assert.match(receiptFileProblem({ type: 'image/png', size: 0 }) ?? '', /Choose a photo or PDF/)
  // Every refusal carries its Urdu line.
  assert.ok((receiptFileProblem({ type: 'image/gif', size: 1 }) ?? '').includes('\n'))
  // The route applies the rule before it touches the database or storage.
  assert.ok(RECEIPT_ROUTE.indexOf('receiptFileProblem(file instanceof File') < RECEIPT_ROUTE.indexOf(".from('plans')"))
  assert.equal(receiptIsPdf('u/p-1.pdf'), true)
  assert.equal(receiptIsPdf('u/p-1.jpg'), false)
})

// ------------------------------------------------ under review ---------------
const row = (o: Partial<Parameters<typeof receiptStateOf>[0][number]>) => ({
  id: 'p1', status: 'pending', provider: 'manual', screenshot_path: null, reference: null, rejection_reason: null,
  created_at: '2026-10-11T08:00:00Z', ...o,
})

test('"Payment under review" blocks a second upload', () => {
  assert.equal(receiptUnderReview(row({ screenshot_path: 'u/p.jpg' })), true)
  assert.equal(receiptUnderReview(row({})), false, 'an order with no receipt is not under review')
  assert.equal(receiptUnderReview(row({ screenshot_path: 'u/p.jpg', provider: 'paypro' })), false, 'never a gateway payment')
  assert.equal(receiptUnderReview(row({ screenshot_path: 'u/p.jpg', status: 'approved' })), false)

  assert.equal(receiptStateOf([]).state, 'none')
  assert.equal(receiptStateOf([row({})]).state, 'none')
  assert.equal(receiptStateOf([row({ screenshot_path: 'u/p.jpg' })]).state, 'under_review')

  // The server refuses, before any row or file is written.
  const guard = RECEIPT_ROUTE.indexOf("state.state === 'under_review'")
  assert.ok(guard > 0 && guard < RECEIPT_ROUTE.indexOf('.insert({') && guard < RECEIPT_ROUTE.indexOf('.upload('), 'refused before insert and upload')
  assert.match(RECEIPT_ROUTE, /code: 'under_review' \}, \{ status: 409 \}/)
  assert.match(RECEIPT_MESSAGES.alreadyUnderReview, /do not need to send it again/)
  // The screen shows the status and nothing to pay with.
  assert.match(CHOICE, /if \(state\.state === 'under_review'\) \{\s*return/)
  // The dashboard replaces the pay prompts.
  const dash = read('app/(site)/tutor/dashboard/page.tsx')
  assert.match(dash, /const feeUnderReview = feeReceipt\?\.state === 'under_review'/)
  assert.match(dash, /paymentUnderReview=\{feeUnderReview\}/)
  assert.match(read('components/tutor/VerifyBadgeControl.tsx'), /Payment under review/)
  assert.match(read('components/tutor/VerifyBadgeControl.tsx'), /payHref=\{paymentUnderReview \? undefined : payHref\}/, 'no pay button meanwhile')
  assert.match(read('components/payments/PaymentReviewNotice.tsx'), /Payment under review/)
})

// ------------------------------------------------ approve / reject -----------
test('approve activates exactly as a gateway payment; reject keeps the old file and lets them re-upload', () => {
  assert.match(DECIDE, /activatePayment\(\{ paymentId, source: 'manual_approval', actor \}\)/, 'the same activation, with the approving staff member')
  assert.match(ACTIVATE, /reviewed_by: params\.actor\?\.id \?\? null/, 'the approver is recorded')
  assert.match(ACTIVATE, /action: 'payment\.approve'/)
  assert.match(ACTIVATE, /action: 'payment\.reject'/)
  assert.match(RECEIPT_ROUTE, /method: 'bank'/, 'recorded as a bank transfer')
  assert.equal(channelLabel('manual', 'bank'), 'Bank transfer')
  assert.equal(channelLabel('manual', null), 'Bank transfer')
  assert.equal(channelLabel('paypro', null), 'PayPro')

  // Rejected → the reason is shown and a new receipt is allowed.
  const rejected = row({ id: 'p1', status: 'rejected', screenshot_path: 'u/p1-1.jpg', rejection_reason: 'The amount on the receipt is different.' })
  const s1 = receiptStateOf([rejected])
  assert.deepEqual(s1, { state: 'rejected', reason: 'The amount on the receipt is different.' })
  // The new receipt is its own payment row; the old one stays, rejected, with its file.
  const again = row({ id: 'p2', screenshot_path: 'u/p2-2.jpg', created_at: '2026-10-11T09:00:00Z' })
  assert.equal(receiptStateOf([rejected, again]).state, 'under_review')
  assert.equal(rejected.screenshot_path, 'u/p1-1.jpg')
  // Approved after a rejection → nothing to show.
  assert.equal(receiptStateOf([rejected, row({ id: 'p2', status: 'approved', screenshot_path: 'u/p2.jpg', created_at: '2026-10-11T09:00:00Z' })]).state, 'none')

  // Nothing on record is replaced or removed.
  assert.match(RECEIPT_ROUTE, /-\$\{Date\.now\(\)\}\.\$\{RECEIPT_TYPES\[file\.type\]\}/, 'a new object name per upload')
  assert.match(RECEIPT_ROUTE, /upsert: false/)
  assert.ok(!/\.remove\(|\.delete\(/.test(RECEIPT_ROUTE), 'the receipt route deletes nothing')
  const reject = ACTIVATE.slice(ACTIVATE.indexOf('export async function rejectPayment'))
  assert.ok(!/screenshot_path|\.remove\(|\.delete\(/.test(reject), 'rejecting leaves the receipt file and row alone')
  assert.match(reject, /\/pay\/choose\?plan=/, 'the rejection notice links to the re-upload screen')
  assert.match(read('components/payments/PaymentReviewNotice.tsx'), /Upload a new receipt/)
  assert.match(CHOICE, /state\.state === 'rejected'/)
})

// ------------------------------------------------ who can approve ------------
test('owner, Partner, admin and operations approve; Tuitions staff cannot', () => {
  for (const r of ['owner', 'admin', 'operations'] as const) {
    assert.equal(roleSatisfies(r, SCREEN_ACCESS.paymentsApprove), true, r)
  }
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.paymentsApprove), false)
  // The Partner opens the screen, sees no buttons, and the server refuses the POST.
  assert.equal(isReadOnlyRole('partner'), false) // full management since 13 Oct 2026 (was view-only)
  assert.match(DECIDE, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.paymentsApprove\)/, 'checkAdminRole answers 403 to a Partner on any write')
  assert.match(read('lib/adminAuth.ts'), /alwaysNeedsTwoFactor/)
  assert.match(read('app/admin/payments/PaymentDecide.tsx'), /if \(readOnly\) return null/)
  // The receipt opens in the shared viewer, turn-only (nothing saved).
  const queue = read('app/admin/payments/PaymentQueue.tsx')
  assert.match(queue, /<DocumentViewer/)
  assert.match(queue, /turnOnly: true/)
  // The "Bank transfer receipts" chip became the amber "Receipt waiting —
  // review" badge at the top of Unpaid / Incomplete (owner, 21 Oct 2026).
  assert.match(queue, /WAITING_LABEL/)
  assert.match(read('app/admin/layout.tsx'), /'\/admin\/payments': receipts/, 'sidebar badge')
})

// ------------------------------------------------ no amount elsewhere --------
test('no amount appears on other member screens', () => {
  const flow = read('components/tutor/NewOnboardingFlow.tsx')
  const step = flow.slice(flow.indexOf('function GetVerifiedStep'), flow.indexOf('function TermsLink'))
  const screens: Record<string, string> = {
    'the apply gate': read('components/upgrade/TutorVerifyGate.tsx'),
    'the onboarding final screen': step,
    'the dashboard card': read('components/tutor/GetVerifiedValueCard.tsx'),
    'the dashboard chip': read('components/tutor/VerifyBadgeControl.tsx'),
    'the benefits pop-up': read('components/tutor/VerifyBenefitsDialog.tsx'),
    'the under-review notice': read('components/payments/PaymentReviewNotice.tsx'),
    'the old order page': read('app/(site)/pay/manual/[ref]/page.tsx'),
  }
  for (const [name, src] of Object.entries(screens)) {
    assert.ok(!/Rs\.?\s?\d|\bPKR\b|price_pkr|amount_pkr|amountPkr/.test(src), `${name} carries no amount`)
  }
  for (const text of Object.values(RECEIPT_MESSAGES)) assert.ok(!/Rs|\d/.test(text), 'no figure in a receipt message')
  // The in-app notice a receipt writes carries no figure either.
  const notice = RECEIPT_ROUTE.slice(RECEIPT_ROUTE.indexOf('await notify({'), RECEIPT_ROUTE.indexOf('await logActivity({'))
  assert.ok(!/price_pkr|Rs/.test(notice))
})

// ------------------------------------------------ support + logos ------------
test('the WhatsApp help link and the logos', () => {
  const link = supportWaLink({ packageName: 'Verification Fee', name: 'Ali Raza', mobile: '0300 1234567' })
  assert.ok(link.startsWith('https://wa.me/923215872222?text=') || link.startsWith('https://api.whatsapp.com/send?phone=923215872222&text='))
  assert.equal(
    decodeURIComponent(link.split('text=')[1]),
    'Assalam o Alaikum, I paid the Verification Fee by bank transfer. My name: Ali Raza, mobile: 0300 1234567.',
  )
  // "Need help? WhatsApp us" became a "WhatsApp us" button (owner, 26 Oct 2026).
  assert.match(CHOICE, /export const WHATSAPP_US = 'WhatsApp us'/)
  assert.ok(existsSync(join(ROOT, 'public/whatsapp.png')))

  assert.equal(payLogoSrcFrom('', 'jazzcash'), null, 'no file → text label only')
  assert.equal(payLogoSrcFrom('jazzcash.png', 'jazzcash'), '/payments/jazzcash.png')
  assert.equal(payLogoSrcFrom('jazzcash.png,jazzcash.svg,faysal-bank.png', 'jazzcash'), '/payments/jazzcash.svg', 'SVG preferred')
  assert.equal(payLogoSrcFrom('jazzcash.png', 'faysal-bank'), null)
  assert.match(read('next.config.ts'), /NEXT_PUBLIC_PAY_LOGOS: PAY_LOGO_FILES\.join\(','\)/)
})
