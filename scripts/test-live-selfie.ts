// npm run test:liveselfie — the selfie is a live camera photo, and a selfie that
// looks like the profile picture warns staff (owner, 21 Oct 2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

import {
  FRESH_PHOTO_MS,
  SELFIE_HELPER,
  SELFIE_NO_CAMERA,
  isFreshPhoto,
  isPhoneDevice,
  selfieMode,
} from '../lib/liveSelfieCore'
import { HASH_H, HASH_W, SELFIE_MATCH_WARNING, dhashFromGrey, hammingHex, hashesLookSame, selfieMatchesPhoto } from '../lib/photoHashCore'

const read = (f: string) => readFileSync(f, 'utf8')
const COMPONENT = read('components/tutor/LiveSelfieCapture.tsx')

test('the selfie step offers no file upload: one camera input, no gallery', () => {
  const inputs = COMPONENT.match(/<input\b[^>]*>/g) ?? []
  assert.equal(inputs.length, 1, 'exactly one file input')
  assert.ok(/capture="user"/.test(inputs[0]), 'it opens the front camera')
  const code = COMPONENT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  assert.doesNotMatch(code, /gallery|Choose from|Choose another|Upload a/i)
  assert.ok(COMPONENT.includes('getUserMedia'), 'computers get a live webcam preview')
  for (const label of ['Take photo', 'Retake', 'Use this photo']) assert.ok(COMPONENT.includes(label), label)
  assert.equal(SELFIE_HELPER, 'Take a clear photo of your face now — no filters, no old photos.')
})

test('every selfie surface uses the camera-only capture', () => {
  const surfaces: [string, RegExp][] = [
    ['components/tutor/NewOnboardingFlow.tsx', /function SelfieStep[\s\S]*?\n\}\n/],
    ['components/tutor/CompleteProfileFlow.tsx', /function SelfieStep[\s\S]*?\n\}\n/],
    ['app/(site)/tutor/dashboard/settings/page.tsx', /key: 'selfie',[\s\S]*?key: 'subjects'/],
    ['components/tutor/IdentityDocsStatus.tsx', /export default function IdentityDocsStatus[\s\S]*$/],
  ]
  for (const [f, re] of surfaces) {
    const block = read(f).match(re)?.[0] ?? ''
    assert.ok(block.includes('<LiveSelfieCapture'), `${f} uses LiveSelfieCapture`)
    assert.doesNotMatch(block, /PhotoCaptureTile|CaptureButtons|type="file"/, `${f} has no other picker for the selfie`)
  }
})

test('no camera, or permission denied: the phone message, the link and a QR — no upload fallback', () => {
  assert.equal(SELFIE_NO_CAMERA, 'Please open this step on your phone to take your selfie')
  assert.equal(selfieMode({ phone: false, mediaDevices: false }), 'no_camera')
  assert.equal(selfieMode({ phone: false, mediaDevices: true }), 'webcam')
  assert.equal(selfieMode({ phone: true, mediaDevices: false }), 'phone')
  const noCam = COMPONENT.match(/function NoCamera[\s\S]*$/)?.[0] ?? ''
  assert.ok(noCam.includes('SELFIE_NO_CAMERA') && noCam.includes('qrcode') && noCam.includes('window.location.href'))
  assert.doesNotMatch(noCam, /<input/)
  // A refused camera switches to the no-camera screen, never to a picker.
  assert.ok(/catch \{[\s\S]*?onUnavailable\(\)/.test(COMPONENT))
})

test('phones and old photos', () => {
  assert.equal(isPhoneDevice('Mozilla/5.0 (Linux; Android 14) Mobile', true), true)
  assert.equal(isPhoneDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', false), false)
  const now = Date.now()
  assert.equal(isFreshPhoto(now - 60_000, now), true)
  assert.equal(isFreshPhoto(now - FRESH_PHOTO_MS - 1, now), false, 'an old gallery photo is refused')
})

async function dhashOf(buf: Buffer): Promise<string> {
  const grey = await sharp(buf).rotate().resize(HASH_W, HASH_H, { fit: 'fill' }).grayscale().raw().toBuffer()
  return dhashFromGrey(grey)
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/** A "portrait": a light face disc on a dark ground, at (cx, cy). */
function portrait(size: number, cx: number, cy: number, bg: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="rgb(${bg},${bg},${bg + 20})"/><circle cx="${cx}" cy="${cy}" r="${size / 4}" fill="rgb(230,200,170)"/><rect x="${size * 0.1}" y="${size * 0.75}" width="${size * 0.8}" height="${size * 0.25}" fill="rgb(40,60,120)"/></svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
}

test('the duplicate-photo warning: same file or a near-identical image matches; another photo does not', async () => {
  const profile = await portrait(800, 400, 320, 30)
  const resaved = await sharp(profile).resize(600).jpeg({ quality: 60 }).toBuffer()
  const other = await portrait(800, 250, 500, 200)
  const [hp, hr, ho] = await Promise.all([dhashOf(profile), dhashOf(resaved), dhashOf(other)])
  assert.ok(hashesLookSame(hp, hr), `re-saved copy differs by ${hammingHex(hp, hr)} bits`)
  assert.equal(hashesLookSame(hp, ho), false, `another photo differs by ${hammingHex(hp, ho)} bits`)
  assert.equal(selfieMatchesPhoto({ sha256: sha(profile), dhash: ho }, [{ sha256: sha(profile), dhash: hp }]), true, 'the same file')
  assert.equal(selfieMatchesPhoto({ sha256: sha(resaved), dhash: hr }, [{ sha256: sha(profile), dhash: hp }]), true, 'near-identical')
  assert.equal(selfieMatchesPhoto({ sha256: sha(other), dhash: ho }, [{ sha256: sha(profile), dhash: hp }]), false)
  assert.equal(hammingHex('zz', hp), 64)
})

test('the warning is recorded at upload and shown on the three staff screens', () => {
  assert.equal(SELFIE_MATCH_WARNING, 'Looks the same as the profile picture — check it’s a live selfie.')
  assert.ok(read('app/api/documents/upload/route.ts').includes('checkSelfieAgainstProfilePhoto('))
  assert.ok(read('app/api/admin/tutors/media/route.ts').includes('checkSelfieAgainstProfilePhoto('))
  assert.ok(read('components/admin/TutorDocumentReview.tsx').includes('<SelfieMatchWarning'))
  assert.ok(read('app/admin/users/[id]/page.tsx').includes('selfieLooksLikePhoto='))
  assert.ok(read('app/admin/tutors/[id]/page.tsx').includes('selfieLooksLikePhoto='))
  assert.ok(read('components/admin/OverviewCardGrid.tsx').includes('<SelfieMatchWarning'))
  // A warning only: nothing in the check approves, rejects or refuses.
  const lib = read('lib/selfieMatch.ts')
  assert.doesNotMatch(lib, /selfie_status|status: 4|NextResponse/)
})
