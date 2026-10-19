/**
 * scripts/test-admin-doc-upload.ts  —  npm run test:admindocupload
 *
 * Staff uploads of a tutor's CNIC / photo / selfie and the CNIC number from the
 * admin edit screen (owner, 19 Oct 2026). Before this, the upload route answered
 * 200 with no documentId and the shared CNIC field showed "Upload failed (200)."
 * although the photo had saved. Pure logic + source scans. No CNIC number,
 * phone or email is printed; the numbers below are made-up test values.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  ADMIN_LOCKED_ERROR,
  adminUploadDecision,
  cnicNumberDecision,
  isMaskedCnic,
  readUploadResponse,
  uploadStatusLabel,
} from '../lib/adminDocUploadCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const FAKE = '00000-0000000-1' // a made-up, valid-format test number

test('the Owner uploads CNIC front and back — saved approved and shown', () => {
  // Not yet approved, and approved + locked: the Owner may always upload.
  for (const approved of [false, true]) {
    const d = adminUploadDecision({ isOwner: true, approved, partOnRecord: approved })
    assert.ok(d.allow)
    if (d.allow) {
      assert.equal(d.saveAs, 'approved')
      assert.equal(d.replacedLocked, approved, 'replacing a locked one counts as the unlock')
    }
  }
  // The route's answer is read as success and carries what to show.
  const r = readUploadResponse(200, { ok: true, documentId: 'doc-1', statusLabel: uploadStatusLabel('approved') })
  assert.deepEqual(r, { ok: true, documentId: 'doc-1', url: null, statusLabel: 'Approved' })
  // The route returns the stored document id and its status.
  const route = read('app/api/admin/tutors/media/route.ts')
  assert.match(route, /documentId,\s*\n\s*url,\s*\n\s*saveAs: decision\.saveAs,\s*\n\s*statusLabel: uploadStatusLabel\(decision\.saveAs\)/)
  assert.match(route, /action: 'document\.owner_replace'/)
  // The field shows the photo in its box once the response is read as success.
  const field = read('components/tutor/CnicCameraField.tsx')
  assert.match(field, /readUploadResponse\(res\.status, json\)/)
  assert.match(field, /setLocalPreview\(/)
  assert.match(field, /setStatusLabel\(read\.statusLabel\)/)
})

test('the old bug: a 200 without a document id is no longer read as "Upload failed (200)"', () => {
  // The old response shape (ok, field, completion) — now explained, not "(200)".
  const r = readUploadResponse(200, { ok: true, field: 'cnic_front', completion: 80 } as never)
  assert.equal(r.ok, false)
  if (!r.ok) assert.doesNotMatch(r.error, /\(200\)/)
})

test('a Partner upload on an approved, locked document is refused with 403 and a message', () => {
  const d = adminUploadDecision({ isOwner: false, approved: true, partOnRecord: true })
  assert.deepEqual(d, { allow: false, status: 403, error: ADMIN_LOCKED_ERROR })
  assert.match(ADMIN_LOCKED_ERROR, /Only the Owner can replace it/)
  // Not approved: allowed, and it waits for the Owner.
  const open = adminUploadDecision({ isOwner: false, approved: false, partOnRecord: false })
  assert.ok(open.allow && open.saveAs === 'pending')
  // A side missing from an approved CNIC waits as a review upload.
  const side = adminUploadDecision({ isOwner: false, approved: true, partOnRecord: false })
  assert.ok(side.allow && side.saveAs === 'review')
  assert.equal(uploadStatusLabel('pending'), 'Waiting for approval')
  // The screen surfaces the message.
  const r = readUploadResponse(403, { error: ADMIN_LOCKED_ERROR })
  assert.deepEqual(r, { ok: false, error: ADMIN_LOCKED_ERROR })
})

test('a masked CNIC value never overwrites the real number', () => {
  for (const v of ['XXXXX-XXXXXXX-4', '42101-*****-2', 'xxxxx-xxxxxxx-9', '•••••-•••••••-1']) {
    assert.ok(isMaskedCnic(v), v)
    for (const isOwner of [true, false]) {
      assert.deepEqual(cnicNumberDecision({ input: v, isOwner, cnicApproved: true }), { action: 'keep' })
    }
  }
  assert.deepEqual(cnicNumberDecision({ input: '', isOwner: true, cnicApproved: false }), { action: 'keep' })
  assert.deepEqual(cnicNumberDecision({ input: FAKE, isOwner: true, cnicApproved: true }), { action: 'save' })
  assert.equal(cnicNumberDecision({ input: FAKE, isOwner: false, cnicApproved: true }).action, 'refuse')
  assert.deepEqual(cnicNumberDecision({ input: FAKE, isOwner: false, cnicApproved: false }), { action: 'save' })
  const bad = cnicNumberDecision({ input: '12345', isOwner: true, cnicApproved: false })
  assert.ok(bad.action === 'refuse' && bad.status === 400)
  // The route keeps the stored number on 'keep' before any write; the screen
  // leaves the box empty when a number is on file and never sends the mask.
  const edit = read('app/api/admin/tutors/edit/route.ts')
  const at = edit.indexOf("if (action === 'set-cnic-number') {")
  const keep = edit.indexOf("if (numberDecision.action === 'keep') return NextResponse.json({ ok: true, kept: true })", at)
  const write = edit.indexOf(".update({ cnic_number: formatted })", at)
  assert.ok(at > 0 && keep > at && write > keep)
  const cap = read('components/identity/CnicCapture.tsx')
  assert.match(cap, /const keepsStored = !!numberOnFile && normaliseCnic\(number\)\.length === 0/)
  assert.doesNotMatch(cap, /setNumber\(numberOnFile/)
})

test('a refusal never comes back as 200', () => {
  for (const f of ['app/api/admin/tutors/media/route.ts', 'app/api/admin/tutors/edit/route.ts']) {
    const s = read(f)
    const calls = s.match(/NextResponse\.json\(\{ error[^\n]*/g) ?? []
    assert.ok(calls.length > 0, f)
    for (const c of calls) assert.match(c, /status: (4\d\d|5\d\d|gate\.status|decision\.status|numberDecision\.status)/, `${f}: ${c}`)
  }
  // Every decision refusal carries a 4xx.
  const d = adminUploadDecision({ isOwner: false, approved: true, partOnRecord: true })
  assert.ok(!d.allow && d.status >= 400 && d.status < 500)
  const n = cnicNumberDecision({ input: FAKE, isOwner: false, cnicApproved: true })
  assert.ok(n.action === 'refuse' && n.status >= 400 && n.status < 500)
  // A 2xx carrying an error is never success on the screen.
  assert.equal(readUploadResponse(200, { error: 'refused' }).ok, false)
})

test('approving stays Owner-only; the tutor’s own upload path is unchanged', () => {
  const review = read('app/api/admin/tutors/document-review/route.ts')
  assert.match(review, /refuseUnlessOwnerApproval\(\s*gate\.actor/)
  const member = read('app/api/documents/upload/route.ts')
  assert.match(member, /decideUpload\(user\.id, kind, labelStr\)/)
  assert.match(member, /status: lockCtx\.decision\.status/)
  assert.match(member, /documentId: result\.doc\.id/)
})
