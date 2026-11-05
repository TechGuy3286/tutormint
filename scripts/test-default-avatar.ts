/**
 * scripts/test-default-avatar.ts — npm run test:defaultavatar
 * Gender-based default avatar when a member has no usable photo.
 *   - male → branded male, female → branded female (owner, 5 Nov 2026)
 *   - missing, Trans or unknown gender → the grey neutral silhouette
 *   - a real photo always wins
 *   - a hidden photo ("Hide my photo from parents") never reaches a public
 *     surface: the shared <Avatar>, the tutor card, the profile, social posts,
 *     the status image, og cards and the CV all draw the default instead
 *   - the branded files exist, WebP + PNG, each under 50 KB
 * Renders the shared <Avatar>; source scans for the wiring. No browser.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import Avatar from '../components/Avatar'
import { defaultAvatarImage, defaultAvatarKind, defaultAvatarSrc, DEFAULT_AVATAR_FILES } from '../lib/defaultAvatar'
import { silhouetteDataUri, socialPortraitSrc, SILHOUETTE_SVG } from '../lib/social/avatars'
import { DEFAULT_AVATAR_PNG_DATA_URI } from '../lib/social/defaultAvatarData'
import { toCvModel } from '../lib/cv/model'
import { imageVersionKey } from '../lib/social/imageVersionCore'
import { cvRaw } from './cvFixtures'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const html = (props: Parameters<typeof Avatar>[0]) => renderToStaticMarkup(createElement(Avatar, props))
const PHOTO = 'https://example.com/someone.jpg'

test('gender picks the default: male, female, and neutral for missing / Trans / unknown', () => {
  assert.equal(defaultAvatarKind('male'), 'male')
  assert.equal(defaultAvatarKind('female'), 'female')
  assert.equal(defaultAvatarKind('Male'), 'male')
  assert.equal(defaultAvatarKind(' FEMALE '), 'female')
  for (const g of ['trans', 'Trans', 'other', 'm', 'f', 'unknown', '', '   ', null, undefined]) {
    assert.equal(defaultAvatarKind(g), 'neutral', `gender ${JSON.stringify(g)} → neutral`)
    assert.equal(defaultAvatarImage(g), null)
    assert.equal(defaultAvatarSrc(g), '/avatars/neutral.svg')
  }
  assert.equal(defaultAvatarSrc('male'), '/avatars/default-male-512.png')
  assert.equal(defaultAvatarSrc('female'), '/avatars/default-female-512.png')
})

test('no photo → the branded default for male and female, WebP with a PNG fallback', () => {
  for (const g of ['male', 'female'] as const) {
    for (const src of [null, undefined, '']) {
      const out = html({ name: 'Samia Khan', src, gender: g })
      assert.match(out, /<picture class="contents">/)
      assert.match(out, new RegExp(`<source type="image/webp" srcSet="/avatars/default-${g}-128\\.webp\\?v=\\d+ 128w, /avatars/default-${g}-512\\.webp\\?v=\\d+ 512w"`))
      assert.match(out, new RegExp(`<img[^>]*src="/avatars/default-${g}-128\\.png\\?v=\\d+"`), 'small disc → 128 PNG fallback')
      assert.match(out, /alt="Samia Khan"/)
      assert.match(out, /data-default-avatar/)
    }
    assert.match(html({ name: 'A', gender: g, px: 140 }), new RegExp(`src="/avatars/default-${g}-512\\.png`), 'large disc → 512 PNG')
  }
  // Beside a written name the avatar is decorative: empty alt, hidden from readers.
  const deco = html({ name: 'Samia Khan', gender: 'female', decorative: true })
  assert.match(deco, /alt=""/)
  assert.match(deco, /aria-hidden="true"/)
})

test('missing or Trans gender → the grey neutral silhouette, never a branded file', () => {
  for (const g of [null, undefined, 'trans', 'Trans', 'something-else']) {
    const out = html({ name: 'Samia Khan', gender: g })
    assert.match(out, /<img[^>]*src="\/avatars\/neutral\.svg\?v=\d+"/)
    assert.doesNotMatch(out, /default-(male|female)|<picture/)
  }
})

test('a real photo always wins, whatever the gender', () => {
  for (const gender of ['male', 'female', 'trans', null]) {
    const out = html({ name: 'Samia Khan', src: PHOTO, gender })
    assert.match(out, /src="https:\/\/example\.com\/someone\.jpg"/)
    assert.doesNotMatch(out, /\/avatars\//)
    assert.doesNotMatch(out, /data-default-avatar/)
  }
  assert.equal(socialPortraitSrc(PHOTO, false, 'female'), PHOTO)
})

test('a hidden photo never leaks: the default is drawn even when the photo is passed', () => {
  for (const g of ['male', 'female', 'trans', null]) {
    const out = html({ name: 'Samia Khan', src: PHOTO, gender: g, photoHidden: true })
    assert.doesNotMatch(out, /example\.com/, `${g}: photo URL absent`)
    assert.match(out, /data-default-avatar/)
  }
  // Social posts, status image and og cards.
  assert.equal(socialPortraitSrc(PHOTO, true, 'female'), DEFAULT_AVATAR_PNG_DATA_URI.female)
  assert.equal(socialPortraitSrc(PHOTO, true, 'Male'), DEFAULT_AVATAR_PNG_DATA_URI.male)
  for (const g of [null, 'trans']) {
    const uri = socialPortraitSrc(PHOTO, true, g)
    assert.ok(uri.startsWith('data:image/svg+xml;base64,'))
    assert.equal(Buffer.from(uri.split(',')[1], 'base64').toString(), SILHOUETTE_SVG.neutral)
  }
  // The CV.
  const cvPhoto = (over: Parameters<typeof cvRaw>[0]) =>
    toCvModel(cvRaw({ avatarUrl: 'https://abc.supabase.co/storage/v1/object/public/avatars/x/photo.jpg', ...over }), { includeContact: true, includeFee: false, includePhoto: true }).photo
  assert.deepEqual(cvPhoto({ photoHidden: true, gender: 'female' }), { kind: 'silhouette', avatar: 'female' })
  assert.deepEqual(cvPhoto({ photoHidden: true, gender: 'male' }), { kind: 'silhouette', avatar: 'male' })
  assert.deepEqual(cvPhoto({ photoHidden: true, gender: 'trans' }), { kind: 'silhouette', avatar: 'neutral' })
  // Public callers pass the hidden flag.
  assert.match(read('components/TutorCard.tsx'), /src=\{tutor\.photo_hidden \? null : tutor\.avatar_url\}\s+photoHidden=\{!!tutor\.photo_hidden\}/)
  assert.match(read('app/(site)/tutor/[slug]/profile.tsx'), /src=\{publicPhoto\(tutor\.avatar_url, \{ hidden: photoHidden \}\)\}\s+photoHidden=\{photoHidden\}/)
  // The initials disc is gone from the Avatar and from every component.
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx$/.test(f) && /initialsOf\(|initials=\{/.test(read(p))) offenders.push(p.replace(/\\/g, '/'))
    }
  }
  walk('components')
  walk('app')
  assert.deepEqual(offenders, [])
})

test('social, CV preview and PDF use the branded default for male and female', () => {
  assert.equal(silhouetteDataUri('male'), DEFAULT_AVATAR_PNG_DATA_URI.male)
  assert.equal(silhouetteDataUri('female'), DEFAULT_AVATAR_PNG_DATA_URI.female)
  for (const k of ['male', 'female'] as const) {
    assert.ok(DEFAULT_AVATAR_PNG_DATA_URI[k].startsWith('data:image/png;base64,'))
    const embedded = Buffer.from(DEFAULT_AVATAR_PNG_DATA_URI[k].split(',')[1], 'base64')
    assert.ok(embedded.equals(readFileSync(`public/avatars/default-${k}-512.png`)), `${k}: embedded PNG = the public file`)
  }
  assert.match(read('components/cv/CvPreview.tsx'), /defaultAvatarSrc\(model\.photo\.avatar\)/)
  assert.match(read('lib/cv/pdfDocument.tsx'), /DEFAULT_AVATAR_PNG_DATA_URI\[model\.photo\.avatar\]/)
  assert.match(read('lib/social/crop.ts'), /DEFAULTS\.has\(src\)/, 'the default is never re-cropped')
})

test('images drawn with a default get a new version key', () => {
  const p = { name: 'A', photo: null, photoHidden: false, subjects: [], city: 'Lahore', headline: null, verified: true }
  const d = { template: 'verified', format: 'wide' }
  assert.match(read('lib/social/imageVersionCore.ts'), /DEFAULT_PICTURE_VERSION = 2/)
  assert.notEqual(imageVersionKey(p, d), imageVersionKey({ ...p, photo: 'x' }, d))
})

test('the default keeps the size, round shape and ring of the photo', () => {
  const cls = 'h-[72px] w-[72px] sm:h-[140px] sm:w-[140px]'
  const ring = 'border-2 border-gray-100'
  for (const out of [
    html({ name: 'A B', src: PHOTO, className: cls, ring, px: 140 }),
    html({ name: 'A B', className: cls, ring, px: 140, gender: 'male' }),
    html({ name: 'A B', className: cls, ring, px: 140 }),
  ]) {
    assert.match(out, /rounded-full/)
    assert.ok(out.includes(cls) && out.includes(ring))
    assert.match(out, /width="140"/)
    assert.match(out, /height="140"/)
  }
})

test('the files: branded WebP + PNG under 50 KB each, neutral SVG greyscale', () => {
  for (const f of DEFAULT_AVATAR_FILES) {
    const p = `public${f}`
    const size = statSync(p).size
    assert.ok(size < 50 * 1024, `${p} under 50 KB (${size})`)
  }
  assert.equal(DEFAULT_AVATAR_FILES.length, 9)
  // The owner's originals stay in place.
  assert.ok(statSync('public/male-dummy.png').size > 0)
  assert.ok(statSync('public/fe-male-dummy.png').size > 0)
  const neutral = read('public/avatars/neutral.svg')
  assert.match(neutral, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 96 96">/)
  for (const hex of neutral.match(/#[0-9a-fA-F]{6}/g) ?? []) assert.ok(['#E5E7EB', '#9CA3AF'].includes(hex))
})

test('every member avatar goes through the shared component and passes gender where one exists', () => {
  const passes = [
    'components/TutorCard.tsx',
    'app/(site)/tutor/[slug]/profile.tsx',
    'components/tutor/TutorHeaderCard.tsx',
    'components/MemberHeader.tsx',
    'components/messages/ConversationList.tsx',
    'components/messages/InboxShell.tsx',
    'components/messages/MessagesDock.tsx',
    'components/messages/Conversation.tsx',
    'components/admin/OverviewCardGrid.tsx',
    'app/admin/tutors/videos/TutorModerationClient.tsx',
    'app/admin/jobs/[id]/page.tsx',
    'app/(site)/tutor/dashboard/settings/page.tsx',
  ]
  for (const p of passes) assert.match(read(p), /<Avatar[\s\S]{0,200}?gender=\{/, `${p} passes gender`)
  assert.match(read('lib/browseTutors.ts'), /avatar_url, gender, city/)
  assert.match(read('lib/messaging.ts'), /otherGender: genders\.get\(otherId\) \?\? null/)
  assert.match(read('lib/overviewCards.ts'), /gender: \(t\?\.gender as string \| null\) \?\? null/)
  assert.match(read('lib/headerSession.ts'), /role === 'tutor' \? createClient\(\)\.then\(\(c\) => tutorGender\(c, session\.user\.id\)\)/)
})

test('the default file is never an og:image or structured-data image (og cards draw it inside the card)', () => {
  for (const p of ['lib/seo.ts', 'app/(site)/tutor/[slug]/profile.tsx', 'app/(site)/tuitions/[city]/[slug]/page.tsx', 'app/(site)/parent/[id]/page.tsx']) {
    assert.doesNotMatch(read(p), /\/avatars\/|defaultAvatarSrc|DEFAULT_AVATAR_FILES/, `${p} never names a default avatar file`)
  }
})

test('the shared Avatar carries a version on the default file so a redraw is fetched at once', () => {
  const version = Number(/const DEFAULT_AVATAR_VERSION = (\d+)/.exec(read('components/Avatar.tsx'))?.[1])
  assert.ok(version >= 3)
  assert.match(html({ name: 'A B', gender: 'female' }), new RegExp('/avatars/default-female-128\\.png\\?v=' + version + '"'))
})
