// PR-13 (owner, 21 Nov 2026): tutor Premium and parent Featured on sale by bank
// transfer; tutor Featured stays "Coming soon" (its WhatsApp matches list was
// retired). Activation, limits, extension, upgrade, expiry, the card button
// states and amount hiding. Pure and source checks only — invented data, no
// network, nothing written anywhere.
//   npm run test:pr13
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  PAUSED_UPGRADE_CODES,
  PROMOTE_UPGRADES,
  UPGRADES_PAUSED,
  upgradeBlocked,
  upgradeRefusal,
} from '../lib/upgradesPausedCore'
import {
  buyButtonLabel,
  buyButtonState,
  downgradeRefusal,
  planChange,
  planWindow,
  signInThenPlanHref,
  FEE_FIRST_NOTE,
  type RunningPlan,
} from '../lib/planPurchaseCore'
import { computeEntitlements, type EntitlementInputs } from '../lib/entitlements'
import { roleSatisfies, SCREEN_ACCESS, type AdminRole } from '../lib/adminAccessCore'
import { paymentLabel, paymentPlanName } from '../lib/paymentLabelCore'
import { NON_REFUNDABLE_PLAN_NOTICE, NON_REFUNDABLE_RECEIPT_LINE } from '../lib/nonRefundableCore'

const src = (p: string) => readFileSync(p, 'utf8')
const DAY = 86_400_000

// ------------------------------------------------------------- on sale ----

test('A: Premium and parent Featured are on sale; tutor Featured stays Coming soon', () => {
  assert.equal(UPGRADES_PAUSED, false)
  assert.deepEqual([...PAUSED_UPGRADE_CODES], ['featured'])
  assert.equal(upgradeBlocked('premium', 499), false)
  assert.equal(upgradeBlocked('parent_featured', 999), false)
  assert.equal(upgradeBlocked('featured', 999), true)
  assert.equal(upgradeRefusal('premium', 499), null)
  assert.equal(upgradeRefusal('parent_featured', 999), null)
  assert.equal(upgradeRefusal('featured', 999)?.status, 409)
  assert.equal(upgradeBlocked('verified', 199), false, 'the fee is never paused')
  assert.equal(upgradeBlocked('premium', 499, true), true, 'a blanket pause still works')
  // Promotion stays off: only the buttons were asked for.
  assert.equal(PROMOTE_UPGRADES, false)
})

// -------------------------------------------------------- plan change ----

const premiumRunning: RunningPlan = { code: 'premium', rank: 2, expiresAt: '2026-12-10T00:00:00.000Z' }

test('B: new / extend / upgrade / downgrade', () => {
  assert.equal(planChange(null, { code: 'premium', rank: 2 }), 'new')
  assert.equal(planChange({ code: 'basic', rank: 1, expiresAt: null }, { code: 'premium', rank: 2 }), 'new', 'free tier is not a running plan')
  assert.equal(planChange(premiumRunning, { code: 'premium', rank: 2 }), 'extend')
  assert.equal(planChange(premiumRunning, { code: 'featured', rank: 3 }), 'upgrade')
  assert.equal(planChange({ code: 'featured', rank: 3, expiresAt: '2026-12-10T00:00:00Z' }, { code: 'premium', rank: 2 }), 'downgrade')
  assert.equal(downgradeRefusal('downgrade')?.status, 409)
  assert.equal(downgradeRefusal('upgrade'), null)
  assert.equal(downgradeRefusal('extend'), null)
})

test('C: activation window — 30 days from approval; extension from the current end', () => {
  const now = new Date('2026-11-21T10:00:00.000Z')
  const fresh = planWindow(now, 30, 'new', null)
  assert.equal(fresh.startsAt.toISOString(), now.toISOString())
  assert.equal(fresh.expiresAt.getTime() - now.getTime(), 30 * DAY)

  const up = planWindow(now, 30, 'upgrade', premiumRunning!.expiresAt)
  assert.equal(up.expiresAt.getTime() - now.getTime(), 30 * DAY, 'an upgrade runs a fresh 30 days, no carry-over')

  const ext = planWindow(now, 30, 'extend', premiumRunning!.expiresAt)
  assert.equal(ext.expiresAt.toISOString(), new Date(Date.parse(premiumRunning!.expiresAt!) + 30 * DAY).toISOString())

  // An end date already in the past never shortens the new month.
  const late = planWindow(now, 30, 'extend', '2026-11-01T00:00:00.000Z')
  assert.equal(late.expiresAt.getTime() - now.getTime(), 30 * DAY)
  assert.equal(planWindow(now, 0, 'new', null).expiresAt.getTime() - now.getTime(), 30 * DAY, 'missing duration = 30')
})

