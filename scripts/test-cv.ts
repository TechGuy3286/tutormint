/**
 * scripts/test-cv.ts
 *
 * Unit tests for the CV builder's pure halves:
 *   npm run test:cv
 *
 * Uses node:test, like the other test:* scripts — the repo has no test
 * framework and the two things worth pinning here do not depend on the network:
 *
 *   1. The data mapper (lib/cv/model.ts). Sections with no data are omitted,
 *      the contact block obeys its toggle, and — the security-critical one — a
 *      photo URL that is not a public object in our avatar buckets (an
 *      identity-docs object above all, but also a data: URI or a foreign host)
 *      is rejected, so a CNIC or a selfie can never reach a CV.
 *
 *   2. The download gate (lib/cv/access.ts). A free tutor is refused; a
 *      Verified+ tutor is allowed. This is the decision the /api/tutor/cv/pdf
 *      route makes — a refused tutor gets the gate response, an allowed one
 *      gets application/pdf. The PDF bytes themselves are proven by the live
 *      smoke, because @react-pdf/renderer cannot be imported under the tsx test
 *      runner (its hyphenate dependency exports no require/CJS condition; Next's
 *      bundler resolves it fine).
 */

// isOurStorageUrl reads this at call time; set it before the mapper runs so the
// avatar-bucket check has a base to compare against.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toCvModel, type CvRaw } from '../lib/cv/model'
import { canDownloadCv } from '../lib/cv/access'

function raw(over: Partial<CvRaw> = {}): CvRaw {
  return {
    fullName: 'Ali Raza',
    avatarUrl: `${BASE}/storage/v1/object/public/avatars/ali.jpg`,
    city: 'Lahore',
    area: 'DHA Phase 5',
    headline: 'Experienced tutor',
    bio: 'I teach with patience.',
    subjectGroups: [{ level: 'O Levels', subjects: ['Physics', 'Mathematics'] }],
    degrees: ['BSc Physics — LUMS'],
    experienceYears: 5,
    teachingMode: 'both',
    languages: [],
    phone: '03001234567',
    whatsapp: '03001234567',
    email: 'ali@example.com',
    slug: 'ali-raza',
    profileUrl: 'https://www.tutormint.org/tutor/ali-raza',
    completion: 100,
    ...over,
  }
}

// -------------------------------------------------------------- the mapper ---

test('a full profile produces every section', () => {
  const m = toCvModel(raw(), { includeContact: true })
  assert.equal(m.name, 'Ali Raza')
  assert.equal(m.about, 'I teach with patience.')
  assert.equal(m.subjects.length, 1)
  assert.deepEqual(m.subjects[0].subjects, ['Physics', 'Mathematics'])
  assert.equal(m.degrees.length, 1)
  assert.equal(m.experienceYears, 5)
  assert.equal(m.location, 'DHA Phase 5, Lahore')
  assert.ok(m.contact && m.contact.phone === '03001234567')
})

test('empty sections are omitted, never rendered empty', () => {
  const m = toCvModel(
    raw({ bio: '   ', degrees: [], subjectGroups: [], experienceYears: 0, languages: [] }),
    { includeContact: true },
  )
  assert.equal(m.about, null)
  assert.deepEqual(m.subjects, [])
  assert.deepEqual(m.degrees, [])
  assert.equal(m.experienceYears, null)
  assert.deepEqual(m.languages, [])
})

test('the contact toggle removes the contact block', () => {
  assert.equal(toCvModel(raw(), { includeContact: false }).contact, null)
  assert.ok(toCvModel(raw(), { includeContact: true }).contact)
})

test('an included-but-empty contact is still null', () => {
  const m = toCvModel(raw({ phone: null, whatsapp: '  ', email: null }), { includeContact: true })
  assert.equal(m.contact, null)
})

test('the photo is an avatar or nothing — identity-docs and foreign URLs are rejected', () => {
  // A valid avatar in our own bucket is kept.
  assert.equal(
    toCvModel(raw(), { includeContact: true }).photoUrl,
    `${BASE}/storage/v1/object/public/avatars/ali.jpg`,
  )
  assert.equal(
    toCvModel(raw({ avatarUrl: `${BASE}/storage/v1/object/public/tutor-media/x.jpg` }), {
      includeContact: true,
    }).photoUrl,
    `${BASE}/storage/v1/object/public/tutor-media/x.jpg`,
  )
  // An identity-docs object is rejected — a CNIC or selfie can never be a photo.
  assert.equal(
    toCvModel(raw({ avatarUrl: `${BASE}/storage/v1/object/public/identity-docs/cnic-front.jpg` }), {
      includeContact: true,
    }).photoUrl,
    null,
  )
  // A private/signed identity-docs URL, a data: URI and a foreign host are all rejected.
  assert.equal(
    toCvModel(raw({ avatarUrl: `${BASE}/storage/v1/object/sign/identity-docs/selfie.jpg` }), {
      includeContact: true,
    }).photoUrl,
    null,
  )
  assert.equal(
    toCvModel(raw({ avatarUrl: 'data:image/png;base64,iVBORw0KG' }), { includeContact: true }).photoUrl,
    null,
  )
  assert.equal(
    toCvModel(raw({ avatarUrl: 'https://evil.example.com/me.jpg' }), { includeContact: true }).photoUrl,
    null,
  )
  assert.equal(toCvModel(raw({ avatarUrl: null }), { includeContact: true }).photoUrl, null)
})

test('teaching mode is spelled out, headline is top subject · city', () => {
  const m = toCvModel(raw(), { includeContact: true })
  assert.equal(m.teachingMode, 'In person or online')
  assert.equal(m.headline, 'Physics · Lahore')
})

// --------------------------------------------------------------- the gate ---

test('a free tutor cannot download; Verified and above can', () => {
  assert.equal(canDownloadCv({ audience: 'tutor', plan: null, suspended: false }), false)
  assert.equal(canDownloadCv({ audience: 'tutor', plan: 'verified', suspended: false }), true)
  assert.equal(canDownloadCv({ audience: 'tutor', plan: 'premium', suspended: false }), true)
  assert.equal(canDownloadCv({ audience: 'tutor', plan: 'featured', suspended: false }), true)
})

test('a suspended tutor and a parent cannot download', () => {
  assert.equal(canDownloadCv({ audience: 'tutor', plan: 'featured', suspended: true }), false)
  assert.equal(canDownloadCv({ audience: 'parent', plan: 'parent_featured', suspended: false }), false)
})
