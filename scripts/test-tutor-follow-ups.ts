/**
 * scripts/test-tutor-follow-ups.ts — npm run test:tutorfollowups
 *
 * Follow-ups → Tutors as ONE list (owner, 20 Oct 2026): each tutor once with
 * the right priority chip, the old list addresses redirecting to the right
 * chip, "Follow up again" after 3 days, every WhatsApp message (and the
 * rejected-document variant), the PayPro check activating only through the
 * normal path, and no duplicate "Stopped at" line. Pure rules + source scans.
 * No browser, DB or network; no phone number, email or CNIC appears here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  chipCounts,
  chipsFor,
  docFactsFrom,
  followUpMessage,
  latestContact,
  legacyFollowUpsRedirect,
  nextLabel,
  OVERVIEW_KEY_CHIP,
  paymentCheckOutcome,
  primaryChip,
  reuploadLine,
  rowsForChip,
  startedLine,
  FOLLOW_UP_AGAIN_DAYS,
  type FollowChip,
  type TutorFollowFacts,
} from '../lib/tutorFollowUpCore'
import { withoutJoined } from '../lib/tutorDocSummaryCore'
import { tutorInScope } from '../lib/staffOutreachCore'
import { roleMayWrite } from '../lib/adminAccessCore'

const read = (p: string) => readFileSync(p, 'utf8')
const DAY = 86_400_000
const NOW = Date.parse('2026-10-20T12:00:00Z')
const ago = (d: number) => new Date(NOW - d * DAY).toISOString()

const base = (o: Partial<TutorFollowFacts> = {}): TutorFollowFacts => ({
  feePaid: false,
  completion: 40,
  stoppedStep: 'cnic_photos',
  docsApproved: false,
  rejected: [],
  startedPayment: null,
  lastContactAt: null,
  ...o,
})

// ------------------------------------------------------------- chips

test('each tutor appears once on All, with the most urgent chip', () => {
  const tutors: { id: string; f: TutorFollowFacts }[] = [
    { id: 'contacted', f: base({ lastContactAt: ago(1) }) }, // stuck + contacted
    { id: 'started', f: base({ startedPayment: { planCode: 'verified', startedAt: ago(0.1) }, lastContactAt: ago(5) }) },
    { id: 'fee', f: base({ stoppedStep: 'verify', docsApproved: true }) },
    { id: 'quiet', f: base({ stoppedStep: null }) },
    { id: 'again', f: base({ stoppedStep: null, lastContactAt: ago(4) }) },
    { id: 'recent', f: base({ stoppedStep: null, lastContactAt: ago(1) }) },
  ]
  const rows = tutors.map((t) => {
    const chips = chipsFor(t.f, NOW)
    return { id: t.id, chips, primary: primaryChip(chips) }
  })
  const primary = Object.fromEntries(rows.map((r) => [r.id, r.primary]))
  assert.deepEqual(primary, {
    contacted: 'stuck',
    started: 'started',
    fee: 'docs_done',
    quiet: 'not_contacted',
    again: 'again',
    recent: 'contacted',
  })
  // A tutor can match several chips…
  assert.deepEqual([...rows[1].chips].sort(), ['again', 'on_tutor', 'started', 'stuck'].sort())
  // …and still shows up ONCE on All, most urgent first.
  const all = rowsForChip(rows, 'all')
  assert.equal(all.length, rows.length)
  assert.equal(new Set(all.map((r) => r.id)).size, rows.length)
  assert.deepEqual(all.map((r) => r.primary), ['started', 'docs_done', 'stuck', 'not_contacted', 'again', 'contacted'])
  // A chip counts everyone who matches it.
  const counts = chipCounts(rows)
  assert.equal(counts.all, 6)
  assert.equal(counts.stuck, 2)
  assert.equal(counts.started, 1)
  assert.equal(rowsForChip(rows, 'stuck').length, counts.stuck)
})

test('Docs done needs all three documents approved and only the fee left', () => {
  assert.ok(chipsFor(base({ stoppedStep: null, docsApproved: true }), NOW).has('docs_done'))
  assert.ok(!chipsFor(base({ stoppedStep: 'tagline', docsApproved: true }), NOW).has('docs_done'), 'a step left → stuck')
  assert.ok(!chipsFor(base({ stoppedStep: null, docsApproved: false }), NOW).has('docs_done'))
  assert.ok(!chipsFor(base({ stoppedStep: null, docsApproved: true, feePaid: true }), NOW).has('docs_done'))
  const d = docFactsFrom({
    cnic: { status: 'approved' },
    profilePic: { status: 'pending', rereview: true },
    selfie: { status: 'approved' },
  })
  assert.equal(d.docsApproved, true, 'a re-upload of an approved photo keeps the approval')
  const r = docFactsFrom({ cnic: { status: 'rejected', reason: 'Blurry photo' }, profilePic: { status: 'approved' }, selfie: { status: 'none' } })
  assert.equal(r.docsApproved, false)
  assert.deepEqual(r.rejected, [{ doc: 'cnic', reason: 'Blurry photo' }])
})

test('"Follow up again" after 3 days, still unpaid', () => {
  assert.equal(FOLLOW_UP_AGAIN_DAYS, 3)
  const c = (d: number, feePaid = false) => chipsFor(base({ stoppedStep: null, lastContactAt: ago(d), feePaid }), NOW)
  assert.ok(c(2.9).has('contacted') && !c(2.9).has('again'))
  assert.ok(c(3).has('again') && !c(3).has('contacted'))
  assert.ok(c(10).has('again'))
  assert.ok(c(10, true).has('contacted'), 'paid since → contacted, not again')
  assert.ok(chipsFor(base({ lastContactAt: null }), NOW).has('not_contacted'))
  // The newest of a follow-up and a logged call is the contact.
  assert.deepEqual(latestContact({ at: ago(5), by: 'Aqsa' }, { at: ago(1), by: 'Nabeel' }), { at: ago(1), by: 'Nabeel' })
  assert.equal(latestContact(null, null), null)
})

test('the default group carries started-payment tutors whatever their join date', () => {
  const t = (days: number, o: Record<string, boolean> = {}) => ({
    joinedAt: ago(days),
    feeStamped: false,
    feeApproved: false,
    onboarded: false,
    ...o,
  })
  assert.equal(tutorInScope(t(90, { startedPayment: true }), 'recent', NOW), true)
  assert.equal(tutorInScope(t(90), 'recent', NOW), false)
  // …and only there, so nobody is in two groups (21 Oct 2026).
  assert.equal(tutorInScope(t(90, { startedPayment: true }), 'older', NOW), false)
})

// ----------------------------------------------------- old addresses

test('the old list URLs redirect to the matching chip', () => {
  assert.deepEqual(OVERVIEW_KEY_CHIP, {
    'todo-uncontacted': 'not_contacted',
    'todo-stuck': 'stuck',
    'todo-stuck-sent': 'contacted',
    'todo-payments': 'started',
  })
  assert.equal(legacyFollowUpsRedirect({ filter: 'uncontacted' }), '/admin/follow-ups?chip=not_contacted')
  assert.equal(legacyFollowUpsRedirect({ filter: 'onboarding' }), '/admin/follow-ups?chip=stuck')
  assert.equal(legacyFollowUpsRedirect({ filter: 'payment' }), '/admin/follow-ups?chip=docs_done')
  assert.equal(legacyFollowUpsRedirect({ filter: 'followed' }), '/admin/follow-ups?chip=contacted')
  assert.equal(legacyFollowUpsRedirect({ filter: 'started_payment', scope: 'started_payment' }), '/admin/follow-ups?chip=started')
  assert.equal(legacyFollowUpsRedirect({ scope: 'started_payment' }), '/admin/follow-ups?chip=started')
  assert.equal(legacyFollowUpsRedirect({ filter: 'onboarding', scope: 'older', q: 'ali' }), '/admin/follow-ups?scope=older&q=ali&chip=stuck')
  // Current addresses stay put (no redirect loop); the sign-up day is kept.
  assert.equal(legacyFollowUpsRedirect({ chip: 'stuck' }), null)
  assert.equal(legacyFollowUpsRedirect({ filter: 'today' }), null)

  const overviewPage = read('app/admin/overview/[key]/page.tsx')
  assert.ok(overviewPage.includes('if (chip) redirect(chipHref(chip))'))
  const followPage = read('app/admin/follow-ups/page.tsx')
  assert.ok(followPage.includes('legacyFollowUpsRedirect(') && followPage.includes('if (to) redirect(to)'))
  const home = read('app/admin/page.tsx')
  assert.ok(home.includes('OVERVIEW_KEY_CHIP[k] ? chipHref(OVERVIEW_KEY_CHIP[k])'), 'Overview rows open the chip')
  // Each Overview number is its chip's count — the same loader as the list.
  const items = read('lib/overviewItems.ts')
  for (const c of ['not_contacted', 'stuck', 'contacted', 'started']) assert.ok(items.includes(`chipRows('${c}')`), c)
  assert.ok(read('lib/tutorFollowUps.ts').includes('loadUnpaidSignups(now, scope)'))
})

// --------------------------------------------------------- messages

test('message: stuck or not contacted — name, %, next step, dashboard link', () => {
  const m = followUpMessage(base({ completion: 62.4, stoppedStep: 'cnic_photos' }), 'Hina Khan', NOW)
  assert.equal(m.type, 'next_step')
  assert.equal(
    m.text,
    'Assalam o Alaikum Hina, your TutorMint profile is 62% complete. The next step is to add your CNIC photos. If you need any help, just reply here. 🙂 You can continue here:\nhttps://www.tutormint.org/tutor/dashboard',
  )
  assert.equal(m.templateKey, 'followup_next_step')
  // Every step has its own words.
  const words: [TutorFollowFacts['stoppedStep'], string][] = [
    ['mobile', 'verify your mobile number'],
    ['photo', 'add your profile photo'],
    ['selfie', 'take your selfie'],
    ['cnic_photos', 'add your CNIC photos'],
    ['cnic_number', 'enter your CNIC number'],
    ['degree', 'add your education'],
    ['tagline', 'write your tagline and bio'],
    ['subjects', 'choose your subjects'],
    ['level', 'choose your subjects'],
    ['area', 'choose where you teach'],
    ['city', 'choose where you teach'],
    [null, 'pay the one-time Rs 199 Verification Fee'],
    ['verify', 'pay the one-time Rs 199 Verification Fee'],
  ]
  for (const [step, phrase] of words) {
    assert.ok(followUpMessage(base({ stoppedStep: step }), 'A', NOW).text.includes(`The next step is to ${phrase}.`), String(step))
  }
})

test('message: docs done, fee not paid', () => {
  const m = followUpMessage(base({ stoppedStep: null, docsApproved: true }), 'Monica Gill', NOW)
  assert.equal(m.type, 'fee_due')
  assert.equal(
    m.text,
    'Assalam o Alaikum Monica, your documents are approved ✅. The last step is the one-time Rs 199 Verification Fee. After that you get the Verified badge and can apply to tuitions. Reply here if you need help. 🙂 Pay here:\nhttps://www.tutormint.org/pay/choose',
  )
})

test('message: started payment', () => {
  const m = followUpMessage(base({ startedPayment: { planCode: 'verified', startedAt: ago(0.2) } }), 'Fabiha Habib', NOW)
  assert.equal(m.type, 'payment_unfinished')
  assert.equal(
    m.text,
    "Assalam o Alaikum Fabiha, you started your Rs 199 Verification Fee but it didn't complete. If JazzCash gave a problem, choose 'Other methods' to pay from any bank app or Easypaisa. Reply here if you need help. 🙂 You can finish it here:\nhttps://www.tutormint.org/pay/choose",
  )
  // A plan checkout (not the fee) never gets the Rs 199 wording.
  const plan = followUpMessage(base({ startedPayment: { planCode: 'premium', startedAt: ago(0.2) } }), 'X', NOW, 'Stored plan text')
  assert.equal(plan.type, 'payment_unfinished_plan')
  assert.equal(plan.text, 'Stored plan text')
})

test('message: a rejected document comes first', () => {
  assert.equal(reuploadLine([{ doc: 'selfie', reason: 'Face not clear.' }]), 'Please re-upload your selfie first (Face not clear).')
  assert.equal(
    reuploadLine([
      { doc: 'cnic', reason: 'Blurry' },
      { doc: 'photo', reason: null },
    ]),
    'Please re-upload your CNIC photos and profile photo first (Blurry).',
  )
  assert.equal(reuploadLine([{ doc: 'photo', reason: null }]), 'Please re-upload your profile photo first.')
  assert.equal(reuploadLine([]), null)
  const m = followUpMessage(base({ stoppedStep: 'tagline', rejected: [{ doc: 'selfie', reason: 'Face not clear' }] }), 'Hina', NOW)
  assert.ok(m.text.startsWith('Please re-upload your selfie first (Face not clear).\n\nAssalam o Alaikum Hina, your TutorMint profile is'))
  assert.equal(m.templateKey, 'followup_reupload_next_step')
  // No message carries a phone number, an email or a CNIC.
  for (const t of [m.text, followUpMessage(base(), 'A', NOW).text]) {
    assert.doesNotMatch(t, /\d{10,}|@|\d{5}-\d{7}-\d/)
  }
})

test('every WhatsApp tap is a follow-up with its message type', () => {
  const card = read('app/admin/follow-ups/UnpaidSignupRow.tsx')
  assert.ok(card.includes('templateKey={row.templateKey}'), 'the message type is stored with the follow-up')
  assert.ok(read('lib/tutorFollowUps.ts').includes('waLink(r.msisdn, msg.text)'))
  // My sign-ups: the same builder for unpaid tutors, and the tap logs the type.
  const my = read('lib/mySignups.ts')
  assert.ok(my.includes('followUpMessage(') && my.includes('detail: { nextStep, messageType, creditedTo: credit.staff_id }'))
  assert.ok(read('components/admin/SignupRows.tsx').includes('logTap(r.memberId, r.nextStep, r.messageType)'))
})

// ------------------------------------------------------ short cards

test('no duplicate "Stopped at" line; long text behind See all steps', () => {
  assert.equal(withoutJoined('Joined 1 Oct 2026 · stopped at Selfie'), null)
  assert.equal(withoutJoined('Stopped at Selfie · joined 1 Oct · Still to do: x'), null)
  assert.equal(withoutJoined('Next: Selfie · Rs 199'), 'Rs 199')
  const grid = read('components/admin/OverviewCardGrid.tsx')
  assert.ok(!grid.includes('Stopped at:'), 'the grid says Next: once')
  assert.ok(grid.includes('Next: {m.stoppedAt}'))
  const card = read('app/admin/follow-ups/UnpaidSignupRow.tsx')
  assert.ok(!/stopped at/i.test(card), 'the follow-up card never says "stopped at"')
  assert.equal((card.match(/Next: <span/g) ?? []).length, 1, 'one Next: line')
  const details = card.slice(card.indexOf('<details'))
  assert.ok(details.includes('Still to do:'), 'Still to do is inside See all steps')
  assert.ok(details.includes('Order ID:'), 'the order ID is inside See all steps')
  assert.ok(!card.slice(0, card.indexOf('<details')).includes('Still to do:'))
  assert.equal(nextLabel({ stoppedStep: 'cnic_photos', feePaid: false }), 'CNIC photos')
  assert.equal(nextLabel({ stoppedStep: null, feePaid: false }), 'Verification Fee')
  assert.equal(nextLabel({ stoppedStep: null, feePaid: true }), null)
  assert.equal(startedLine('19 Oct 2026, 3:10 pm', 'Verification Fee', 'paypro'), 'Started 19 Oct 2026, 3:10 pm · Verification Fee · PayPro')
})

// ------------------------------------------------- PayPro status check

test('the PayPro check activates only through the normal confirmation path', () => {
  const route = read('app/api/admin/follow-ups/payment-check/route.ts')
  assert.ok(route.includes("checkAdminRole('partner')"), 'Owner + Partner')
  assert.ok(route.includes('confirmPayproOrder({'), 'the callback / cron path')
  assert.ok(!/\.update\(/.test(route) && !/activatePayment/.test(route), 'never writes a payment itself')
  assert.ok(route.includes("row.provider !== 'paypro'"))
  assert.ok(route.includes("action: 'payment.status_check'"), 'audited')
  assert.ok(!/console\.(log|info|warn|error)/.test(route), 'logs nothing')
  // Only the Owner and the Partner (the roles that see payment amounts).
  assert.equal(roleMayWrite('owner', ['partner']), true)
  assert.equal(roleMayWrite('partner', ['partner']), true)
  for (const r of ['admin', 'operations', 'tuitions_staff'] as const) assert.equal(roleMayWrite(r, ['partner']), false, r)
  assert.ok(read('app/admin/follow-ups/page.tsx').includes("canCheckPayment={roleMayWrite(actor.adminRole, ['partner'])}"))

  // The answer in words.
  const t = '20 Oct 2026, 5:00 pm'
  assert.equal(paymentCheckOutcome({ activated: true, alreadyActive: false, accepted: true, ggosOk: true }, t).state, 'paid')
  assert.equal(paymentCheckOutcome({ activated: false, alreadyActive: true, accepted: true, ggosOk: true }, t).message, 'Paid ✅')
  assert.equal(
    paymentCheckOutcome({ activated: false, alreadyActive: false, accepted: false, ggosOk: true, reason: 'not_paid' }, t).message,
    `Not paid yet (checked ${t})`,
  )
  assert.equal(paymentCheckOutcome({ activated: false, alreadyActive: false, accepted: false, ggosOk: false }, t).state, 'unreachable')
  assert.equal(paymentCheckOutcome({ activated: false, alreadyActive: false, accepted: false, ggosOk: true, reason: 'underpaid' }, t).state, 'mismatch')
})

test('chip helpers keep the chip set', () => {
  const s = new Set<FollowChip>(['stuck', 'not_contacted'])
  assert.equal(primaryChip(s), 'stuck')
  assert.equal(primaryChip(new Set()), 'contacted')
})
