/**
 * scripts/test-paid-signups-welcome.ts — owner, 9 Nov 2026 (PR 1 of 2).
 * Invented data only; nothing touches the database.
 *   npm run test:paidwelcome
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'

import { COMING_SOON_LABEL, isUpgradePlan, upgradeBlocked, upgradeRefusal, UPGRADES_PAUSED } from '../lib/upgradesPausedCore'
import { computeEntitlements, type EntitlementInputs } from '../lib/entitlements'
import {
  ADMIN_ID,
  attributionOf,
  carriesMoney,
  countIn,
  dailyBars,
  periodCounts,
  periodRange,
  pkWeekStart,
  SELF_ID,
  targetPace,
  whoBrought,
  type PaidSignup,
} from '../lib/paidSignupsCore'
import { countPaidNotWelcomed, currentWelcome, welcomeDue, welcomedLine, welcomeMessage } from '../lib/paidWelcomeCore'
import { SCREEN_ACCESS } from '../lib/adminAccessCore'
import { roleSatisfies } from '../lib/adminAccessCore'
import { renderSocialBanner, type BannerTutor } from '../app/api/admin/social/image/render'
import { PARENT_DEFAULTS } from '../lib/parentFollowUpCore'

const root = process.cwd()
const src = (p: string) => readFileSync(path.join(root, p), 'utf8')
const HOUR = 3_600_000
const DAY = 24 * HOUR
/** An instant given as Pakistan wall-clock time. */
const pkt = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h - 5, mi)

// ------------------------------------------------------------ 1 upgrades paused

