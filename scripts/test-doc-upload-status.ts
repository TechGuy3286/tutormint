/**
 * scripts/test-doc-upload-status.ts  —  npm run test:docuploadstatus
 *
 * "Not uploaded" while files exist (owner, 10 Nov 2026). Invented data only;
 * no browser, database or network.
 *   - every upload path sets the status to waiting;
 *   - a file with an empty status shows as waiting, with Approve/Reject;
 *   - the repair never overwrites approved or rejected;
 *   - People stages, the badge and Overview follow the corrected status.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  cnicPatchAfterUpload,
  itemStatusAfterUpload,
  fileWithoutDecision,
  repairPlanFor,
  repairPatch,
  type RepairFacts,
} from '../lib/docUploadStatusCore'
import { tutorCardStatuses, tutorWaiting, type TutorDocFacts } from '../lib/tutorDocQueueCore'
import { tutorDocFactsFromRow, itemState } from '../lib/tutorDocSummaryCore'
import { pipeDocsOf } from '../lib/tutorPipelineCardCore'
import { pipelineStage } from '../lib/tutorPipelineCore'
import { parentCnicState } from '../lib/parentDocsCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const NOW = '2026-11-10T08:00:00.000Z'

// An invented tutor: every file on record, no status set anywhere.
const noStatus: TutorDocFacts = {
  verification_state: 'none',
  cnic_verified_at: null,
  cnic_number: null,
  cnic_image_path: 'invented/cnic-front.jpg',
  avatar_url: 'https://example.invalid/avatar.jpg',
  profile_pic_status: null,
  selfie_status: null,
  hasSelfieFile: true,
  hasCnicFile: true,
}

// ── upload paths set waiting ────────────────────────────────────────────────

test('a new CNIC side sets the status to waiting, with a time', () => {
  assert.deepEqual(cnicPatchAfterUpload({ verification_state: 'none' }, NOW), { verification_state: 'submitted', verification_submitted_at: NOW })
  assert.deepEqual(cnicPatchAfterUpload({ verification_state: null }, NOW), { verification_state: 'submitted', verification_submitted_at: NOW })
  // A new file after a rejection waits again (the rejection was about the old file).
  assert.deepEqual(cnicPatchAfterUpload({ verification_state: 'rejected' }, NOW), { verification_state: 'submitted', verification_submitted_at: NOW })
  // Already waiting: left as it is.
  assert.equal(cnicPatchAfterUpload({ verification_state: 'submitted' }, NOW), null)
  // Approved: never touched (a replacement waits as a re-review).
  assert.equal(cnicPatchAfterUpload({ verification_state: 'approved' }, NOW), null)
  assert.equal(cnicPatchAfterUpload({ verification_state: 'none', cnic_verified_at: NOW }, NOW), null)
})

test('a new photo or selfie sets waiting, except over an approved one', () => {
  assert.equal(itemStatusAfterUpload(null), 'pending')
  assert.equal(itemStatusAfterUpload('none'), 'pending')
  assert.equal(itemStatusAfterUpload('rejected'), 'pending')
  assert.equal(itemStatusAfterUpload('pending'), null)
  assert.equal(itemStatusAfterUpload('approved'), null)
})

test('every member upload path uses the rule', () => {
  const upload = read('app/api/documents/upload/route.ts')
  assert.match(upload, /cnicPatchAfterUpload\(/, 'CNIC upload sets waiting')
  assert.match(upload, /itemStatusAfterUpload\(cur\?\.selfie_status/, 'selfie upload sets waiting')
  const save = read('app/api/profile/save/route.ts')
  assert.match(save, /itemStatusAfterUpload\(cur\?\.profile_pic_status/, 'photo save sets waiting (first photo too)')
  // Tutor Settings no longer writes the photo straight to the table.
  const settings = read('app/(site)/tutor/dashboard/settings/page.tsx')
  assert.doesNotMatch(settings, /from\('tutor_profiles'\)\.update\(\{ avatar_url/)
  assert.match(settings, /postProfileSave\(\{ tutorProfile: \{ avatar_url: publicUrl \} \}\)/)
  // Onboarding photo steps go through the same save route.
  for (const f of ['components/tutor/NewOnboardingFlow.tsx', 'components/tutor/CompleteProfileFlow.tsx']) {
    assert.match(read(f), /tutorProfile: \{ avatar_url: url \}/, f)
  }
  // Staff uploads already set waiting / approved explicitly.
  const media = read('app/api/admin/tutors/media/route.ts')
  assert.match(media, /profile_pic_status: 'pending'/)
  assert.match(media, /verification_state: 'submitted'/)
  assert.match(media, /selfie_status: 'pending'/)
  // The CNIC Submit step still sets waiting.
  assert.match(read('app/api/identity/route.ts'), /verification_state: 'submitted'/)
})

// ── display: a file never reads "Not uploaded" ──────────────────────────────

test('a file with an empty status shows as waiting, with a file to decide on', () => {
  assert.equal(fileWithoutDecision(null, true), true)
  assert.equal(fileWithoutDecision('none', true), true)
  assert.equal(fileWithoutDecision('none', false), false)
  const s = tutorCardStatuses(noStatus)
  for (const item of [s.cnic, s.profilePic, s.selfie]) {
    assert.equal(item.status, 'pending')
    assert.equal(item.hasUpload, true) // the card offers Approve/Reject when hasUpload
    assert.equal(itemState(item), 'waiting')
  }
  assert.deepEqual(tutorWaiting(noStatus), ['CNIC', 'Photo', 'Selfie'])
})

test('CNIC images alone (no path on the profile) still show waiting with Approve/Reject', () => {
  const s = tutorCardStatuses({ ...noStatus, cnic_image_path: null, hasCnicFile: true })
  assert.equal(s.cnic.status, 'pending')
  assert.equal(s.cnic.hasUpload, true)
})

test('no file still reads not uploaded', () => {
  const s = tutorCardStatuses({ ...noStatus, cnic_image_path: null, hasCnicFile: false, avatar_url: null, hasSelfieFile: false })
  assert.equal(s.cnic.status, 'none')
  assert.equal(s.cnic.hasUpload, false)
  assert.equal(itemState(s.profilePic), 'none')
  assert.equal(itemState(s.selfie), 'none')
})

test('approved and rejected keep their status on the card', () => {
  const s = tutorCardStatuses({
    ...noStatus,
    verification_state: 'rejected',
    profile_pic_status: 'approved',
    selfie_status: 'rejected',
  })
  assert.equal(s.cnic.status, 'rejected')
  assert.equal(s.profilePic.status, 'approved')
  assert.equal(s.selfie.status, 'rejected')
})

test('the review card hides Approve/Reject only when there is no file', () => {
  const card = read('components/admin/TutorDocumentReview.tsx')
  assert.match(card, /canReview && !state\.hasUpload/)
  assert.match(card, /canReview && state\.hasUpload/)
})

test('a parent CNIC with images and no status waits', () => {
  const base = { cnic_verified_at: null, address: null, address_status: null, address_verified_at: null, hasCnicFront: true, hasCnicBack: true }
  assert.equal(parentCnicState({ ...base, verification_state: 'none' }).status, 'pending')
  assert.equal(parentCnicState({ ...base, verification_state: null }).status, 'pending')
  assert.equal(parentCnicState({ ...base, verification_state: 'rejected' }).status, 'rejected')
  assert.equal(parentCnicState({ ...base, hasCnicFront: false, hasCnicBack: false, verification_state: 'none' }).status, 'none')
})

// ── repair ───────────────────────────────────────────────────────────────────

const repairBase: RepairFacts = {
  verification_state: 'none',
  cnic_verified_at: null,
  hasCnicFile: true,
  avatar_url: 'https://example.invalid/a.jpg',
  profile_pic_status: null,
  selfie_status: null,
  hasSelfieFile: true,
}

test('the repair sets waiting for files with no status', () => {
  const plan = repairPlanFor(repairBase)
  assert.deepEqual(plan, { cnic: true, photo: true, selfie: true })
  assert.deepEqual(repairPatch(plan, NOW), {
    verification_state: 'submitted',
    verification_submitted_at: NOW,
    profile_pic_status: 'pending',
    selfie_status: 'pending',
  })
})

test('the repair never overwrites approved or rejected (or waiting)', () => {
  for (const vs of ['approved', 'rejected', 'submitted']) {
    assert.equal(repairPlanFor({ ...repairBase, verification_state: vs }).cnic, false, vs)
  }
  assert.equal(repairPlanFor({ ...repairBase, cnic_verified_at: NOW }).cnic, false)
  for (const st of ['approved', 'rejected', 'pending']) {
    const p = repairPlanFor({ ...repairBase, profile_pic_status: st, selfie_status: st })
    assert.equal(p.photo, false, st)
    assert.equal(p.selfie, false, st)
  }
  // No file → nothing to repair.
  assert.deepEqual(repairPlanFor({ ...repairBase, hasCnicFile: false, avatar_url: '', hasSelfieFile: false }), { cnic: false, photo: false, selfie: false })
  // The apply step repeats the rule in its WHERE clauses.
  const script = read('scripts/dataop-repair-doc-status.ts')
  assert.match(script, /\.is\('cnic_verified_at', null\)/)
  assert.match(script, /verification_state\.is\.null,verification_state\.eq\.none/)
  assert.match(script, /\.is\('profile_pic_status', null\)/)
  assert.match(script, /\.is\('selfie_status', null\)/)
  assert.match(script, /process\.argv\.includes\('--apply'\)/)
})

// ── stages follow the corrected status ───────────────────────────────────────

test('People stages, the badge and Overview read the corrected status', () => {
  const statuses = tutorCardStatuses(
    tutorDocFactsFromRow(
      { verification_state: 'none', cnic_number: null, cnic_image_path: 'invented/front.jpg', avatar_url: 'https://example.invalid/a.jpg', profile_pic_status: null, selfie_status: null },
      { hasSelfieFile: true, hasCnicFile: true, hasCnicReview: false, hasSelfieReview: false },
    ),
  )
  const docs = pipeDocsOf({ statuses, oldestUploadAt: null })
  assert.equal(pipelineStage({ ...docs, feePaid: false, completion: 90 }), 'waiting')
  // Under 80% it stays in Documents missing (the existing rule), not "not uploaded".
  assert.equal(pipelineStage({ ...docs, feePaid: false, completion: 50 }), 'missing')
  // Every loader passes the CNIC file fact.
  assert.match(read('lib/tutorDocSummaries.ts'), /hasCnicFile: mine\.some/)
  assert.match(read('lib/tutorDocuments.ts'), /hasCnicFile: cnicDoc/)
  assert.match(read('lib/approvalQueue.ts'), /hasCnicFile: hasCnic\.has/)
})
