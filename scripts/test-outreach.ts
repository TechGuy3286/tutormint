import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  featuredCutoff,
  featuredMessage,
  funnelSteps,
  isTestName,
  parseUnpaidFilter,
  stuckBreakdown,
  tutorMatchesJob,
  unpaidHelpMessage,
  unpaidRowMatches,
  waLink,
} from '../lib/staffOutreachCore'
import { roleSatisfies, SCREEN_ACCESS } from '../lib/adminAccessCore'

// Owner, 8 Oct 2026 — Unpaid signups, Featured WhatsApp, and the Overview's
// to-do + funnel.

test('test accounts by name: whole-word "test" or exactly "New User"', () => {
  assert.equal(isTestName('Tutor Test 9'), true)
  assert.equal(isTestName('Test Parent (Tariq)'), true)
  assert.equal(isTestName('New User'), true)
  assert.equal(isTestName('Testimony Khan'), false)
  assert.equal(isTestName('Eiman Azeem'), false)
})

test('unpaid filters: stopped at payment / stuck in onboarding / not contacted', () => {
  const pay = { stoppedAt: 'Verification fee', lastContactAt: null }
  const subj = { stoppedAt: 'Subjects', lastContactAt: '2026-10-08T05:00:00Z' }
  assert.equal(unpaidRowMatches(pay, 'payment'), true)
  assert.equal(unpaidRowMatches(subj, 'payment'), false)
  assert.equal(unpaidRowMatches(subj, 'onboarding'), true)
  assert.equal(unpaidRowMatches(pay, 'onboarding'), false)
  assert.equal(unpaidRowMatches(pay, 'uncontacted'), true)
  assert.equal(unpaidRowMatches(subj, 'uncontacted'), false)
  assert.equal(parseUnpaidFilter('nonsense'), 'all')
})

test('the unpaid help message is short, English + Urdu, and names the step', () => {
  const m = unpaidHelpMessage('Eiman', 'Subjects')
  assert.ok(m.includes('Eiman') && m.includes('"Subjects"'))
  assert.ok(/[؀-ۿ]/.test(m))
  assert.ok(!/Rs|199|price/i.test(m))
})

test('the Featured list is cut at 10:00 Pakistan time (05:00 UTC) each day', () => {
  assert.equal(featuredCutoff(new Date('2026-10-08T06:00:00Z')).toISOString(), '2026-10-08T05:00:00.000Z')
  assert.equal(featuredCutoff(new Date('2026-10-08T04:59:00Z')).toISOString(), '2026-10-07T05:00:00.000Z')
})

test('match rule = the alert rule: subject, gender, same city or online cross-city', () => {
  const tutor = { masterIds: [1, 2], city: 'Lahore', jobTypes: ['Home Tutor', 'Online Tutor'], gender: 'female' }
  const job = { masterIds: [2], city: 'Lahore', jobType: 'Home Tutor', genderPreference: null }
  assert.equal(tutorMatchesJob(job, tutor), true)
  assert.equal(tutorMatchesJob({ ...job, masterIds: [9] }, tutor), false, 'no shared subject')
  assert.equal(tutorMatchesJob({ ...job, genderPreference: 'male' }, tutor), false, 'gender preference')
  assert.equal(tutorMatchesJob({ ...job, city: 'Karachi' }, tutor), false, 'home tuition in another city')
  assert.equal(tutorMatchesJob({ ...job, city: 'Karachi', jobType: 'Online Tutor' }, tutor), true, 'online, cross-city')
  assert.equal(tutorMatchesJob({ ...job, city: 'Karachi', jobType: 'Online Tutor' }, { ...tutor, jobTypes: ['Home Tutor'] }), false)
})

test('the Featured message: greeting, up to 5 tuitions with links, Apply line, Urdu, no contact', () => {
  const t = Array.from({ length: 7 }, (_, i) => ({ title: `Tuition ${i + 1}`, area: 'Gulberg', city: 'Lahore', url: `https://www.tutormint.org/tuitions/lahore/t${i + 1}` }))
  const m = featuredMessage('Ayesha', t)
  assert.ok(m.startsWith('Assalam-o-Alaikum Ayesha!'))
  assert.ok(m.includes('5. Tuition 5') && !m.includes('Tuition 6'))
  assert.ok(m.includes('Apply on TutorMint.'))
  assert.ok(/[؀-ۿ]/.test(m))
  assert.ok(!/\b03\d{9}\b|\+92|@/.test(m), 'no phone or email in the message')
  assert.ok(waLink('923001234567', m).startsWith('https://wa.me/923001234567?text='))
})

test('stuck-in-onboarding breakdown by step ("Subjects 3 · Contact 3"), payment excluded', () => {
  const b = stuckBreakdown(['Subjects', 'Contact', 'Subjects', 'Verification fee', 'Contact', 'Subjects', 'Contact', null])
  assert.equal(b.total, 6)
  assert.equal(b.detail, 'Contact 3 · Subjects 3')
})

test('funnel: counts at each step and the % lost between steps', () => {
  const f = funnelSteps([20, 15, 6, 3], ['Signed up', 'Mobile verified', 'Onboarding done', 'Paid'])
  assert.deepEqual(f.map((s) => s.lostPct), [null, 25, 60, 50])
})

test('both tabs: owner, admin, Operations and Tuitions staff', () => {
  for (const k of ['unpaidSignups', 'featuredWhatsapp'] as const) {
    for (const r of ['owner', 'admin', 'operations', 'tuitions_staff'] as const) {
      assert.equal(roleSatisfies(r, SCREEN_ACCESS[k]), true, `${r} ${k}`)
    }
  }
})

test('item 2: the Verified badge carries no Urdu label', () => {
  assert.ok(!readFileSync('components/badges/VerifiedBadge.tsx', 'utf8').includes('تصدیق شدہ'))
})

test('item 3: new tagline, "demo lesson", no academy fee example on /faq', () => {
  assert.ok(readFileSync('components/FooterTagline.tsx', 'utf8').includes('Free to join. No commission. No middleman.'))
  const faq = readFileSync('lib/faqContent.ts', 'utf8')
  assert.ok(!/free demo/i.test(faq))
  assert.ok(!faq.includes('An academy takes half the first month') && !faq.includes('Academy pehle mahine ki aadhi fee'))
  assert.ok(faq.includes('four bands'), 'fee filter bands kept')
  for (const f of ['app/(site)/support/page.tsx', 'app/(site)/terms/page.tsx', 'app/(site)/parent/dashboard/demos/page.tsx']) {
    assert.ok(!/free demo/i.test(readFileSync(f, 'utf8')), f)
  }
})