test('an upgrade purchase is refused on the server; the Verification Fee is not', () => {
  assert.equal(UPGRADES_PAUSED, true)
  for (const code of ['premium', 'featured', 'parent_featured']) {
    const r = upgradeRefusal(code, 499)
    assert.ok(r, code)
    assert.equal(r!.status, 409)
    assert.equal(r!.code, 'upgrades_paused')
  }
  assert.equal(upgradeRefusal('verified', 199), null, 'the fee can still be bought')
  assert.equal(upgradeRefusal('basic', 0), null, 'a free plan is never an upgrade')
  assert.equal(isUpgradePlan('verified'), false)
  assert.equal(upgradeBlocked('premium', 499, false), false, 'switching the pause off sells upgrades again')

  // Both routes that create a payment refuse BEFORE any payment row is made.
  for (const route of ['app/api/payments/checkout/route.ts', 'app/api/payments/receipt/route.ts']) {
    const s = src(route)
    const refuse = s.indexOf('upgradeRefusal(')
    assert.ok(refuse > 0, `${route} calls upgradeRefusal`)
    for (const writer of ["from('payments')", 'startPayproCheckout(', 'manual.createCheckout(']) {
      const at = s.indexOf(writer, s.indexOf('export async function POST'))
      if (at > 0) assert.ok(refuse < at, `${route}: refused before ${writer}`)
    }
  }
  // /pay/choose never shows a payment for an upgrade; the cards show "Coming soon".
  assert.match(src('app/(site)/pay/choose/page.tsx'), /upgradeBlocked\(plan\.code/)
  assert.match(src('components/PackagesTable.tsx'), /upgradeBlocked\(p\.code, p\.price_pkr\)/)
  assert.match(src('components/PackagesTable.tsx'), /COMING_SOON_LABEL/)
  assert.equal(COMING_SOON_LABEL, 'Coming soon')
  assert.match(src('components/upgrade/UpgradeSheet.tsx'), /upgradeBlocked\(gate\.plan\.code/)
  // No Urdu beside the badge names on the plans page.
  assert.match(src('components/PackagesTable.tsx'), /showUrdu=\{false\}/)
})

test('an upgrade already held keeps every benefit until its end date', () => {
  const PLANS: EntitlementInputs['plans'] = [
    { code: 'basic', audience: 'tutor', name: 'Basic', monthly_quota: 10, displayed_quota: '10', can_view_contact: false, can_whatsapp: false, can_initiate_message: true, can_hire: false, can_see_viewer_identity: false, search_rank: 1, badges: ['Verified'], tag_label: null },
    { code: 'premium', audience: 'tutor', name: 'Premium', monthly_quota: 100, displayed_quota: '100', can_view_contact: true, can_whatsapp: true, can_initiate_message: true, can_hire: false, can_see_viewer_identity: true, search_rank: 2, badges: ['Verified', 'Premium'], tag_label: null },
  ]
  const profile = {
    role: 'tutor', profile_completion: 100, cnic_verified_at: '2026-01-01', address_verified_at: null, phone_verified_at: '2026-01-01',
    is_suspended: false, is_banned: false, phone_verified_via: 'otp', is_seed: false, is_team_account: false, verification_state: 'approved',
    cnic_number: '0000000000000', cnic_image_path: 'identity-docs/x/cnic.jpg', profile_pic_status: 'approved', selfie_status: 'approved', avatar_url: 'avatars/x/p.jpg',
  }
  const tutorRow = { verification_status: 'verified', imported: false, claimed_at: null, under_review: false, degrees: [], verified_fee_paid_at: '2026-01-01', city: 'Lahore', area: 'DHA', gender: 'female' }
  const ends = new Date(Date.now() + 10 * DAY).toISOString()
  const e = computeEntitlements({ userId: 'x', profile, tutorRow, hasSubjects: true, activeSubs: [{ plan_code: 'premium', expires_at: ends }], pausedPlanCode: null, plans: PLANS, counter: null } as EntitlementInputs)
  assert.equal(e.plan, 'premium')
  assert.equal(e.canViewContact, true)
  assert.equal(e.canWhatsapp, true)
  // The pause lives only where a purchase starts — never in what a plan grants.
  assert.doesNotMatch(src('lib/entitlements.ts'), /upgradesPaused/)
  // Expiry ends a plan on its date as before; only the 'Renew' reminder reads the promotion switch (owner, 10 Nov 2026).
  assert.doesNotMatch(src('lib/payments/expiry.ts'), /UPGRADES_PAUSED|upgradeBlocked|upgradeRefusal/)
})

// ------------------------------------------------------------ 2 paid sign-ups

test('periods use Karachi time — a payment at 11:30 pm PKT counts on that day', () => {
  const now = pkt(2026, 11, 10, 9) // Tue 10 Nov 2026, 09:00 PKT
  const late = new Date(pkt(2026, 11, 9, 23, 30)).toISOString() // Mon 9 Nov, 23:30 PKT = 18:30 UTC
  const rows: PaidSignup[] = [{ at: late, by: SELF_ID }]
  assert.equal(countIn(rows, periodRange('yesterday', now)), 1, 'yesterday in Pakistan')
  assert.equal(countIn(rows, periodRange('today', now)), 0)
  // 00:30 PKT on 10 Nov is still 9 Nov in UTC — it belongs to today here.
  const early = { at: new Date(pkt(2026, 11, 10, 0, 30)).toISOString(), by: SELF_ID }
  assert.equal(countIn([early], periodRange('today', now)), 1)
  // Weeks run Monday to Sunday: Monday 9 Nov 00:00 PKT.
  assert.equal(pkWeekStart(now), pkt(2026, 11, 9))
  assert.equal(countIn(rows, periodRange('this_week', now)), 1)
  // Sunday 8 Nov 23:30 PKT is last week.
  const sun = { at: new Date(pkt(2026, 11, 8, 23, 30)).toISOString(), by: SELF_ID }
  assert.equal(countIn([sun], periodRange('last_week', now)), 1)
  assert.equal(countIn([sun], periodRange('this_week', now)), 0)
  // Month: 31 Oct 23:30 PKT is last month, 1 Nov 00:10 PKT this month.
  const oct = { at: new Date(pkt(2026, 10, 31, 23, 30)).toISOString(), by: SELF_ID }
  const nov = { at: new Date(pkt(2026, 11, 1, 0, 10)).toISOString(), by: SELF_ID }
  assert.equal(countIn([oct, nov], periodRange('last_month', now)), 1)
  assert.equal(countIn([oct, nov], periodRange('this_month', now)), 1)
  assert.equal(countIn([oct, nov], periodRange('all', now)), 2)
  // The 30 bars are Pakistan days, the 11:30 pm payment on 9 Nov.
  const bars = dailyBars(rows, now, 30)
  assert.equal(bars.length, 30)
  assert.equal(bars[bars.length - 1].day, '2026-11-10')
  assert.equal(bars.find((b) => b.day === '2026-11-09')!.count, 1)
})

test('week and month show the change against the period before', () => {
  const now = pkt(2026, 11, 10, 12)
  const at = (y: number, m: number, d: number) => ({ at: new Date(pkt(y, m, d, 10)).toISOString(), by: SELF_ID })
  const rows = [at(2026, 11, 9), at(2026, 11, 10), at(2026, 11, 3), at(2026, 10, 5), at(2026, 10, 6), at(2026, 10, 20)]
  const c = Object.fromEntries(periodCounts(rows, now).map((p) => [p.key, p]))
  assert.equal(c.this_week.count, 2)
  assert.equal(c.this_week.change!.prev, 1, 'last week up to the same time')
  assert.equal(c.this_week.change!.arrow, '↑')
  assert.equal(c.this_month.count, 3)
  assert.equal(c.this_month.change!.prev, 2, 'October up to the 10th')
  assert.equal(c.last_month.count, 3)
  assert.equal(c.today.change, null)
})

test('the 700 target and the pace needed per remaining day', () => {
  const now = pkt(2026, 11, 10, 9) // 21 days left in November, today included
  const rows: PaidSignup[] = Array.from({ length: 70 }, (_, i) => ({ at: new Date(pkt(2026, 11, 1 + (i % 9), 12)).toISOString(), by: SELF_ID }))
  const p = targetPace(rows, now)
  assert.equal(p.paid, 70)
  assert.equal(p.target, 700)
  assert.equal(p.daysLeft, 21)
  assert.equal(p.left, 630)
  assert.equal(p.perDay, 30) // 630 / 21
  const p2 = targetPace(rows.slice(0, 1), now)
  assert.equal(p2.perDay, 33.3) // 699 / 21 = 33.28… rounded UP to one decimal
  const last = targetPace([], pkt(2026, 11, 30, 23))
  assert.equal(last.daysLeft, 1)
  assert.equal(last.perDay, 700)
  const done = targetPace(Array.from({ length: 700 }, () => ({ at: new Date(pkt(2026, 11, 2)).toISOString(), by: SELF_ID })), now)
  assert.equal(done.reached, true)
  assert.equal(done.perDay, 0)
})

test('who brought them: each staff member, then Self and Admin', () => {
  const now = pkt(2026, 11, 10, 9)
  const at = new Date(pkt(2026, 11, 9, 12)).toISOString()
  const rows: PaidSignup[] = [
    { at, by: 'staff-a' }, { at, by: 'staff-a' }, { at, by: 'staff-b' }, { at, by: SELF_ID }, { at, by: ADMIN_ID },
    { at: new Date(pkt(2026, 9, 1)).toISOString(), by: 'staff-b' },
  ]
  const who = whoBrought(rows, periodRange('this_month', now), { 'staff-a': 'Aqsa', 'staff-b': 'Zubia' })
  assert.deepEqual(who.map((w) => [w.name, w.count]), [['Aqsa', 2], ['Zubia', 1], ['Self (no staff link)', 1], ['Admin (credit refused under the rules)', 1]])
  assert.equal(attributionOf('staff-a', false), 'staff-a')
  assert.equal(attributionOf('admin', true), ADMIN_ID, 'a refused staff credit is Admin')
  assert.equal(attributionOf('admin', false), SELF_ID, 'no staff link is Self')
  assert.equal(attributionOf(null, false), SELF_ID)
})

test('Backend Support sees no rupees on the paid sign-ups view', () => {
  assert.ok(roleSatisfies('backend_support', SCREEN_ACCESS.paidSignups), 'Backend Support opens the view')
  assert.ok(!roleSatisfies('backend_support', SCREEN_ACCESS.paymentAmounts), 'and never sees amounts')
  // The stored data carries no money at all.
  const payload = { rows: [{ at: '2026-11-09T18:30:00.000Z', by: 'staff-a' }], names: { 'staff-a': 'Aqsa' } }
  assert.equal(carriesMoney(payload), false)
  assert.equal(carriesMoney({ rows: [{ at: 'x', amount_pkr: 199 }] }), true, 'the guard notices money')
  // The loader reads no amount column and the page prints none.
  const loader = src('lib/paidSignups.ts')
  assert.doesNotMatch(loader, /amount|price_pkr|revenue/)
  const page = src('app/admin/paid-signups/page.tsx')
  assert.doesNotMatch(page, /amount|price_pkr|Rs[ .]|pkr\(/)
})

// ------------------------------------------------------------ 3 welcome

test('the welcome log, its Undo and the "Paid, not welcomed" count', () => {
  const now = pkt(2026, 11, 10, 9)
  const paid = new Date(now - 3 * DAY).toISOString()
  // No welcome yet → due.
  assert.equal(welcomeDue(paid, null, now), true)
  // A welcome that was undone does not count; the newest live one does.
  const rows: { id: string; created_at: string; undone_at: string | null; staff_name: string | null }[] = [
    { id: 'w1', created_at: new Date(now - 2 * DAY).toISOString(), undone_at: new Date(now - 2 * DAY + 5000).toISOString(), staff_name: 'Aqsa' },
  ]
  assert.equal(currentWelcome(rows), null, 'an undone welcome is no welcome')
  rows.push({ id: 'w2', created_at: new Date(now - DAY).toISOString(), undone_at: null, staff_name: 'Zubia' })
  const w = currentWelcome(rows)!
  assert.equal(w.id, 'w2')
  assert.equal(w.by, 'Zubia')
  assert.equal(welcomeDue(paid, w, now), false)
  assert.equal(welcomedLine(w, () => '9 Nov 2026'), 'Welcomed ✓ by Zubia, 9 Nov 2026')
  // Paid over 30 days ago is out of the to-do.
  assert.equal(welcomeDue(new Date(now - 31 * DAY).toISOString(), null, now), false)
  assert.equal(welcomeDue(null, null, now), false, 'not paid → not due')
  assert.equal(
    countPaidNotWelcomed(
      [
        { paidAt: paid, welcome: null },
        { paidAt: paid, welcome: w },
        { paidAt: new Date(now - 40 * DAY).toISOString(), welcome: null },
        { paidAt: new Date(now - 10 * DAY).toISOString(), welcome: null },
      ],
      now,
    ),
    2,
  )
  // The route records source 'welcome' and has the sender-only Undo.
  const route = src('app/api/admin/people/welcome/route.ts')
  assert.match(route, /source: WELCOME_SOURCE/)
  assert.match(route, /undoTutorFollowUp\(/)
  assert.match(src('supabase/migrations/226_paid_welcome_parent_welcome.sql'), /'welcome'/)
  // The welcome is not a pipeline follow-up.
  assert.match(src('lib/tutorPipeline.ts'), /r\.source === 'welcome'/)
  // The Overview row sits right after the fee follow-up row.
  const page = src('app/admin/page.tsx')
  assert.ok(page.indexOf("'todo-not-welcomed'") > page.indexOf("'todo-fee-pending',"))
})

test('the welcome text: thanks, the live profile link, the status image, the plan line when upgraded', () => {
  const base = { firstName: 'Ayesha', profileUrl: 'https://www.tutormint.org/tutor/ayesha-khan', supportWhatsapp: '0321 5872222' }
  const t = welcomeMessage(base)
  assert.match(t, /thank you for joining TutorMint and getting verified/)
  assert.match(t, /https:\/\/www\.tutormint\.org\/tutor\/ayesha-khan/)
  assert.match(t, /status/)
  assert.doesNotMatch(t, /plan is active/)
  assert.doesNotMatch(t, /Rs\.?\s?\d|PKR|best|largest|No\.?\s?1/i)
  const up = welcomeMessage({ ...base, plan: { name: 'Premium', endsOn: '30 Nov 2026' } })
  assert.match(up, /Your Premium plan is active until 30 Nov 2026\./)
  assert.equal(up.split('\n').length, t.split('\n').length + 1, 'exactly one extra line')
  const notLive = welcomeMessage({ ...base, profileUrl: null })
  assert.match(notLive, /goes live as soon as your documents are approved/)
})

// ------------------------------------------------------------ 3b status image

test('the status image uses the display name and carries no phone number', async () => {
  // The data: the public display name (full_name), never the CNIC name or a phone.
  const post = src('lib/social/postTutor.ts')
  assert.match(post, /full_name/)
  assert.doesNotMatch(post, /cnic_name|phone_number|whatsapp|\.email/)
  const status = src('lib/social/statusImage.ts')
  assert.doesNotMatch(status, /cnic_name|phone_number|whatsapp/)
  // Rendered with invented data: 1080 × 1920, from the tutor's display name.
  const tutor: BannerTutor = {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'invented-tutor',
    full_name: 'Invented Display Name',
    headline: 'Maths made simple',
    city: 'Lahore',
    area: 'DHA',
    rating_avg: 0,
    rating_count: 0,
    avatar_url: null,
    experience_years: 3,
    teaching_mode: 'Home Tutor',
    gender: 'female',
  }
  const qrDataUri = await QRCode.toDataURL('https://www.tutormint.org/tutor/invented-tutor', { margin: 1 })
  const res = renderSocialBanner({
    tutor,
    badges: ['Verified'],
    subjects: ['Matric Mathematics'],
    subjectParts: [{ level: 'Matric', subject: 'Mathematics' }],
    format: 'story',
    template: 'verified',
    qrDataUri,
    profileUrl: 'https://www.tutormint.org/tutor/invented-tutor',
    headline: '',
    verified: true,
  })
  const png = Buffer.from(await res.arrayBuffer())
  assert.equal(png.readUInt32BE(16), 1080, 'width')
  assert.equal(png.readUInt32BE(20), 1920, 'height')
  // The props the picture is drawn from carry no phone at all.
  assert.ok(!Object.keys(tutor).some((k) => /phone|whatsapp|cnic/.test(k)))
  // The tagline is on it.
  assert.match(src('lib/social/copy.ts'), /Free to join\. No commission\. No middleman\./)
})

// ------------------------------------------------------------ 4 parent welcome

test('the parent welcome says the parent posts the tuition themselves', () => {
  const t = PARENT_DEFAULTS.pf_no_tuition
  assert.match(t, /You can post your tuition yourself, for free\./)
  assert.match(t, /https:\/\/www\.tutormint\.org\/post-tuition/)
  assert.match(t, /https:\/\/www\.tutormint\.org\/browse\/tutors/)
  assert.doesNotMatch(t, /tell us/i)
  assert.match(src('supabase/migrations/226_paid_welcome_parent_welcome.sql'), /post your tuition yourself/)
})
