/**
 * scripts/test-profile-required.ts — npm run test:profilerequired
 *
 * Owner, 4 Nov 2026: profile completion tutors understand.
 *  - ONE shared rule (lib/profileRequired): email and the intro video never
 *    count, for tutors or parents; every surface reads it.
 *  - The "what's missing" line and its buttons, and the 100% state.
 *  - The "profile not finished" follow-up message names the exact items.
 *  - Every working staff role (Backend Support included, and any role added
 *    later) appears on Team activity.
 * Pure — no network, no database.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { FlowFacts } from '../lib/tutorFlow'
import {
  NEVER_COUNTED,
  TUTOR_CARD_ITEMS,
  cardStepCount,
  completionLine,
  missingPhrase,
  parentLineItems,
  parentRequiredItems,
  requiredPercent,
  summariseRequired,
  tutorItemHref,
  tutorLineItems,
  tutorRequired,
} from '../lib/profileRequired'
import { calculateParentCompletion, calculateTutorCompletion, completionInputToFacts, tutorCompletionFromFacts } from '../lib/profileChecklist'
import { missingSummary } from '../lib/onboarding/missingItems'
import { fillFollowUp, MISSING_ITEMS_TEMPLATES, FU_NEW_DEFAULTS, FU_REUSED_DEFAULTS, FU_PLACEHOLDERS } from '../lib/followUpTemplatesCore'
import { POSTING_STAFF_ROLES, STAFF_ROLES, TEAM_MANAGER_ROLES, WORKING_STAFF_ROLES, SCREEN_ACCESS } from '../lib/adminAccessCore'
import { PARTICIPANT_ROLES, isActiveParticipant } from '../lib/staffSignupsCore'
import CompletionLine from '../components/profile/CompletionLine'

const read = (p: string) => readFileSync(p, 'utf8')

const FULL: FlowFacts = {
  fullName: 'Ayesha', gender: 'female', city: 'Lahore', area: 'Gulberg', avatarUrl: 'https://x/a.jpg', headline: 'Maths tutor', bio: 'I teach.',
  experienceYears: 3, hourlyRate: 8000, jobTypes: ['Home Tutor'], degreesCount: 1, degreeDocCount: 0, degrees: ['BSc'],
  cnicNumber: '35202-1234567-1', cnicImagePath: 'y', subjectCount: 3, selfieDone: true, availabilityCount: 1,
  phoneVerified: true, whatsapp: '923001234567', feePaid: true, noDegreeYet: false, isSeed: false, isTeamAccount: false,
  isBanned: false, isSuspended: false, underReview: false, verificationStatus: null, imported: false, claimedAt: null,
}

// ---------------------------------------------------------------- the rule

test('email and the intro video are never items, for tutors or parents', () => {
  const t = tutorRequired(FULL)
  const p = parentRequiredItems({ fullName: 'A', city: 'Lahore', phoneVerified: true })
  for (const k of NEVER_COUNTED) {
    assert.ok(!t.items.some((i) => i.key === k || /email|video/i.test(i.label)), `tutor has no ${k} item`)
    assert.ok(!p.some((i) => i.key === k || /email|video/i.test(i.label)), `parent has no ${k} item`)
  }
  assert.equal(t.percent, 100)
  // A tutor with NO email and NO video, everything else done, is 100% everywhere.
  const viaInput = calculateTutorCompletion({
    profile: { full_name: 'A', city: 'Lahore', cnic_number: '1', phone_verified_at: 'x', whatsapp: '92300', email: '923001234567@users.tutormint.org' },
    tutorProfile: { gender: 'm', area: 'G', avatar_url: 'u', headline: 'h', bio: 'b', experience_years: 2, hourly_rate_pkr: 5000, job_types: ['Home Tutor'], degrees: ['BA'], video_youtube_id: null },
    subjectCount: 1, feePaid: true, availabilityCount: 1, selfieDone: true, cnicPhotosDone: true,
  })
  assert.equal(viaInput.percent, 100)
  assert.equal(calculateParentCompletion({ profile: { full_name: 'A', city: 'L', phone_verified_at: 'x', email: null } }).percent, 100)
})

test('"New to teaching" (0 years) counts as answered', () => {
  assert.equal(tutorRequired({ ...FULL, experienceYears: 0 }).percent, 100)
  assert.equal(tutorRequired({ ...FULL, experienceYears: null }).missing[0].key, 'experience')
})

test('the percentage: 100 only when nothing is missing, never rounded up', () => {
  assert.equal(requiredPercent(16, 17), 94)
  assert.equal(requiredPercent(17, 17), 100)
  assert.equal(requiredPercent(0, 17), 0)
  const one = tutorRequired({ ...FULL, availabilityCount: 0 })
  assert.equal(one.percent, 94)
  assert.deepEqual(one.missing.map((m) => m.key), ['availability'])
})

test('one shared calculation: checklist, onboarding list and server agree', () => {
  for (const patch of [{}, { availabilityCount: 0 }, { headline: null, bio: null }, { whatsapp: null, feePaid: false }]) {
    const f = { ...FULL, ...patch }
    const a = tutorRequired(f)
    const b = missingSummary(f)
    const c = tutorCompletionFromFacts(f)
    assert.equal(a.percent, b.percent)
    assert.equal(a.percent, c.percent)
    assert.deepEqual(a.missing.map((m) => m.key), c.missing.map((m) => m.key))
  }
  // The input form reaches the same facts.
  assert.equal(completionInputToFacts({ tutorProfile: { experience_years: 0 } }).experienceYears, 0)
  // Every place the stored or shown percentage is computed reads the rule.
  assert.ok(read('lib/completion.ts').includes('tutorCompletionFromFacts(facts)'))
  assert.ok(read('lib/completion.ts').includes('flowFactsByTutor('))
  assert.ok(read('lib/adminQueues.ts').includes('tutorCompletionFromFacts(facts)'))
  assert.ok(read('lib/onboarding/missingItems.ts').includes('summariseRequired(onboardingItems(f))'))
  assert.ok(read('lib/profileChecklist.ts').includes('requiredPercent(done, required.length)'))
  assert.ok(read('lib/staffOutreach.ts').includes("stopped.get(p.id as string)?.percent"))
  assert.ok(read('app/api/profile/completion/route.ts').includes('tutorRequired(facts)'))
  assert.ok(read('app/(site)/tutor/dashboard/page.tsx').includes('whatsMissing?.summary.percent'))
  // No surface carries its own percentage arithmetic any more.
  assert.ok(!read('lib/onboarding/missingItems.ts').includes('Math.round((done / items.length)'))
})

// ---------------------------------------------------------------- the line

test('the line names the exact items; 100% says complete', () => {
  const avail = tutorRequired({ ...FULL, availabilityCount: 0 })
  assert.equal(completionLine(avail.percent, avail.missing), '94% — add your availability to reach 100%')
  const two = tutorRequired({ ...FULL, availabilityCount: 0, headline: null })
  assert.equal(completionLine(two.percent, two.missing), '88% — add your availability and write your tagline and bio to reach 100%')
  assert.equal(completionLine(100, []), '100% — your profile is complete')
  assert.equal(missingPhrase(['A one', 'B two', 'C three', 'D four']), 'a one, b two, c three and 1 more thing')
})

test('each button opens the card that fixes it', () => {
  const s = tutorRequired({ ...FULL, availabilityCount: 0, gender: null, feePaid: false, whatsapp: null })
  const items = tutorLineItems(s.missing)
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
  assert.equal(byKey.availability.href, '/tutor/dashboard/settings?open=availability')
  assert.equal(byKey.availability.card, 'availability')
  assert.equal(byKey.whatsapp.href, '/tutor/dashboard/settings?open=details')
  assert.equal(byKey.gender.href, '/tutor/complete-profile?step=gender') // no Edit Profile card
  assert.equal(byKey.verify.href, '/pay/choose?plan=verified')
  assert.equal(tutorItemHref({ key: 'photo', card: 'profilePic', step: 'photo' }), '/tutor/dashboard/settings?open=profilePic')
  // Parent buttons open the parent Edit Profile tile.
  const p = summariseRequired(parentRequiredItems({ fullName: 'A', city: null, phoneVerified: false }))
  assert.deepEqual(parentLineItems(p.missing).map((i) => i.href), ['/parent/dashboard/settings?open=details', '/parent/dashboard/settings?open=mobile'])
  // Every Edit Profile card a button names exists on the page.
  const page = read('app/(site)/tutor/dashboard/settings/page.tsx')
  for (const card of Object.keys(TUTOR_CARD_ITEMS)) assert.ok(page.includes(`key: '${card}'`), `card ${card} exists`)
  assert.ok(page.includes(".get('open')"), 'Edit Profile honours ?open=')
  assert.ok(read('app/(site)/parent/dashboard/settings/SettingsClient.tsx').includes(".get('open')"))
})

test('the line renders buttons under 100% and a tick at 100%', () => {
  const s = tutorRequired({ ...FULL, availabilityCount: 0 })
  const html = renderToStaticMarkup(createElement(CompletionLine, { percent: s.percent, missing: tutorLineItems(s.missing) }))
  assert.ok(html.includes('94% — add your availability to reach 100%'))
  assert.ok(html.includes('href="/tutor/dashboard/settings?open=availability"'))
  assert.ok(html.includes('>Availability'))
  const done = renderToStaticMarkup(createElement(CompletionLine, { percent: 100, missing: [] }))
  assert.ok(done.includes('100% — your profile is complete'))
  assert.ok(done.includes('<svg'), 'a tick')
  assert.ok(!done.includes('<a '), 'no buttons at 100%')
  // On the dashboards and the top of Edit Profile.
  for (const f of ['app/(site)/tutor/dashboard/page.tsx', 'app/(site)/tutor/dashboard/settings/page.tsx', 'app/(site)/parent/dashboard/page.tsx', 'app/(site)/parent/dashboard/settings/SettingsClient.tsx']) {
    assert.ok(read(f).includes('<CompletionLine'), f)
  }
})

test('Edit Profile step counts come from the rule; optional cards are left out', () => {
  assert.deepEqual(cardStepCount(['mobile', 'cnic', 'profilePic', 'selfie', 'subjects', 'location'], []), { done: 6, total: 6 })
  assert.deepEqual(cardStepCount(['about', 'availability', 'certifications', 'email'], ['availability']), { done: 1, total: 2 })
  assert.equal(TUTOR_CARD_ITEMS.email, undefined)
  assert.equal(TUTOR_CARD_ITEMS.certifications, undefined)
})

// ---------------------------------------------------------------- the message

const V = {
  firstName: 'Ayesha', completion: 88, nextStep: 'add your availability',
  continueLink: 'https://www.tutormint.org/tutor/dashboard', payLink: 'https://www.tutormint.org/pay/choose',
  supportWhatsapp: '0321 5872222', missingItems: ['Add your availability', 'Write your tagline and bio'],
}

test('"profile not finished" messages name the exact missing items', () => {
  assert.ok(FU_PLACEHOLDERS.includes('missing_items'))
  for (const key of MISSING_ITEMS_TEMPLATES) {
    const body = key === 'fu_paid_unfinished' ? FU_NEW_DEFAULTS.fu_paid_unfinished : FU_REUSED_DEFAULTS.profile_completion_nudge
    const text = fillFollowUp(body, V, 'continue', key)
    assert.ok(text.includes('Still to do: Add your availability and write your tagline and bio.'), key)
    assert.equal(text.match(/Still to do/g)?.length, 1)
  }
  // With the placeholder, filled in place and no extra line.
  const own = fillFollowUp('Hi {first_name}, please {missing_items}.\n{continue_link}', V, 'continue', 'fu_paid_unfinished')
  assert.ok(own.startsWith('Hi Ayesha, please add your availability and write your tagline and bio.'))
  assert.ok(!own.includes('Still to do'))
  // The line goes before the link's lead-in, not between it and the link.
  const t = fillFollowUp(FU_NEW_DEFAULTS.fu_paid_unfinished, V, 'continue', 'fu_paid_unfinished')
  assert.ok(t.indexOf('Still to do') < t.indexOf('You can finish it here:'))
  // Other templates are untouched.
  assert.ok(!fillFollowUp(FU_NEW_DEFAULTS.fu_no_cnic, V, 'continue', 'fu_no_cnic').includes('Still to do'))
  // The live sender passes the shared list.
  assert.ok(read('lib/tutorFollowUps.ts').includes('missingItems: r.missing'))
})

// ---------------------------------------------------------------- staff roles

test('every working staff role appears on Team activity, and a new role would too', () => {
  assert.deepEqual([...WORKING_STAFF_ROLES].sort(), STAFF_ROLES.filter((r) => !TEAM_MANAGER_ROLES.includes(r)).sort())
  for (const r of WORKING_STAFF_ROLES) {
    assert.ok(PARTICIPANT_ROLES.includes(r), `${r} earns sign-up credit`)
    assert.ok(isActiveParticipant({ adminRole: r, suspended: false }))
  }
  assert.ok(PARTICIPANT_ROLES.includes('backend_support'))
  assert.ok(POSTING_STAFF_ROLES.includes('backend_support'), 'Backend Support is a Tuitions posted row')
  for (const r of POSTING_STAFF_ROLES) assert.ok((SCREEN_ACCESS.jobsPost as readonly string[]).includes(r))
  assert.ok(!PARTICIPANT_ROLES.includes('owner') && !PARTICIPANT_ROLES.includes('partner'))
  // Backend Support opens Team activity (her own Paid sign-ups row, Tuitions posted).
  assert.ok((SCREEN_ACCESS.tuitionPosting as readonly string[]).includes('backend_support'))
  // No hand-written role list on the boards.
  const posting = read('lib/tuitionPosting.ts')
  assert.ok(posting.includes('new Set<string>(POSTING_STAFF_ROLES)'))
  assert.ok(!/POSTING_ROLES = new Set\(\[/.test(posting))
  assert.ok(read('lib/staffSignupsCore.ts').includes('PARTICIPANT_ROLES: readonly string[] = WORKING_STAFF_ROLES'))
})
