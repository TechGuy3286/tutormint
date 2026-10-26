/**
 * scripts/test-status-image.ts — the "I'm a Verified Tutor" WhatsApp status
 * image, the image version key and the merged subject chips (owner, 26 Oct 2026).
 * Pure rules + source scans; invented data only.
 *   npm run test:statusimage
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  fillStatusMessage,
  hasLink,
  shareMode,
  SHARE_FALLBACK_LINE,
  STATUS_IMAGE_DEFAULT,
  STATUS_IMAGE_TEMPLATE_KEY,
  statusSaveProblem,
} from '../lib/social/statusImageCore'
import { imageCacheControl, imageVersionKey, ogDrawFacts, STATUS_DRAW, type ImageProfileFacts } from '../lib/social/imageVersionCore'
import { mergeSubjectChips } from '../lib/social/subjectChips'
import { socialPortraitSrc } from '../lib/social/avatars'
import { templateSaveCheck } from '../lib/templateRules'

const read = (p: string) => readFileSync(p, 'utf8')

const FACTS: ImageProfileFacts = {
  name: 'Ayesha Khan',
  photo: 'https://example.supabase.co/storage/v1/object/public/avatars/a/photo-1.jpg',
  photoHidden: false,
  subjects: [101, 102],
  city: 'Lahore',
  headline: 'Patient Maths tutor',
  verified: true,
}

test('the message has no link, ever', () => {
  assert.equal(
    STATUS_IMAGE_DEFAULT,
    "Congratulations {tutor_first_name}, you're now a Verified Tutor on TutorMint ✓ Please post this on your WhatsApp status.",
  )
  const msg = fillStatusMessage(STATUS_IMAGE_DEFAULT, 'Ayesha')
  assert.equal(msg, "Congratulations Ayesha, you're now a Verified Tutor on TutorMint ✓ Please post this on your WhatsApp status.")
  assert.equal(hasLink(msg), false)
  // An edited template with a link loses it; a link placeholder is never filled.
  const edited = fillStatusMessage('Well done {tutor_first_name}! See https://www.tutormint.org/tutor/x and tutormint.org {profile_link}', 'Ali')
  assert.equal(hasLink(edited), false)
  assert.doesNotMatch(edited, /\{profile_link\}/)
  // Team inbox blocks link placeholders and typed addresses for this template.
  const ph = templateSaveCheck(STATUS_IMAGE_TEMPLATE_KEY, 'Hi {tutor_first_name} {profile_link}')
  assert.equal(ph.ok, false)
  const typed = templateSaveCheck(STATUS_IMAGE_TEMPLATE_KEY, 'Hi {tutor_first_name}, see www.tutormint.org')
  assert.equal(typed.ok, false)
  assert.ok(statusSaveProblem('see https://x.com'))
  assert.equal(templateSaveCheck(STATUS_IMAGE_TEMPLATE_KEY, STATUS_IMAGE_DEFAULT).ok, true)
  // The send route adds no staff code (there is nothing to add it to).
  const route = read('app/api/admin/follow-ups/status-image/route.ts')
  assert.match(route, /waSendHref\(msisdn, text\)/)
})

test('only tutors with the Verified badge get one; a hidden photo is the silhouette', () => {
  const lib = read('lib/social/statusImage.ts')
  assert.match(lib, /if \(!post\.eligible\) return \{ ok: false, status: 403/)
  assert.match(lib, /allowed: facts\.verified/)
  assert.match(read('app/api/admin/follow-ups/status-image/route.ts'), /if \(!facts\.allowed\) return NextResponse\.json\(\{ error: 'Only verified tutors have a status image\.' \}, \{ status: 403 \}\)/)
  assert.match(read('app/admin/paid-tutors/page.tsx'), /return f\?\.verified \? imageVersionKey\(f, STATUS_DRAW\) : null/)
  assert.match(read('app/(site)/tutor/dashboard/page.tsx'), /statusImg\?\.allowed && statusImg\.key/)
  // Hidden photo → the grey silhouette, never the real address.
  const src = socialPortraitSrc('https://example.com/real.jpg', true, 'female')
  assert.ok(src.startsWith('data:image/svg+xml'))
  assert.ok(!src.includes('real.jpg'))
  // Story size, the existing design.
  assert.deepEqual(STATUS_DRAW, { template: 'verified', format: 'story' })
})

test('the share button: share sheet with the image, else a download with one line', () => {
  assert.equal(shareMode({ canShareFiles: true }), 'share-sheet')
  assert.equal(shareMode({ canShareFiles: false }), 'download')
  assert.ok(SHARE_FALLBACK_LINE.length > 0 && !SHARE_FALLBACK_LINE.includes('\n'))
  const btn = read('components/tutor/ShareStatusButton.tsx')
  assert.match(btn, /nav\.share\(\{ files: \[file\] \}\)/)
  assert.match(btn, /a\.download = file\.name/)
  assert.match(btn, /setNote\(SHARE_FALLBACK_LINE\)/)
  assert.match(btn, /fetch\('\/api\/tutor\/status-card', \{ method: 'POST' \}\)/, 'the one-time card is dismissed for good')
})

test('the version key changes with subjects, city or headline — and only with what the image shows', () => {
  const k = imageVersionKey(FACTS, STATUS_DRAW)
  assert.equal(imageVersionKey({ ...FACTS }, STATUS_DRAW), k)
  assert.equal(imageVersionKey({ ...FACTS, subjects: [102, 101] }, STATUS_DRAW), k, 'order does not matter')
  assert.notEqual(imageVersionKey({ ...FACTS, subjects: [101] }, STATUS_DRAW), k)
  assert.notEqual(imageVersionKey({ ...FACTS, city: 'Karachi' }, STATUS_DRAW), k)
  assert.notEqual(imageVersionKey({ ...FACTS, headline: 'Physics tutor' }, STATUS_DRAW), k)
  assert.notEqual(imageVersionKey({ ...FACTS, name: 'Ayesha K' }, STATUS_DRAW), k)
  assert.notEqual(imageVersionKey({ ...FACTS, photo: 'https://example.supabase.co/x/photo-2.jpg' }, STATUS_DRAW), k)
  assert.notEqual(imageVersionKey({ ...FACTS, photoHidden: true }, STATUS_DRAW), k)
  assert.notEqual(imageVersionKey({ ...FACTS, verified: false }, STATUS_DRAW), k)
  assert.notEqual(imageVersionKey(FACTS, { template: 'verified', format: 'square' }), k)
  assert.notEqual(imageVersionKey(FACTS, { ...STATUS_DRAW, variant: 1 }), k)
  assert.notEqual(imageVersionKey(FACTS, { ...STATUS_DRAW, crop: { zoom: 1.5, x: 0, y: 0 } }), k)
  assert.equal(imageVersionKey(FACTS, { ...STATUS_DRAW, crop: { zoom: 1, x: 0, y: 0 } }), k, 'no crop = the default crop')
  assert.equal(imageVersionKey({ ...FACTS, city: '  lahore ' }, STATUS_DRAW), k, 'spacing and case of the city do not matter')
  // Cached only while the key is the live one.
  assert.match(imageCacheControl(k, k, 'public'), /^public/)
  assert.equal(imageCacheControl('old', k, 'public'), 'private, no-store')
  assert.equal(imageCacheControl(null, k, 'private'), 'private, no-store')
  assert.deepEqual(ogDrawFacts(true), { template: 'verified', format: 'wide' })
  assert.deepEqual(ogDrawFacts(false), { template: 'profile', format: 'wide' })
})

test('every image URL carries the key and the routes check it', () => {
  assert.match(read('app/(site)/tutor/[slug]/page.tsx'), /imageVersionKey\(ogFacts, ogDrawFacts\(ogFacts\.verified\)\)/)
  assert.match(read('app/og/tutor/[slug]/route.tsx'), /imageCacheControl\(new URL\(request\.url\)\.searchParams\.get\('v'\), live, 'public'\)/)
  assert.match(read('app/api/admin/social/image/route.tsx'), /imageCacheControl\(url\.searchParams\.get\('k'\), live, 'private'\)/)
  assert.match(read('app/admin/social/SocialClient.tsx'), /p\.set\('k', imageVersionKey\(tutor\.imageFacts, \{ template, format, variant, crop \}\)\)/)
  assert.match(read('components/tutor/ShareStatusButton.tsx'), /\/api\/tutor\/social\/status\?k=/)
  assert.match(read('components/admin/SendStatusImageButton.tsx'), /\/api\/admin\/social\/status-image\?memberId=\$\{memberId\}&k=/)
})

test('subject chips merge neighbouring grades like the CV', () => {
  const chips = mergeSubjectChips([
    { level: 'Grade 9', subject: 'English' },
    { level: 'Grade 10', subject: 'English' },
    { level: 'Grade 9', subject: 'Mathematics' },
  ])
  assert.deepEqual(
    chips.map((c) => c.label),
    ['Grade 9–10 · English', 'Grade 9 · Mathematics'],
  )
  const streamed = mergeSubjectChips([
    { level: 'Grade 9 - Science', subject: 'Physics' },
    { level: 'Grade 10 - Science', subject: 'Physics' },
  ])
  assert.deepEqual(streamed.map((c) => c.label), ['Grade 9–10 Science · Physics'])
  const apart = mergeSubjectChips([
    { level: 'Grade 1', subject: 'Urdu' },
    { level: 'Grade 3', subject: 'Urdu' },
  ])
  assert.deepEqual(apart.map((c) => c.label), ['Grade 1 · Urdu', 'Grade 3 · Urdu'], 'grades that are not neighbours stay apart')
  assert.deepEqual(mergeSubjectChips([{ level: 'O Level', subject: 'Chemistry' }]).map((c) => c.label), ['O Level · Chemistry'])
  // Used for social posts, status images and og:image (one reader).
  assert.match(read('lib/social/data.ts'), /return mergeSubjectChips\(raw\)\.slice\(0, limit\)/)
})
