/**
 * scripts/test-missing-items.ts — npm run test:missingitems
 *
 * "What's missing" (owner, 13 Oct 2026): the list matches the real rules — the
 * onboarding steps' own "done" test, and the real "visible on Google" rule — and
 * the same list reaches the admin stuck list and the WhatsApp follow-up text.
 * Pure — no network, no database.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { NEW_FLOW_ORDER, missingSteps, stepDone, type FlowFacts, type FlowStepKey } from '../lib/tutorFlow'
import { fixHref, missingSentence, missingSummary, onboardingItems, progressLine, stepFromParam } from '../lib/onboarding/missingItems'
import { googleVisibilityLine, tutorIndexRequirements, tutorProfileIndexable } from '../lib/seo/indexable'
import { followUpText } from '../lib/followUpCore'
import { payproFileNote, waitingOrderLine, OVERVIEW_ITEMS, PAYPRO_FILE_STALE_DAYS } from '../lib/overviewItemsCore'

const read = (p: string) => readFileSync(p, 'utf8')

const empty: FlowFacts = {
  fullName: 'Ayesha', gender: null, city: null, area: null, avatarUrl: null, headline: null, bio: null,
  experienceYears: null, hourlyRate: null, jobTypes: [], degreesCount: 0, degreeDocCount: 0, degrees: [],
  cnicNumber: null, cnicImagePath: null, subjectCount: 0, selfieDone: false, availabilityCount: 0,
  phoneVerified: false, whatsapp: null, feePaid: false, noDegreeYet: false, isSeed: false, isTeamAccount: false,
  isBanned: false, isSuspended: false, underReview: false, verificationStatus: null, imported: false, claimedAt: null,
}
const full: FlowFacts = {
  ...empty, gender: 'female', city: 'Lahore', area: 'Gulberg', avatarUrl: 'https://x/a.jpg', headline: 'Maths tutor', bio: 'I teach.',
  experienceYears: 0, hourlyRate: 8000, jobTypes: ['Home Tutor'], degreesCount: 1, cnicNumber: '35202-1234567-1', cnicImagePath: 'y',
  subjectCount: 3, selfieDone: true, availabilityCount: 1, phoneVerified: true, whatsapp: '923001234567', feePaid: true,
}

/** Each fact that completes one item, applied one at a time. */
const FILL: [string, Partial<FlowFacts>][] = [
  ['gender', { gender: 'female' }],
  ['city', { city: 'Lahore' }],
  ['area', { area: 'Gulberg' }],
  ['subjects', { subjectCount: 2 }],
  ['jobtype', { jobTypes: ['Home Tutor'] }],
  ['fee', { hourlyRate: 8000 }],
  ['experience', { experienceYears: 0 }],
  ['degree', { degreesCount: 1 }],
  ['availability', { availabilityCount: 1 }],
  ['mobile', { phoneVerified: true }],
  ['whatsapp', { whatsapp: '923001234567' }],
  ['photo', { avatarUrl: 'https://x/a.jpg' }],
  ['selfie', { selfieDone: true }],
  ['cnic_number', { cnicNumber: '35202-1234567-1' }],
  ['cnic_photos', { cnicImagePath: 'y' }],
  ['tagline', { headline: 'Maths tutor', bio: 'I teach.' }],
  ['verify', { feePaid: true }],
]

test('one item per thing the flow asks for, in flow order, in plain English', () => {
  const items = onboardingItems(empty)
  assert.deepEqual(items.map((i) => i.key), FILL.map(([k]) => k))
  assert.ok(items.every((i) => !i.done))
  assert.deepEqual(
    items.slice(0, 4).map((i) => i.label),
    ['Choose your gender', 'Choose your city', 'Add your teaching areas', 'Add your subjects'],
  )
  // Every item points at a real step of the live flow.
  for (const i of items) assert.ok(NEW_FLOW_ORDER.includes(i.step), i.key)
  assert.equal(progressLine(missingSummary(empty)), '0 of 17 done')
})

