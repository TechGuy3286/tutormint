/**
 * scripts/test-selfie-optional.ts — npm run test:selfieoptional
 *
 * Owner, 12 Nov 2026: the selfie becomes optional; the profile photo stays
 * required, with a public "default picture" choice. Invented data only — no
 * network, no database.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { firstRejectedDoc, tutorVerifiedBadgeOk, type DocState as BadgeDoc, type TutorDocs } from '../lib/badgeRule'
import { tutorProfileIndexable, tutorIndexRequirements } from '../lib/seo/indexable'
import { docsReadyForReview, missingDocs, pipelineStage, type DocState } from '../lib/tutorPipelineCore'
import { pipeCardFrom, pipeStatusLine } from '../lib/tutorPipelineCardCore'
import { socialEligible } from '../lib/social/eligibilityCore'
import { directoryBlockers } from '../lib/tutorListingStatus'
import { allDocumentsApproved } from '../lib/documentsApprovedCore'
import { docFactsFrom } from '../lib/tutorFollowUpCore'
import {
  NEW_FLOW_ORDER,
  FLOW_ORDER,
  OPTIONAL_STEPS,
  firstMissingStep,
  missingSteps,
  nextMissingAfter,
  onboardingStepsComplete,
  stepDone,
  type FlowFacts,
} from '../lib/tutorFlow'
import { requiredPercent, tutorRequired } from '../lib/profileRequired'
import { publicPhoto, SHOW_DEFAULT_PICTURE_LABEL, SHOW_MY_PHOTO_LABEL } from '../lib/photoPrivacyCore'
import { ADD_LATER_LABEL, SELFIE_CHECKED_LABEL, showSelfieChecked } from '../lib/selfieOptionalCore'
import HidePhotoToggle from '../components/tutor/HidePhotoToggle'

const doc = (rawStatus: BadgeDoc['rawStatus'], reason = false): BadgeDoc => ({ present: rawStatus !== 'none', rawStatus, reasonPresent: reason })
const docs = (cnic: BadgeDoc, photo: BadgeDoc, selfie: BadgeDoc): TutorDocs => ({ cnic, photo, selfie })

const FULL: FlowFacts = {
  fullName: 'Test Person', gender: 'female', city: 'Lahore', area: 'Gulberg', avatarUrl: 'https://example.invalid/a.jpg', headline: 'Maths tutor', bio: 'I teach.',
  experienceYears: 3, hourlyRate: 8000, jobTypes: ['Home Tutor'], degreesCount: 1, degreeDocCount: 0, degrees: ['BSc'],
  cnicNumber: '11111-1111111-1', cnicImagePath: 'invented/front.jpg', subjectCount: 3, selfieDone: false, availabilityCount: 1,
  phoneVerified: true, whatsapp: '923000000000', feePaid: true, noDegreeYet: false, isSeed: false, isTeamAccount: false,
  isBanned: false, isSuspended: false, underReview: false, verificationStatus: null, imported: false, claimedAt: null,
}

const card = (status: string, hasUpload: boolean) => ({ status: status as 'approved', reason: null, hasUpload })
const pipe = (cnic: [string, boolean], photo: [string, boolean], selfie: [string, boolean], feePaid = false, completion = 90) =>
  pipeCardFrom({
    name: 'Test Person', feePaid, completion, docs: { statuses: { cnic: card(...cnic), profilePic: card(...photo), selfie: card(...selfie) }, oldestUploadAt: null },
    contacts: [], notInterested: false, paused: false, lastActiveAt: null, support: null, nowMs: Date.UTC(2026, 10, 12),
  })

// ------------------------------------------------ Verified and stages ---

test('Verified badge: fee + CNIC + photo, no selfie', () => {
  assert.equal(tutorVerifiedBadgeOk(true, docs(doc('approved'), doc('approved'), doc('none'))), true)
  assert.equal(tutorVerifiedBadgeOk(true, docs(doc('pending'), doc('pending'), doc('none'))), true, 'submitted is enough, as before')
  // A rejected (optional) selfie never pauses the badge or names a re-upload.
  assert.equal(tutorVerifiedBadgeOk(true, docs(doc('approved'), doc('approved'), doc('rejected', true))), true)
  assert.equal(firstRejectedDoc(docs(doc('approved'), doc('approved'), doc('rejected', true))), null)
  // The photo is still required.
  assert.equal(tutorVerifiedBadgeOk(true, docs(doc('approved'), doc('none'), doc('approved'))), false)
  assert.equal(firstRejectedDoc(docs(doc('approved'), doc('rejected'), doc('none')))?.key, 'photo')
})

test('Google indexing: fee + CNIC + photo approved, selfie not needed', () => {
  const base = { feePaid: true, cnicApproved: true, profilePicApproved: true }
  assert.equal(tutorProfileIndexable({ ...base, selfieApproved: false }), true)
  assert.equal(tutorProfileIndexable({ ...base, profilePicApproved: false }), false)
  assert.deepEqual(tutorIndexRequirements(base).map((r) => r.key), ['fee', 'cnic', 'photo'])
})

test('People stages read CNIC + photo only', () => {
  const s = (c: DocState, p: DocState, self: DocState, completion = 90) => pipelineStage({ cnic: c, photo: p, selfie: self, feePaid: false, completion })
  assert.equal(s('approved', 'approved', 'none'), 'approved')
  assert.equal(s('approved', 'approved', 'rejected'), 'approved')
  assert.equal(s('waiting', 'approved', 'none'), 'waiting')
  assert.equal(s('waiting', 'waiting', 'none', 79), 'missing', 'the 80% rule stands')
  assert.equal(s('none', 'approved', 'approved'), 'missing')
  assert.equal(s('rejected', 'approved', 'none'), 'rejected')
  assert.deepEqual(missingDocs({ cnic: 'approved', photo: 'none', selfie: 'none' }), ['Profile photo'], 'never "Selfie" missing')
  // A selfie added later still goes to review (Documents to approve).
  assert.equal(docsReadyForReview({ cnic: 'approved', photo: 'approved', selfie: 'waiting' }, 90), true)
  assert.equal(docsReadyForReview({ cnic: 'approved', photo: 'approved', selfie: 'none' }, 90), false)
  assert.ok(!/Selfie/.test(pipeStatusLine(pipe(['pending', false], ['approved', true], ['none', false]))), 'no "Selfie missing" line')
})

test('status image, social posts, directory and approvals ignore the selfie', () => {
  assert.equal(pipe(['approved', true], ['approved', true], ['none', false], true).badge, true)
  assert.equal(socialEligible({ role: 'tutor', feePaid: true, cnicApproved: true, photoApproved: true, selfieApproved: false }), true)
  assert.deepEqual(directoryBlockers({ role: 'tutor', selfieRejected: true }), [])
  assert.deepEqual(directoryBlockers({ role: 'tutor', photoRejected: true }), ['document_rejected'])
  assert.equal(allDocumentsApproved({ cnic: 'approved', profilePic: 'approved', selfie: 'none' }), true)
  const f = docFactsFrom({ cnic: { status: 'approved' }, profilePic: { status: 'approved' }, selfie: { status: 'rejected', reason: 'dark' } })
  assert.equal(f.docsApproved, true)
  assert.deepEqual(f.rejected, [])
})

test('migration 230: no selfie in the sitemap rule, directory filter or Verified tier', () => {
  const sql = readFileSync('supabase/migrations/230_selfie_optional.sql', 'utf8').replace(/--.*$/gm, '')
  assert.ok(!/selfie/i.test(sql), 'the SQL reads no selfie column')
  assert.ok(/LANGUAGE plpgsql/.test(sql) && /force_custom_plan/.test(sql), 'rank_tutors keeps plpgsql + force_custom_plan')
})

// ------------------------------------------------------- Add later ---

test('"Add later" skips only the selfie step', () => {
  assert.deepEqual([...OPTIONAL_STEPS], ['selfie'])
  // A tutor stuck at the selfie continues on their next visit.
  const stuck = { ...FULL, cnicNumber: null, cnicImagePath: null }
  assert.equal(firstMissingStep(stuck, NEW_FLOW_ORDER), 'cnic_number')
  assert.equal(firstMissingStep(stuck, FLOW_ORDER), 'cnic_number')
  // Walking through, the selfie is offered once, and Add later moves on.
  assert.equal(nextMissingAfter(stuck, 'photo', NEW_FLOW_ORDER), 'selfie')
  assert.equal(nextMissingAfter(stuck, 'selfie', NEW_FLOW_ORDER), 'cnic_number')
  assert.ok(!missingSteps(stuck, NEW_FLOW_ORDER).includes('selfie'))
  assert.equal(onboardingStepsComplete(FULL), true, 'onboarding is done without a selfie')
  // Every other step still holds a tutor back.
  for (const k of NEW_FLOW_ORDER) {
    if (k === 'selfie' || k === 'verify') continue
    assert.ok(!OPTIONAL_STEPS.has(k), `${k} is not skippable`)
  }
  // Only the selfie steps carry the button, in both flows.
  for (const file of ['components/tutor/NewOnboardingFlow.tsx', 'components/tutor/CompleteProfileFlow.tsx']) {
    const src = readFileSync(file, 'utf8')
    assert.equal((src.match(/\{ADD_LATER_LABEL\}/g) ?? []).length, 1, `${file}: one "Add later"`)
    const at = src.indexOf('{ADD_LATER_LABEL}')
    assert.ok(src.slice(src.lastIndexOf('\nfunction ', at), at).includes('function SelfieStep('), `${file}: it is inside SelfieStep`)
  }
  assert.equal(ADD_LATER_LABEL, 'Add later')
})

test('the profile photo is still required', () => {
  const noPhoto = { ...FULL, avatarUrl: null }
  assert.equal(stepDone(noPhoto, 'photo'), false)
  assert.equal(firstMissingStep(noPhoto, NEW_FLOW_ORDER), 'photo')
  assert.equal(onboardingStepsComplete(noPhoto), false)
  assert.ok(tutorRequired(noPhoto).missing.some((m) => m.key === 'photo'))
  const src = readFileSync('components/tutor/NewOnboardingFlow.tsx', 'utf8')
  const photo = src.slice(src.indexOf('function PhotoStep('), src.indexOf('function SelfieStep('))
  assert.ok(/hideButton: !preview, nextDisabled: !preview/.test(photo), 'Next waits for the upload')
  assert.ok(photo.includes('{PHOTO_STEP_EXPLAIN}'))
})

// ------------------------------------------- Show a default picture ---

test('"Show a default picture instead" hides the photo publicly, not from staff', () => {
  assert.equal(publicPhoto('https://example.invalid/a.jpg', { hidden: true }), null)
  assert.equal(publicPhoto('https://example.invalid/a.jpg', { hidden: false }), 'https://example.invalid/a.jpg')
  // The public view blanks the photo on show_avatar = false; staff screens read the row itself.
  const sql = readFileSync('supabase/migrations/230_selfie_optional.sql', 'utf8')
  assert.ok(/COALESCE\(tp\.show_avatar, true\)[^\n]*THEN tp\.avatar_url/.test(sql))
  const html = renderToStaticMarkup(createElement(HidePhotoToggle, { hidden: true, onChange: () => {} }))
  assert.ok(html.includes(SHOW_MY_PHOTO_LABEL) && html.includes(SHOW_DEFAULT_PICTURE_LABEL))
  assert.match(html, new RegExp(`aria-checked="true"[^>]*>[\\s\\S]*?${SHOW_DEFAULT_PICTURE_LABEL}`))
  const shown = renderToStaticMarkup(createElement(HidePhotoToggle, { hidden: false, onChange: () => {} }))
  assert.match(shown, new RegExp(`aria-checked="true"[^>]*>[\\s\\S]*?${SHOW_MY_PHOTO_LABEL}`))
})

// ---------------------------------------------------- Selfie checked ---

test('a later selfie gets "Selfie checked ✓" after approval', () => {
  assert.equal(pipe(['approved', true], ['approved', true], ['pending', true]).selfieChecked, false)
  assert.equal(pipe(['approved', true], ['approved', true], ['approved', true]).selfieChecked, true)
  assert.equal(showSelfieChecked('approved'), true)
  assert.equal(showSelfieChecked('pending'), false)
  assert.equal(SELFIE_CHECKED_LABEL, 'Selfie checked ✓')
  assert.ok(readFileSync('components/tutor/TutorHeaderCard.tsx', 'utf8').includes('{SELFIE_CHECKED_LABEL}'), 'own dashboard')
  assert.ok(readFileSync('components/admin/PipelineActions.tsx', 'utf8').includes('{SELFIE_CHECKED_LABEL}'), 'admin card')
})

// ------------------------------------------------------- completion ---

test('completion never decreases for an existing tutor', () => {
  // The old rule: 17 items, the selfie one of them.
  const keys = ['gender', 'city', 'area', 'subjectCount', 'jobTypes', 'hourlyRate', 'experienceYears', 'degreesCount', 'availabilityCount', 'phoneVerified', 'whatsapp', 'avatarUrl', 'selfieDone', 'cnicNumber', 'cnicImagePath', 'headline', 'feePaid'] as const
  const empty: Partial<FlowFacts> = {
    gender: null, city: null, area: null, subjectCount: 0, jobTypes: [], hourlyRate: null, experienceYears: null, degreesCount: 0,
    availabilityCount: 0, phoneVerified: false, whatsapp: null, avatarUrl: null, selfieDone: false, cnicNumber: null, cnicImagePath: null, headline: null, feePaid: false,
  }
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  for (let n = 0; n < 4000; n++) {
    const f: FlowFacts = { ...FULL }
    for (const k of keys) if (rnd() < 0.4) Object.assign(f, { [k]: (empty as Record<string, unknown>)[k] })
    if (!f.headline) f.bio = null
    const now = tutorRequired(f)
    const oldDone = now.done + (f.selfieDone ? 0 : 0) // an uploaded selfie is still a done item
    const oldTotal = f.selfieDone ? now.total : now.total + 1
    const old = requiredPercent(oldDone, oldTotal)
    assert.ok(now.percent >= old, `never lower: ${old} → ${now.percent}`)
    assert.ok(!now.missing.some((m) => m.key === 'selfie'))
  }
  assert.equal(tutorRequired(FULL).percent, 100, 'complete without a selfie')
  assert.equal(tutorRequired({ ...FULL, selfieDone: true }).percent, 100)
})
