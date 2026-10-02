/**
 * scripts/test-privacy.ts  —  npm run test:privacy
 *
 * PR106-C: document access (selfie/CNIC never served to a non-staff third party),
 * the certificate block showing only LINKED certificates, the watermark pattern,
 * and source guarantees for the Change-decision flow and the bilingual video
 * error. Pure logic + source scans; nothing here touches the DB.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { documentServable } from '../lib/documentAccess'
import { linkedCertificateDocIds, serializeCredential } from '../lib/degrees'
import { watermarkSvg, watermarkMarkCount } from '../lib/watermark'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ---------------------------------- §1.2 selfie/CNIC never to a third party ----

test('a selfie or CNIC is NEVER served to a non-owner non-admin; a degree is', () => {
  const stranger = { isOwner: false, isAdmin: false }
  assert.equal(documentServable('selfie', stranger), false, 'selfie refused to a third party')
  assert.equal(documentServable('cnic', stranger), false, 'CNIC refused to a third party')
  assert.equal(documentServable('degree', stranger), true, 'a degree is shown to any signed-in viewer')
  // The owner sees their own cnic/selfie (Settings); an admin sees everything.
  assert.equal(documentServable('selfie', { isOwner: true, isAdmin: false }), true)
  assert.equal(documentServable('cnic', { isOwner: true, isAdmin: false }), true)
  assert.equal(documentServable('selfie', { isOwner: false, isAdmin: true }), true)
  // An unknown/new kind is private by default.
  assert.equal(documentServable('whatever', stranger), false)
})

// ---------------------------------- §1.1 certificate block = linked only --------

test('the certificate block shows ONLY documents linked to a degree (docId); nothing otherwise', () => {
  // Legacy degrees (plain string / old JSON without a docId) → no certificate.
  assert.deepEqual(linkedCertificateDocIds(['BSc Physics — Punjab University']), [])
  assert.deepEqual(linkedCertificateDocIds(['{"title":"BS CS","fileUrl":"https://x/y.jpg"}']), [], 'a legacy fileUrl is not a linked cert')
  // A degree with a linked certificate → its docId, in degree order.
  const degrees = [
    serializeCredential({ title: 'BSc Physics', docId: 'doc-1' }),
    serializeCredential({ title: 'MSc Maths' }), // no cert
    serializeCredential({ title: 'Old diploma', docId: 'doc-paused', paused: true }), // paused → hidden
    serializeCredential({ title: 'BEd', docId: 'doc-2' }),
  ]
  assert.deepEqual(linkedCertificateDocIds(degrees), ['doc-1', 'doc-2'])
})

// ---------------------------------- §4 watermark visible ------------------------

test('the watermark is a dense, high-contrast repeated TutorMint grid', () => {
  const svg = watermarkSvg(1000, 700)
  assert.ok(svg.includes('TutorMint'), 'the wordmark is present')
  assert.ok(svg.includes('rgba(21,30,107,0.30)'), 'brand-navy fill at 0.30 alpha (not faint white)')
  assert.ok(svg.includes('stroke="rgba(255,255,255,0.55)"'), 'half-opaque white stroke for contrast')
  assert.ok(svg.includes('rotate(-30'), 'drawn on a diagonal')
  // Dense: many repeats, not a single row that rotates off-canvas.
  assert.ok(watermarkMarkCount(1000, 700) >= 40, `dense grid (${watermarkMarkCount(1000, 700)} marks)`)
  // Even a small CNIC photo gets a full pattern.
  assert.ok(watermarkMarkCount(300, 200) >= 12, `small image still covered (${watermarkMarkCount(300, 200)} marks)`)
})

// ---------------------------------- §7 / §9 source guarantees -------------------

test('admin Change-decision reveals the buttons that re-run the same logged review action', () => {
  const src = read('components/admin/TutorDocumentReview.tsx')
  assert.ok(src.includes('Change decision'), 'a decided item offers "Change decision"')
  assert.ok(src.includes('decided && !changing'), 'the active buttons are hidden until the admin chooses to change')
  // The reveal re-runs act(), which POSTs the same document-review route that
  // logs to the member timeline + notifies the tutor (lib/tutorDocuments).
  assert.ok(src.includes("'/api/admin/tutors/document-review'"), 're-decision goes through the logged review route')
})

test('the video upload error carries a plain Urdu line under the English', () => {
  const src = read('components/tutor/VideoUpload.tsx')
  assert.ok(src.includes('lang="ur"'), 'an Urdu line is present')
  assert.ok(src.includes('ویڈیو اپ لوڈ نہیں ہو سکی'), 'plain Urdu, not technical text')
})