test('each item is done by exactly the fact its step needs', () => {
  for (const [key, patch] of FILL) {
    const items = onboardingItems({ ...empty, ...patch })
    assert.equal(items.find((i) => i.key === key)!.done, true, `${key} done`)
    assert.equal(items.filter((i) => i.done).length, 1, `${key}: nothing else became done`)
  }
})

test('the list is empty exactly when the real steps have nothing left', () => {
  assert.equal(missingSummary(full).missing.length, 0)
  assert.deepEqual(missingSteps(full, NEW_FLOW_ORDER), [])
  // Take one fact away at a time: the item is missing AND its step is not done.
  for (const [key] of FILL) {
    const undo: Partial<FlowFacts> = Object.fromEntries(Object.keys(FILL.find(([k]) => k === key)![1]).map((f) => [f, (empty as Record<string, unknown>)[f]]))
    const f = { ...full, ...undo }
    const s = missingSummary(f)
    assert.deepEqual(s.missing.map((m) => m.key), [key])
    assert.equal(stepDone(f, s.missing[0].step), false, `${key}: its step (${s.missing[0].step}) is not done either`)
    assert.ok(missingSteps(f, NEW_FLOW_ORDER).includes(s.missing[0].step))
    assert.equal(progressLine(s), '16 of 17 done')
  }
  // No rule of its own: a step the flow calls done never has a missing item.
  for (const step of NEW_FLOW_ORDER) {
    if (!stepDone(full, step)) continue
    assert.ok(!missingSummary(full).missing.some((m) => m.step === step))
  }
})

test('"Fix now" opens the exact step, and older links still land', () => {
  const mobile = onboardingItems(empty).find((i) => i.key === 'mobile')!
  assert.equal(fixHref(mobile), '/tutor/complete-profile?step=contact')
  assert.equal(fixHref(onboardingItems(empty)[3]), '/tutor/complete-profile?step=subjects')
  assert.equal(stepFromParam('subjects'), 'subjects')
  assert.equal(stepFromParam('mobile'), 'contact')
  assert.equal(stepFromParam('level'), 'subjects')
  assert.equal(stepFromParam('verify'), 'verify')
  assert.equal(stepFromParam('nonsense'), null)
  assert.equal(stepFromParam(undefined), null)
  // The flow honours it, and the page passes it.
  assert.ok(read('components/tutor/NewOnboardingFlow.tsx').includes('initialStep && ORDER.includes(initialStep) ? initialStep'))
  assert.ok(read('app/(site)/tutor/complete-profile/page.tsx').includes('initialStep={stepFromParam(step)}'))
})

test('"visible on Google" is the real index rule, all sixteen cases', () => {
  const reqs = tutorIndexRequirements({ feePaid: false, cnicApproved: false, profilePicApproved: false, selfieApproved: false })
  assert.deepEqual(reqs.map((r) => r.key), ['fee', 'cnic', 'photo', 'selfie'])
  for (let n = 0; n < 16; n++) {
    const f = { feePaid: !!(n & 1), cnicApproved: !!(n & 2), profilePicApproved: !!(n & 4), selfieApproved: !!(n & 8) }
    assert.equal(tutorIndexRequirements(f).every((r) => r.met), tutorProfileIndexable(f), JSON.stringify(f))
  }
  assert.equal(
    googleVisibilityLine(reqs),
    'Your profile appears on Google once: the Verification Fee is paid, our team has approved your CNIC, our team has approved your profile photo, and our team has approved your selfie.',
  )
  // The rule does NOT need onboarding to be complete, so the line does not say so.
  assert.ok(!/onboarding|100%/i.test(googleVisibilityLine(reqs)))
})

test('the dashboard and every onboarding step show the list', () => {
  const dash = read('app/(site)/tutor/dashboard/page.tsx')
  assert.ok(dash.includes('loadWhatsMissing(userId)') && dash.includes('<WhatsMissing'))
  const flow = read('components/tutor/NewOnboardingFlow.tsx')
  assert.ok(flow.includes('missingSummary(flowFacts(facts) as FlowFacts)') && flow.includes('<WhatsMissing\n        compact'))
  const card = read('components/tutor/WhatsMissing.tsx')
  assert.ok(card.includes('Fix now') && card.includes('role="progressbar"') && card.includes('{google.line}'))
  const lib = read('lib/whatsMissing.ts')
  assert.ok(lib.includes('missingSummary(s.facts)') && lib.includes('tutorIndexRequirements(facts)'))
})

