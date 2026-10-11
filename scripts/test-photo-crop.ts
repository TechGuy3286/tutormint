/**
 * scripts/test-photo-crop.ts — npm run test:photocrop
 * Profile photo crop (owner, 11 Oct 2026):
 *   - the Avatar frames an uncropped photo face-first, and a cropped copy as it is
 *   - the crop frame's arithmetic (cover, clamp, face-first start, zoom)
 *   - a staff crop makes a NEW square copy, keeps the original, and Reset works
 *   - a crop on top of a saved rotation is cut from the turned picture
 *   - the Partner cannot crop; owner / admin / operations can
 *   - a member upload stores the original AND the square, and the review rules
 *     are the screen's own save path, unchanged
 * Pure rules, the real picture code on a generated image, and source scans.
 * Nothing touches storage or a database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'

import Avatar, { AVATAR_FACE_FIRST } from '../components/Avatar'
import { CropPanel, ViewerFrame } from '../components/admin/DocumentViewer'
import { isReadOnlyRole, roleSatisfies, SCREEN_ACCESS } from '../lib/adminAccessCore'
import { normaliseMemberPhoto, renderCroppedCopy } from '../lib/avatarCropImage'
import { currentAvatarState, planAvatarCrop, planAvatarReset, planAvatarRotation } from '../lib/avatarRotationCore'
import {
  AVATAR_OBJECT_POSITION,
  FACE_TOP,
  clampOffset,
  coverScale,
  cropFromView,
  cropPixels,
  croppedCopyPath,
  defaultCrop,
  initialOffset,
  isCroppedAvatarUrl,
  memberPhotoPaths,
  outputSide,
  validCrop,
  zoomAtCentre,
} from '../lib/photoCropCore'

const root = join(__dirname, '..')
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8').replace(/\r\n/g, '\n')
const html = (props: Parameters<typeof Avatar>[0]) => renderToStaticMarkup(createElement(Avatar, props))

const ORIGIN = 'https://abc.supabase.co/storage/v1/object/public/avatars'
const UPLOAD = `${ORIGIN}/u1/1760000000000-me.jpg`
const STAFF_CROP = `${ORIGIN}/u1/cropped-1760000001000.jpg`
const MEMBER_CROP = `${ORIGIN}/u1/photo-1760000002000-crop.jpg`
const MEMBER_ORIGINAL = `${ORIGIN}/u1/photo-1760000002000-original.jpg`

test('the Avatar frames a photo with no crop face-first: centred, about 22% from the top', () => {
  assert.equal(AVATAR_OBJECT_POSITION, '50% 22%')
  assert.equal(AVATAR_FACE_FIRST, `object-[${AVATAR_OBJECT_POSITION.replace(' ', '_')}]`, 'the class is FACE_TOP, spelled out for Tailwind')
  assert.ok(FACE_TOP >= 0.2 && FACE_TOP <= 0.25)
  const plain = html({ name: 'Ajia Zahid', src: UPLOAD })
  assert.ok(plain.includes('object-cover') && plain.includes(AVATAR_FACE_FIRST))
  // A rotated copy is still an uncropped photo.
  assert.ok(html({ name: 'A', src: `${ORIGIN}/u1/rotated-1760000000500-r90.jpg` }).includes(AVATAR_FACE_FIRST))
  // A cropped copy is already a framed square: shown as it is.
  for (const src of [STAFF_CROP, MEMBER_CROP]) {
    assert.equal(isCroppedAvatarUrl(src), true)
    assert.ok(!html({ name: 'A', src }).includes(AVATAR_FACE_FIRST), src)
  }
  assert.equal(isCroppedAvatarUrl(UPLOAD), false)
  assert.equal(isCroppedAvatarUrl(MEMBER_ORIGINAL), false)
  // The default silhouette is unchanged, and it is one component everywhere.
  assert.ok(!html({ name: 'A', src: null }).includes(AVATAR_FACE_FIRST))
  // Selfie and document views do not use the Avatar.
  assert.ok(!read('components', 'admin', 'TutorDocumentReview.tsx').includes('AVATAR_FACE_FIRST'))
})

test('the crop frame: covers, never shows a gap, starts face-first, zooms about its centre', () => {
  // A 600 × 1200 portrait behind a 300 px frame.
  const w = 600
  const h = 1200
  const frame = 300
  const scale = coverScale(w, h, frame)
  assert.equal(scale, 0.5)
  const start = initialOffset(w, h, frame, scale)
  assert.deepEqual(start, { ox: 0, oy: -(h * scale - frame) * FACE_TOP })
  const first = cropFromView({ w, h, frame, scale, ...start })
  assert.ok(Math.abs(first.x) < 1e-9 && Math.abs(first.s - 1) < 1e-9 && Math.abs(first.y - 0.11) < 1e-9, JSON.stringify(first))
  assert.deepEqual(defaultCrop(w, h), first, 'the default crop is the Avatar framing')
  // Dragging past an edge stops at the edge.
  assert.deepEqual(clampOffset({ w, h, frame, scale, ox: 80, oy: 50 }), { ox: 0, oy: 0 })
  assert.deepEqual(clampOffset({ w, h, frame, scale, ox: -999, oy: -999 }), { ox: 0, oy: -300 })
  // Zoom 2 keeps the frame's centre on the same point of the picture.
  const z = zoomAtCentre({ w, h, frame, scale, ox: 0, oy: -150 }, 1)
  assert.deepEqual(z, { ox: -150, oy: -450 })
  const zoomed = cropFromView({ w, h, frame, scale: 1, ...z })
  assert.deepEqual(zoomed, { x: 0.25, y: 0.375, s: 0.5 })
  // Whole pixels, always inside the picture and square.
  assert.deepEqual(cropPixels(zoomed, w, h), { left: 150, top: 450, side: 300 })
  assert.deepEqual(cropPixels({ x: 0.9, y: 0.9, s: 1 }, w, h), { left: 0, top: 600, side: 600 })
  assert.equal(outputSide(300), 512, 'at least 512')
  assert.equal(outputSide(800), 800)
  assert.equal(outputSide(3000), 1024)
  assert.equal(validCrop(zoomed), true)
  for (const bad of [null, {}, { x: 0, y: 0 }, { x: -0.1, y: 0, s: 1 }, { x: 0, y: 0, s: 0 }, { x: Number.NaN, y: 0, s: 1 }]) assert.equal(validCrop(bad), false)
})

// A 400 × 800 picture: red top half, blue bottom half.
async function twoTone(): Promise<Buffer> {
  const half = (r: number, g: number, b: number) => sharp({ create: { width: 400, height: 400, channels: 3, background: { r, g, b } } }).png().toBuffer()
  return sharp({ create: { width: 400, height: 800, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([
      { input: await half(220, 20, 20), top: 0, left: 0 },
      { input: await half(20, 20, 220), top: 400, left: 0 },
    ])
    .jpeg({ quality: 95 })
    .toBuffer()
}
async function pixel(buf: Buffer, x: number, y: number): Promise<'red' | 'blue' | 'other'> {
  const { data } = await sharp(buf).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
  return data[0] > 150 && data[2] < 100 ? 'red' : data[2] > 150 && data[0] < 100 ? 'blue' : 'other'
}

test('a staff crop saves a square copy of at least 512, and the original is not touched', async () => {
  const original = await twoTone()
  const before = Buffer.from(original)
  // The top square of the portrait: all red.
  const top = await renderCroppedCopy(original, 0, { x: 0, y: 0, s: 1 })
  const meta = await sharp(top.buffer).metadata()
  assert.deepEqual([meta.width, meta.height, meta.format, top.side], [512, 512, 'jpeg', 512])
  assert.equal(await pixel(top.buffer, 256, 256), 'red')
  // The bottom square: all blue.
  const bottom = await renderCroppedCopy(original, 0, { x: 0, y: 0.5, s: 1 })
  assert.equal(await pixel(bottom.buffer, 256, 256), 'blue')
  assert.ok(original.equals(before), 'the uploaded bytes are unchanged')

  // The plan: always cut from the uploaded original, stored as a NEW object.
  const plan = planAvatarCrop(UPLOAD, null, { x: 0, y: 0, s: 1 })
  assert.deepEqual([plan.originalUrl, plan.rotation, plan.previousCrop], [UPLOAD, 0, null])
  assert.equal(croppedCopyPath('u1/1760000000000-me.jpg', 1760000001000), 'u1/cropped-1760000001000.jpg')
  assert.equal(croppedCopyPath('me.jpg', 5), 'cropped-5.jpg')
  // Cropping again starts from the original, not from the earlier crop.
  const row = { rotation: 0, original_url: UPLOAD, rotated_url: STAFF_CROP, crop: { x: 0, y: 0, s: 1 }, source: 'staff' }
  const again = planAvatarCrop(STAFF_CROP, row, { x: 0, y: 0.5, s: 1 })
  assert.equal(again.originalUrl, UPLOAD)
  assert.deepEqual(again.previousCrop, { x: 0, y: 0, s: 1 })

  const lib = read('lib', 'avatarCrop.ts')
  assert.equal((lib.match(/upsert: false }/g) ?? []).length, 3, 'every stored picture is a new object')
  assert.ok(!lib.includes('.remove(') && !lib.includes('.move(') && !lib.includes('upsert: true'))
  assert.ok(lib.includes("action: 'profile_photo.crop'") && lib.includes("action: 'profile_photo.crop_reset'"), 'audited with who and when')
  assert.ok(lib.includes("from('profiles').update({ avatar_url: newUrl })"), 'the profile points at the copy, so og:image and structured data follow')
})

test('"Reset to original" points the profile back at the uploaded file', () => {
  const row = { rotation: 90, original_url: UPLOAD, rotated_url: STAFF_CROP, crop: { x: 0.1, y: 0.1, s: 0.5 }, source: 'staff' }
  assert.deepEqual(planAvatarReset(STAFF_CROP, row), { originalUrl: UPLOAD, changed: true })
  // Nothing saved on top: nothing to reset.
  assert.deepEqual(planAvatarReset(UPLOAD, null), { originalUrl: UPLOAD, changed: false })
  // After a reset the saved row no longer applies.
  assert.deepEqual(currentAvatarState(UPLOAD, { rotation: 0, original_url: UPLOAD, rotated_url: null, crop: null }), { originalUrl: UPLOAD, rotation: 0, crop: null, byMember: false })
  // A member's next upload replaces avatar_url; the old row no longer applies.
  assert.equal(currentAvatarState(`${ORIGIN}/u1/new.jpg`, row).originalUrl, `${ORIGIN}/u1/new.jpg`)
  const lib = read('lib', 'avatarCrop.ts')
  assert.ok(lib.includes("from('profiles').update({ avatar_url: plan.originalUrl })"))
})

test('crop combined with rotation: the crop is cut from the turned picture', async () => {
  const original = await twoTone()
  // Turned 90° clockwise the picture is 800 × 400: blue on the left, red on the right.
  const left = await renderCroppedCopy(original, 90, { x: 0, y: 0, s: 0.5 })
  assert.equal(await pixel(left.buffer, 256, 256), 'blue')
  const right = await renderCroppedCopy(original, 90, { x: 0.5, y: 0, s: 0.5 })
  assert.equal(await pixel(right.buffer, 256, 256), 'red')
  assert.deepEqual([(await sharp(right.buffer).metadata()).width, (await sharp(right.buffer).metadata()).height], [512, 512])

  // The plan keeps the saved rotation under a crop ...
  const rotated = { rotation: 90, original_url: UPLOAD, rotated_url: `${ORIGIN}/u1/rotated-1-r90.jpg`, crop: null, source: 'staff' }
  const plan = planAvatarCrop(rotated.rotated_url, rotated, { x: 0.5, y: 0, s: 0.5 })
  assert.deepEqual([plan.originalUrl, plan.rotation], [UPLOAD, 90])
  // ... and turning again drops the crop, whose numbers belonged to the old turn.
  const cropped = { ...rotated, rotated_url: STAFF_CROP, crop: { x: 0.5, y: 0, s: 0.5 } }
  const turn = planAvatarRotation(STAFF_CROP, cropped, 90)
  assert.deepEqual([turn.previous, turn.rotation, turn.originalUrl, turn.dropsCrop, turn.makeCopy], [90, 180, UPLOAD, true, true])
  assert.ok(read('lib', 'avatarRotation.ts').includes('crop: null'))
  // The crop frame shows the turned original, never an earlier crop.
  assert.ok(read('lib', 'avatarCrop.ts').includes('renderCropSource(dl.buffer, state.rotation)'))
})

test('the viewer: "Crop / adjust" for profile pictures only, with Save crop, Reset to original and Cancel', () => {
  const noop = () => {}
  const frame = (onCrop?: () => void) =>
    renderToStaticMarkup(
      createElement(ViewerFrame, {
        image: { src: UPLOAD, alt: 'Profile picture', profileId: 'u1' },
        position: null,
        zoom: 1,
        pan: { x: 0, y: 0 },
        turns: 0,
        canRotate: true,
        saving: false,
        onZoom: noop,
        onPan: noop,
        onTurn: noop,
        onSave: noop,
        onCrop,
        onStep: noop,
        onClose: noop,
      }),
    )
  assert.ok(frame(noop).includes('Crop / adjust') && frame(noop).includes('Rotate left'))
  assert.ok(!frame(undefined).includes('Crop / adjust'), 'not on a document')
  const panel = renderToStaticMarkup(createElement(CropPanel, { title: 'Profile picture', src: '/x.jpg', saving: false, onSave: noop, onReset: noop, onCancel: noop }))
  for (const label of ['Save crop', 'Reset to original', 'Cancel', 'Zoom']) assert.ok(panel.includes(label), label)
  assert.ok(panel.includes('data-crop-frame') && panel.includes('rounded-full'), 'a round crop frame')
  assert.ok(panel.includes('type="range"'), 'a zoom slider')

  const viewer = read('components', 'admin', 'DocumentViewer.tsx')
  assert.ok(viewer.includes('onCrop={img.profileId && canRotate ? openCrop : undefined}'), 'profile pictures only, never for a Partner')
  assert.ok(viewer.includes('const canRotate = (!!img.documentId || !!img.profileId) && !readOnly'))
  assert.ok(viewer.includes("'/api/admin/profile-photo/crop'"))
  const cropper = read('components', 'photo', 'PhotoCropper.tsx')
  assert.ok(cropper.includes('onTouchMove') && cropper.includes('touch-none'), 'drag and pinch on a phone')
})

test('the Partner cannot crop; owner, admin and operations can — the same access as rotate', () => {
  assert.deepEqual(SCREEN_ACCESS.documentRotate, ['admin', 'operations'])
  for (const r of ['owner', 'admin', 'operations'] as const) assert.equal(roleSatisfies(r, SCREEN_ACCESS.documentRotate), true, r)
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.documentRotate), false)
  assert.equal(isReadOnlyRole('partner'), true)
  for (const route of ['crop', 'source', 'rotate']) {
    assert.ok(read('app', 'api', 'admin', 'profile-photo', route, 'route.ts').includes('checkAdminRole(...SCREEN_ACCESS.documentRotate)'), route)
  }
  // checkAdminRole refuses a Partner's POST (403) and a signed-out one (401).
  const auth = read('lib', 'adminAuth.ts')
  assert.ok(auth.includes('isReadOnlyRole(actor.adminRole) && !opts.self'))
  assert.ok(auth.includes("status: 401, error: 'Admin access required.'"))
})

test('a member upload stores the original AND the cropped square; the profile uses the square', async () => {
  assert.deepEqual(memberPhotoPaths('u1', 1760000002000), { original: 'u1/photo-1760000002000-original.jpg', crop: 'u1/photo-1760000002000-crop.jpg' })
  // What is stored: the photo upright and at most 1600 px, and a square of at least 512.
  const big = await sharp({ create: { width: 2400, height: 3200, channels: 3, background: { r: 10, g: 120, b: 60 } } }).jpeg().toBuffer()
  const square = await sharp({ create: { width: 640, height: 640, channels: 3, background: { r: 10, g: 120, b: 60 } } }).jpeg().toBuffer()
  const out = await normaliseMemberPhoto(big, square)
  const o = await sharp(out.original).metadata()
  const c = await sharp(out.crop).metadata()
  assert.deepEqual([o.width, o.height, o.format], [1200, 1600, 'jpeg'])
  assert.deepEqual([c.width, c.height, c.format], [640, 640, 'jpeg'])
  assert.equal((await sharp(out.original).metadata()).exif, undefined, 'no camera metadata is kept')
  await assert.rejects(normaliseMemberPhoto(Buffer.from('not a picture'), square))

  // The record staff read: the square in use, the original behind it.
  const row = { rotation: 0, original_url: MEMBER_ORIGINAL, rotated_url: MEMBER_CROP, crop: { x: 0, y: 0.1, s: 1 }, source: 'member' }
  assert.deepEqual(currentAvatarState(MEMBER_CROP, row), { originalUrl: MEMBER_ORIGINAL, rotation: 0, crop: { x: 0, y: 0.1, s: 1 }, byMember: true })
  assert.equal(currentAvatarState(MEMBER_CROP, { ...row, crop: null }).originalUrl, MEMBER_ORIGINAL, 'even with no crop numbers')

  const lib = read('lib', 'avatarCrop.ts')
  assert.ok(lib.includes('bucket.upload(paths.original') && lib.includes('bucket.upload(paths.crop'))
  assert.ok(lib.includes("source: 'member'") && lib.includes('original_url: originalUrl') && lib.includes('rotated_url: url'))
  const route = read('app', 'api', 'profile', 'photo', 'route.ts')
  assert.ok(route.includes('if (!user) return refuse(401'), 'signed out: 401')
  assert.ok(route.includes("form?.get('original')") && route.includes("form?.get('crop')"))

  // All four screens use the one crop step, and save the address the way they always did.
  const hook = read('components', 'photo', 'usePhotoCropUpload.tsx')
  assert.ok(hook.includes('Move and zoom so your face fills the circle') && hook.includes('lang="ur"'))
  assert.ok(hook.includes('Use photo') && hook.includes('Choose another'))
  assert.ok(hook.includes("body.append('original'") && hook.includes("body.append('crop'") && hook.includes("fetch('/api/profile/photo'"))
  assert.ok(hook.includes('compressImage(file)') && hook.includes('canvas.toBlob'), 'canvas only, no library')
  for (const f of [
    ['components', 'tutor', 'NewOnboardingFlow.tsx'],
    ['components', 'tutor', 'CompleteProfileFlow.tsx'],
    ['app', '(site)', 'tutor', 'dashboard', 'settings', 'page.tsx'],
    ['app', '(site)', 'parent', 'dashboard', 'settings', 'SettingsClient.tsx'],
  ]) {
    const src = read(...f)
    assert.ok(src.includes('usePhotoCropUpload()') && src.includes('cropAndUpload(file)'), f.join('/'))
    assert.ok(!src.includes(".from('avatars').upload(") && !src.includes("from('avatars')\n      .upload("), `${f.join('/')} no longer uploads the uncropped file itself`)
  }
  // Review rules unchanged: the tutor screens still save avatar_url through their own member-side path.
  assert.ok(read('app', '(site)', 'tutor', 'dashboard', 'settings', 'page.tsx').includes("from('tutor_profiles').update({ avatar_url: publicUrl })"))
  // Staff review shows the crop first with a link to the original.
  const review = read('components', 'admin', 'TutorDocumentReview.tsx')
  assert.ok(review.includes('View original') && review.includes('href={avatarOriginalUrl}'))
  // No dependency was added for cropping.
  const deps = Object.keys(JSON.parse(read('package.json')).dependencies)
  assert.ok(!deps.some((d) => /crop|cropper|easy-crop|pica/i.test(d)), deps.join(','))
})
