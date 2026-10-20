/**
 * scripts/test-doc-summary.ts  —  npm run test:docsummary
 *
 * The "Documents" row on admin tutor cards (owner, 19 Oct 2026): each combined
 * status and its precedence, an optional video never worsening it, the card
 * using the member page's own statuses, the filter counts matching the list,
 * and the duplicate "Joined" line removed. Pure logic + source scans.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { tutorCardStatuses, type CardDocState, type CardStatuses } from '../lib/tutorDocQueueCore'
import {
  DOC_FILTERS,
  applyDocFilter,
  docFilterCounts,
  docFilterLabel,
  docSummary,
  tutorDocFactsFromRow,
  withoutJoined,
  type DocSummaryKind,
} from '../lib/tutorDocSummaryCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const A: CardDocState = { status: 'approved', reason: null, hasUpload: true }
const W: CardDocState = { status: 'pending', reason: null, hasUpload: true }
const R: CardDocState = { status: 'rejected', reason: 'Blurry', hasUpload: true }
const N: CardDocState = { status: 'none', reason: null, hasUpload: false }
const S = (cnic: CardDocState, profilePic: CardDocState, selfie: CardDocState): CardStatuses => ({ cnic, profilePic, selfie })

test('each combined status', () => {
  assert.equal(docSummary(S(A, A, A)).label, '✅ Approved')
  assert.equal(docSummary(S(W, W, N)).label, '🟡 Waiting for approval (2)')
  assert.equal(docSummary(S(R, A, A)).label, '🔴 Rejected — CNIC')
  assert.equal(docSummary(S(A, A, N)).label, '🟠 2 of 3 approved')
  assert.equal(docSummary(S(N, N, N)).label, '⚪ Not uploaded')
})

test('precedence: Rejected, Waiting, Partly approved, Not uploaded', () => {
  assert.equal(docSummary(S(R, W, A)).kind, 'rejected')
  assert.equal(docSummary(S(A, R, R)).label, '🔴 Rejected — Photo, Selfie')
  assert.equal(docSummary(S(W, A, N)).kind, 'waiting')
  assert.equal(docSummary(S(A, N, N)).kind, 'partial')
  // A Pending status with no file on file is not uploaded (the queue's rule).
  assert.equal(docSummary(S({ status: 'pending', reason: null, hasUpload: false }, N, N)).kind, 'none')
})

test('an optional video never affects the combined status', () => {
  for (const v of [null, 'none', 'uploaded', 'rejected', 'approved']) {
    assert.equal(docSummary(S(A, A, A), v).kind, 'approved', `video ${v}`)
    assert.equal(docSummary(S(N, N, N), v).kind, 'none', `video ${v}`)
  }
  assert.equal(docSummary(S(A, W, N), null).breakdown, 'CNIC ✅ · Photo 🟡 · Selfie ⚪ · Video —')
  assert.equal(docSummary(S(A, A, A), 'uploaded').breakdown, 'CNIC ✅ · Photo ✅ · Selfie ✅ · Video 🟡')
})

test('the card reads the member page statuses for the same tutor', () => {
  // Both loaders map the same stored row through tutorDocFactsFromRow then
  // tutorCardStatuses — so for the same row the card and the member page agree.
  const row = {
    verification_state: 'approved',
    cnic_verified_at: '2026-10-01T00:00:00Z',
    cnic_number: '00000-0000000-0',
    cnic_image_path: 'x/front.jpg',
    avatar_url: 'https://x/a.jpg',
    profile_pic_status: 'approved',
    profile_pic_rereview_at: '2026-10-10T00:00:00Z',
    selfie_status: 'approved',
  }
  const docs = { hasSelfieFile: true, hasCnicReview: false, hasSelfieReview: true }
  const page = tutorCardStatuses(tutorDocFactsFromRow(row, docs))
  assert.equal(docSummary(page).kind, 'waiting')
  assert.equal(docSummary(page).waitingCount, 2) // changed photo + selfie re-upload
  // Source: both loaders use the shared mapping.
  for (const f of ['lib/tutorDocuments.ts', 'lib/tutorDocSummaries.ts']) {
    const src = read(f)
    assert.match(src, /tutorDocFactsFromRow\(/, f)
    assert.match(src, /tutorCardStatuses\(/, f)
  }
  // One batched load per page, never a read per card.
  const page2 = read('app/admin/overview/[key]/page.tsx')
  assert.match(page2, /loadTutorDocSummaries\(tutorIds\)/)
  assert.doesNotMatch(read('components/admin/OverviewCardGrid.tsx'), /loadDocumentStatuses|fetch\(/)
})

test('filter counts match the list, with search and oldest-first waiting', () => {
  const mk = (id: string, kind: DocSummaryKind | null, at: string | null = null) => ({
    id,
    docs: kind ? { kind, oldestUploadAt: at } : null,
  })
  const items = [
    mk('a', 'approved'),
    mk('b', 'waiting', '2026-10-05'),
    mk('c', 'waiting', '2026-10-01'),
    mk('d', 'rejected'),
    mk('e', 'partial'),
    mk('f', 'none'),
    mk('g', null),
    mk('h', 'waiting', null),
  ]
  const counts = docFilterCounts(items)
  for (const f of DOC_FILTERS) assert.equal(counts[f], applyDocFilter(items, f).length, f)
  assert.equal(counts.all, items.length)
  assert.deepEqual(applyDocFilter(items, 'waiting').map((i) => i.id), ['c', 'b', 'h'])
  // Search narrows first, then the chip — still consistent.
  const searched = items.filter((i) => i.id !== 'c')
  assert.equal(docFilterCounts(searched).waiting, 2)
  assert.equal(docFilterLabel('waiting', true), 'Waiting for my approval')
  assert.equal(docFilterLabel('waiting', false), 'Waiting for approval')
})

test('the duplicate "Joined" line is gone', () => {
  assert.equal(withoutJoined('Joined 3 Oct 2026'), null)
  // The step shows once, as the card's own "Next:" line (owner, 20 Oct 2026).
  assert.equal(withoutJoined('Stopped at Gender · joined 3 Oct 2026 · Still to do: CNIC'), null)
  assert.equal(withoutJoined('Joined 3 Oct 2026, 10:00 · stopped at payment'), null)
  assert.equal(withoutJoined('Joined 3 Oct 2026 · Rs 199'), 'Rs 199')
  assert.match(read('components/admin/OverviewCardGrid.tsx'), /withoutJoined\(it\.detail\)/)
})