test('D: activate.ts applies the rules (extend never pauses, downgrade not applied, receipt line)', () => {
  const s = src('lib/payments/activate.ts')
  assert.match(s, /const running = await runningPlanFor\(userId, audience\)/)
  assert.match(s, /const change = planChange\(running,/)
  assert.match(s, /if \(change === 'downgrade'\) \{\s*return \{\s*ok: false,\s*status: 409/)
  assert.match(s, /if \(audience === 'tutor' && change !== 'extend'\) \{\s*paused = !\(await isTutorListable\(userId\)\)/)
  assert.match(s, /planWindow\(new Date\(\), days, change, running\?\.expiresAt \?\? null\)/)
  // One active subscription at a time: the old one is cancelled before the insert.
  assert.ok(s.indexOf(".in('status', ['active', 'paused'])") < s.indexOf("source: 'purchase'"))
  assert.match(s, /NON_REFUNDABLE_RECEIPT_LINE/)
  assert.doesNotMatch(s, /There are no refunds\./)
  assert.equal(NON_REFUNDABLE_RECEIPT_LINE, 'This fee is non-refundable.')
  assert.match(src('lib/notify/templates.ts'), /case 'plan_activated':[\s\S]{0,400}NON_REFUNDABLE_RECEIPT_LINE/)
})

test('E: the routes and the payment page refuse a downgrade and a paused plan', () => {
  for (const r of ['app/api/payments/receipt/route.ts', 'app/api/payments/checkout/route.ts']) {
    const s = src(r)
    assert.match(s, /upgradeRefusal\(/, r)
    assert.match(s, /downgradeRefusal\(change\)/, r)
    assert.match(s, /search_rank/, r)
  }
  const receipt = src('app/api/payments/receipt/route.ts')
  assert.match(receipt, /if \(plan\.code !== 'verified' && !feePaid\)/, 'tutor plans need the fee first')
  assert.match(receipt, /non_refundable_ack_at: nonRefundableAckAt/, 'tick time stored')
  assert.match(receipt, /sendBankTransferPending\(\{[\s\S]{0,300}what:/, 'Owner bell + email for plan receipts')
  const page = src('app/(site)/pay/choose/page.tsx')
  assert.match(page, /if \(change === 'downgrade'\) redirect\(plansHref\)/)
  assert.match(src('app/(site)/pay/choose/PayChoice.tsx'), /isFee \? NON_REFUNDABLE_NOTICE : NON_REFUNDABLE_PLAN_NOTICE/)
  assert.doesNotMatch(NON_REFUNDABLE_PLAN_NOTICE, /Rs\.?\s?\d|\d{3}/, 'no amount in the notice')
})

// ----------------------------------------------------- limits / expiry ----

const PLANS: EntitlementInputs['plans'] = [
  { code: 'basic', audience: 'tutor', name: 'Basic', monthly_quota: 10, displayed_quota: '10', can_view_contact: false, can_whatsapp: false, can_initiate_message: true, can_hire: false, can_see_viewer_identity: false, search_rank: 1, badges: ['Verified'], tag_label: null },
  { code: 'premium', audience: 'tutor', name: 'Premium', monthly_quota: 100, displayed_quota: '100', can_view_contact: true, can_whatsapp: true, can_initiate_message: true, can_hire: false, can_see_viewer_identity: true, search_rank: 2, badges: ['Verified', 'Premium'], tag_label: null },
  { code: 'featured', audience: 'tutor', name: 'Featured', monthly_quota: 300, displayed_quota: 'Unlimited', can_view_contact: true, can_whatsapp: true, can_initiate_message: true, can_hire: false, can_see_viewer_identity: true, search_rank: 3, badges: ['Verified', 'Premium', 'Featured'], tag_label: 'Featured' },
  { code: 'parent_verified', audience: 'parent', name: 'Verified', monthly_quota: 5, displayed_quota: '5', can_view_contact: false, can_whatsapp: false, can_initiate_message: true, can_hire: false, can_see_viewer_identity: false, search_rank: 1, badges: ['Verified'], tag_label: null },
  { code: 'parent_featured', audience: 'parent', name: 'Featured', monthly_quota: 100, displayed_quota: 'Unlimited', can_view_contact: true, can_whatsapp: true, can_initiate_message: true, can_hire: true, can_see_viewer_identity: false, search_rank: 3, badges: ['Verified', 'Featured'], tag_label: 'Featured' },
]
const tutorProfile = {
  role: 'tutor', profile_completion: 100, cnic_verified_at: '2026-01-01', address_verified_at: null,
  phone_verified_at: '2026-01-01', is_suspended: false, is_banned: false, phone_verified_via: 'otp',
  is_seed: false, is_team_account: false, verification_state: 'approved', cnic_number: '0000000000000',
  cnic_image_path: 'x/cnic.jpg', profile_pic_status: 'approved', avatar_url: 'x/p.jpg',
}
const tutorRow = {
  verification_status: 'verified', imported: false, claimed_at: null, under_review: false, degrees: null,
  verified_fee_paid_at: '2026-01-01', city: 'Lahore', area: 'Model Town', gender: 'female',
}
const parentProfile = { ...tutorProfile, role: 'parent', cnic_number: null, cnic_image_path: null, verification_state: null }
const tutorIn = (subs: EntitlementInputs['activeSubs'], used = 0): EntitlementInputs => ({
  userId: 't1', profile: tutorProfile, tutorRow, hasSubjects: true, activeSubs: subs, pausedPlanCode: null, plans: PLANS,
  counter: { jobs_applied: used, jobs_posted: 0 },
})
const parentIn = (subs: EntitlementInputs['activeSubs']): EntitlementInputs => ({
  userId: 'p1', profile: parentProfile, tutorRow: null, hasSubjects: false, activeSubs: subs, pausedPlanCode: null, plans: PLANS,
  counter: { jobs_applied: 0, jobs_posted: 7 },
})
const end = '2026-12-21T10:00:00.000Z'

test('F: limits switch the moment the plan row is active', () => {
  const basic = computeEntitlements(tutorIn([], 9))
  assert.equal(basic.plan, 'basic')
  assert.equal(basic.quota, 10)
  assert.equal(basic.quotaLeft, 1)
  assert.equal(basic.canWhatsapp, false)

  const premium = computeEntitlements(tutorIn([{ plan_code: 'premium', expires_at: end }], 9))
  assert.equal(premium.plan, 'premium')
  assert.equal(premium.quota, 100, 'shared monthly pool of 100')
  assert.equal(premium.quotaLeft, 91, 'same month, the used count carries over')
  assert.equal(premium.canViewContact, true)
  assert.equal(premium.canWhatsapp, true)
  assert.equal(premium.canSeeViewerIdentity, true)
  assert.ok(premium.badges.includes('Premium'))
  assert.equal(premium.expiresAt, end)

  // Upgrade lands while the old row is already cancelled — only Featured is active.
  const featured = computeEntitlements(tutorIn([{ plan_code: 'featured', expires_at: end }], 9))
  assert.equal(featured.quota, 300)
  assert.equal(featured.displayedQuota, 'Unlimited')

  const pf = computeEntitlements(parentIn([{ plan_code: 'parent_featured', expires_at: end }]))
  assert.equal(pf.plan, 'parent_featured')
  assert.equal(pf.canHire, true)
  assert.equal(pf.canViewContact, true)
  assert.equal(pf.canWhatsapp, true)
  assert.equal(pf.displayedQuota, 'Unlimited')
  assert.equal(pf.tagLabel, 'Featured', 'new jobs are stamped Featured (shown first)')
  assert.ok(pf.badges.includes('Featured'))
})

test('G: expiry returns the member to Basic / Verified (no row = free tier)', () => {
  const t = computeEntitlements(tutorIn([], 50))
  assert.equal(t.plan, 'basic')
  assert.equal(t.quota, 10)
  assert.equal(t.quotaLeft, 0)
  assert.equal(t.canWhatsapp, false)
  assert.equal(t.expiresAt, null)
  const p = computeEntitlements(parentIn([]))
  assert.equal(p.plan, 'parent_verified')
  assert.equal(p.canHire, false)
  // An expired row never reaches computeEntitlements: the read filters on the end date.
  assert.match(src('lib/entitlements.ts'), /\.eq\('status', 'active'\)\s*\.gt\('expires_at', new Date\(\)\.toISOString\(\)\)/)
  // The daily sweep (vercel.json cron) marks it expired, untags Featured, sends the in-app message.
  const sweep = src('lib/payments/expiry.ts')
  assert.match(sweep, /\.update\(\{ status: 'expired' \}\)/)
  assert.match(sweep, /kind: 'plan_expired'/)
  assert.match(sweep, /is_featured: false/)
  assert.match(src('vercel.json'), /"\/api\/cron\/subscriptions"/)
})

// ----------------------------------------------------- button states ----

const base = {
  signedIn: true, viewerAudience: 'tutor' as const, cardAudience: 'tutor' as const, feePaid: true,
  current: null as RunningPlan, plan: { code: 'premium', rank: 2 }, blocked: false,
}

test('H: card button states', () => {
  assert.equal(buyButtonState({ ...base, signedIn: false, viewerAudience: null as never }), 'sign_in')
  assert.equal(buyButtonState({ ...base, feePaid: false }), 'pay_fee_first')
  assert.equal(buyButtonState(base), 'upgrade', 'Basic tutor')
  assert.equal(buyButtonState({ ...base, current: premiumRunning }), 'extend', 'active plan — same card')
  assert.equal(buyButtonState({ ...base, current: premiumRunning, plan: { code: 'featured', rank: 3 }, blocked: true }), 'coming_soon')
  assert.equal(buyButtonState({ ...base, current: { code: 'featured', rank: 3, expiresAt: end } }), 'lower')
  assert.equal(buyButtonState({ ...base, viewerAudience: 'parent' }), 'other_audience')
  assert.equal(buyButtonState({ ...base, signedIn: false, blocked: true }), 'coming_soon', 'paused for everyone')
  // Parent Featured.
  const parent = { ...base, viewerAudience: 'parent' as const, cardAudience: 'parent' as const, feePaid: false, plan: { code: 'parent_featured', rank: 3 } }
  assert.equal(buyButtonState(parent), 'upgrade', 'parents never need the tutor fee')
  assert.equal(buyButtonState({ ...parent, current: { code: 'parent_featured', rank: 3, expiresAt: end } }), 'extend')

  assert.equal(buyButtonLabel('upgrade', 'Premium'), 'Upgrade to Premium')
  assert.equal(buyButtonLabel('sign_in', 'Featured'), 'Upgrade to Featured')
  assert.equal(buyButtonLabel('pay_fee_first', 'Premium'), 'Upgrade to Premium')
  assert.equal(buyButtonLabel('extend', 'Premium'), 'Extend 30 days')
  assert.equal(FEE_FIRST_NOTE, 'Pay the one-time Verification Fee first.')
  assert.equal(signInThenPlanHref('tutor', 'premium'), '/login?next=' + encodeURIComponent('/membership-plans?for=tutors&plan=premium'))
  assert.equal(signInThenPlanHref('parent', 'parent_featured'), '/login?next=' + encodeURIComponent('/membership-plans?for=parents&plan=parent_featured'))
})

test('I: the card renders those states; prices and card text unchanged', () => {
  const t = src('components/PackagesTable.tsx')
  assert.match(t, /buyButtonState\(\{/)
  assert.match(t, /blocked: upgradeBlocked\(p\.code, p\.price_pkr\)/)
  assert.match(t, /buy === 'coming_soon'[\s\S]{0,800}\{COMING_SOON_LABEL\}/)
  assert.match(t, /buy === 'extend' && checkoutOpen/)
  assert.match(t, /'See parent phone & email — 100'/)
  assert.match(t, /'Matched tuitions on your WhatsApp'/)
  const b = src('components/membership-plans/BuyButton.tsx')
  assert.match(b, /signInThenPlanHref\(cardAudience, planCode\)/)
  assert.match(b, /\/pay\/choose\?plan=\$\{encodeURIComponent\(planCode\)\}/)
  assert.doesNotMatch(b, /Rs\.?\s?\d/, 'no price on the button')
})

// ------------------------------------------------- admin and amounts ----

test('J: Payments label the plan; Backend Support never sees rupees', () => {
  assert.equal(paymentPlanName('premium'), 'Premium')
  assert.equal(paymentPlanName('featured'), 'Featured')
  assert.equal(paymentPlanName('parent_featured'), 'Featured parent')
  const p = { planCode: 'premium', amountPkr: 499, status: 'approved', provider: 'manual', createdAt: '2026-11-21T08:00:00Z', hasReceipt: true }
  const now = Date.parse('2026-11-21T12:00:00Z')
  assert.equal(paymentLabel(p, now, { showAmount: false }), 'Premium — paid')
  assert.equal(paymentLabel({ ...p, planCode: 'parent_featured', amountPkr: 999 }, now, { showAmount: false }), 'Featured parent — paid')
  assert.equal(paymentLabel(p, now, { showAmount: true }), 'Premium Rs 499 — paid')
  for (const r of ['backend_support', 'operations', 'tuitions_staff', 'supervisor', 'admin'] as AdminRole[]) {
    assert.equal(roleSatisfies(r, SCREEN_ACCESS.paymentAmounts), false, r)
  }
  assert.equal(roleSatisfies('owner', SCREEN_ACCESS.paymentAmounts), true)
  // Member page: plan, start and end date (no amount on the subscription rows).
  const member = src('app/admin/users/[id]/page.tsx')
  assert.match(member, /from \$\{s\.starts_at \? formatDate\(s\.starts_at as string\)[^`]*until \$\{s\.expires_at/)
  assert.match(member, /const showAmounts = roleSatisfies\(actor\.adminRole, SCREEN_ACCESS\.paymentAmounts\)/)
  // Staff may approve only the fee; plans go to the Owner.
  assert.match(src('lib/staffReceiptCore.ts'), /if \(p\.planCode !== 'verified'\) return refuse\('not_fee'\)/)
})