test('the admin stuck list and the WhatsApp message use the same list', () => {
  assert.ok(read('lib/onboardingStop.ts').includes('missing: missingSummary(facts).missing.map((m) => m.label)'))
  assert.ok(read('lib/overviewItems.ts').includes('missing: r.missing })'))
  const left = ['Add your subjects', 'Choose your gender', 'Add your teaching areas']
  assert.equal(missingSentence(left), 'Add your subjects, choose your gender and add your teaching areas.')
  assert.equal(missingSentence(['Add your subjects']), 'Add your subjects.')
  assert.equal(missingSentence(['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7'], 5), 'A1, b2, c3, d4, e5 and 2 more.')
  assert.equal(missingSentence([]), '')

  // The stored template is used as it is; the list goes on its own line before the link.
  const template = 'Assalam-o-Alaikum {name}, your TutorMint profile is nearly ready.\nاپنا پروفائل مکمل کریں۔'
  const text = followUpText(template, { name: 'Ayesha', step: 'Subjects', link: 'https://www.tutormint.org/tutor/onboarding', missing: left })
  assert.equal(
    text,
    'Assalam-o-Alaikum Ayesha, your TutorMint profile is nearly ready.\nاپنا پروفائل مکمل کریں۔\n\nStill to do: Add your subjects, choose your gender and add your teaching areas.\n\nhttps://www.tutormint.org/tutor/onboarding',
  )
  assert.ok(text.includes('اپنا پروفائل مکمل کریں۔'), 'the Urdu line is untouched')
  // A template that places it itself, and one with nothing left to list.
  assert.equal(followUpText('Hi {name}. Left: {missing} {link}', { name: 'A', step: null, link: 'L', missing: ['Add your subjects'] }), 'Hi A. Left: Add your subjects. L')
  assert.equal(followUpText('Hi {name}', { name: 'A', step: null, link: 'L' }), 'Hi A\n\nL')
})

test('"Paid by customers, waiting for PayPro payout": the name, the file date, the amount', () => {
  assert.equal(OVERVIEW_ITEMS['todo-due'].title, 'Paid by customers, waiting for PayPro payout')
  const now = Date.parse('2026-10-13T10:00:00Z')
  const fresh = payproFileNote('2026-10-12T09:00:00Z', '12 Oct 2026, 2:00 pm (Pakistan time)', now)!
  assert.equal(`${fresh.before}${fresh.date}${fresh.after}`, 'Based on the PayPro file uploaded 12 Oct 2026, 2:00 pm (Pakistan time). Upload a newer file to update.')
  assert.equal(fresh.stale, false)
  assert.equal(fresh.href, '/admin/finance?tab=settlement')
  assert.equal(PAYPRO_FILE_STALE_DAYS, 2)
  assert.equal(payproFileNote('2026-10-11T09:59:00Z', 'x', now)!.stale, true, 'older than 2 days: the date is red')
  assert.equal(payproFileNote('2026-10-11T10:01:00Z', 'x', now)!.stale, false)
  assert.equal(payproFileNote(null, null, now), null, 'no file uploaded: no line')
  assert.equal(waitingOrderLine({ amountText: 'Rs 193', paidText: '8 Oct 2026', ageDays: 5 }), 'Rs 193 · paid 8 Oct 2026 · 5 days')
  assert.equal(waitingOrderLine({ amountText: 'Rs 193', paidText: '12 Oct 2026', ageDays: 1, overdue: false }), 'Rs 193 · paid 12 Oct 2026 · 1 day')
  assert.equal(waitingOrderLine({ amountText: null, paidText: null, ageDays: null }), '')
  // Both screens render the line with the red date.
  for (const f of ['app/admin/page.tsx', 'app/admin/overview/[key]/page.tsx']) {
    assert.ok(read(f).includes("stale ? 'font-bold text-tm-red'"), f)
  }
})

// Keep the type import honest.
const _step: FlowStepKey = 'subjects'
void _step
