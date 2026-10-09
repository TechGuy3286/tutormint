/**
 * scripts/test-approval-queue.ts  —  npm run test:approvalqueue
 *
 * "Documents to approve" matches the review card (owner, 9 Oct 2026):
 * the queue's waiting set is derived from the SAME statuses the card shows,
 * approving every waiting item removes the member, one-sided CNICs stay
 * approvable with a note, and every count reads the one list. Pure logic +
 * source scans. No browser/DB/network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { tutorCardStatuses, tutorWaiting, cnicSideNote, type TutorDocFacts } from '../lib/tutorDocQueueCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const NOW = '2026-10-09T10:00:00.000Z'
const waitingTutor: TutorDocFacts = {
  verification_state: 'submitted',
  cnic_verified_at: null,
  cnic_number: '35202-1234567-1',
  cnic_image_path: 'u/cnic-back.jpg',
  avatar_url: 'https://x/avatar.jpg',
  profile_pic_status: 'pending',
  selfie_status: 'pending',
  hasSelfieFile: true,
  video_status: 'none',
}

// The patches lib/tutorDocuments reviewTutorDocument writes on approve.
function approve(f: TutorDocFacts, item: 'CNIC' | 'Photo' | 'Selfie'): TutorDocFacts {
  if (item === 'CNIC') return { ...f, verification_state: 'approved', cnic_verified_at: NOW }
  if (item === 'Photo') return { ...f, profile_pic_status: 'approved' }
  return { ...f, selfie_status: 'approved' }
}

test('the queue lists exactly what the card shows as pending', () => {
  assert.deepEqual(tutorWaiting(waitingTutor), ['CNIC', 'Photo', 'Selfie'])
  const card = tutorCardStatuses(waitingTutor)
  assert.equal(card.cnic.status, 'pending')
  assert.equal(card.profilePic.status, 'pending')
  assert.equal(card.selfie.status, 'pending')
})

test('approving every waiting item removes the member from the queue', () => {
  let f = waitingTutor
  for (const item of tutorWaiting(f) as ('CNIC' | 'Photo' | 'Selfie')[]) f = approve(f, item)
  assert.deepEqual(tutorWaiting(f), [])
})

test('rejecting also counts as decided', () => {
  const f = { ...waitingTutor, verification_state: 'rejected', profile_pic_status: 'rejected', selfie_status: 'rejected' }
  assert.deepEqual(tutorWaiting(f), [])
})

test('Esha case: CNIC approved, then a side re-uploaded — card Approved, not queued', () => {
  const f: TutorDocFacts = {
    ...waitingTutor,
    verification_state: 'submitted', // the re-upload set it back
    cnic_verified_at: '2026-10-01T18:35:39.897Z', // the approval kept
    profile_pic_status: 'approved',
    selfie_status: 'approved',
  }
  assert.equal(tutorCardStatuses(f).cnic.status, 'approved')
  assert.deepEqual(tutorWaiting(f), [])
})

test('a pending status with no file is not queued (the card offers no decision)', () => {
  const f = { ...waitingTutor, verification_state: 'approved', cnic_verified_at: NOW, avatar_url: null, hasSelfieFile: false }
  assert.deepEqual(tutorWaiting(f), [])
})

test('an uploaded video is waiting', () => {
  const f = { ...waitingTutor, verification_state: 'approved', cnic_verified_at: NOW, profile_pic_status: 'approved', selfie_status: 'approved', video_status: 'uploaded' }
  assert.deepEqual(tutorWaiting(f), ['Video'])
})

test('one-sided CNIC: a note, never a block', () => {
  assert.equal(cnicSideNote(true, false), 'Back side missing')
  assert.equal(cnicSideNote(false, true), 'Front side missing')
  assert.equal(cnicSideNote(true, true), null)
  assert.equal(cnicSideNote(false, false), null)
  // The tutor approve check needs a CNIC image on file, not both sides.
  const src = read('lib/tutorDocuments.ts')
  // (9 Oct 2026: the check moved to lib/docLockCore cnicApprovalProblem, which
  // names the missing number plainly — still a number + an image, never two sides.)
  assert.match(src, /cnicApprovalProblem\(\{ number: current\?\.cnic_number as string \| null, imagePath: current\?\.cnic_image_path as string \| null \}\)/)
  assert.doesNotMatch(src, /cnicBack|hasCnicBack/)
  // Both review cards render the note.
  assert.match(read('components/admin/TutorDocumentReview.tsx'), /cnicSideNote\(/)
  assert.match(read('components/admin/ParentDocumentReview.tsx'), /cnicSideNote\(/)
})

test('card and queue share one rule; every count reads the one list', () => {
  assert.match(read('lib/tutorDocuments.ts'), /tutorCardStatuses\(/)
  const q = read('lib/approvalQueue.ts')
  assert.match(q, /tutorWaiting\(/)
  assert.doesNotMatch(q, /verification_state === 'submitted'/)
  assert.match(q, /export async function approvalNeededCount\(\): Promise<number> \{\s*return \(await build\(\)\)\.length/)
  const layout = read('app/admin/layout.tsx')
  assert.doesNotMatch(layout, /\.eq\('verification_state', 'submitted'\)/)
  assert.match(layout, /'\/admin\/tutors': approvalRows\.filter\(\(r\) => r\.kind === 'tutor'\)\.length/)
  assert.match(layout, /'\/admin\/users': approvals/)
  assert.match(read('lib/overviewItems.ts'), /approvalNeeded\(\)/)
})

test('Overview lists render as cards, one card per row the loader returned', () => {
  const page = read('app/admin/overview/[key]/page.tsx')
  assert.match(page, /const items: GridItem\[\] = list\.rows\.map\(/)
  assert.match(page, /<OverviewCardGrid items=\{items\} \/>/)
  assert.doesNotMatch(page, /\.filter\(/.source === '' ? /x^/ : /items = list\.rows\.filter/)
  const grid = read('components/admin/OverviewCardGrid.tsx')
  assert.match(grid, /grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4/)
  assert.match(grid, /Show more/)
  assert.match(grid, /https:\/\/wa\.me\//)
  assert.match(grid, /tel:\+/)
  assert.match(grid, /> Review/)
  // Member facts are added, never used to drop a row.
  const cards = read('lib/overviewCards.ts')
  assert.match(cards, /never adds or\s*\/\/ drops a row/)
  // Document lists carry a Review link.
  const items = read('lib/overviewItems.ts')
  assert.match(items, /reviewHref: r\.href/)
})
