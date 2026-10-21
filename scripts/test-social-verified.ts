/**
 * scripts/test-social-verified.ts
 *
 *   npm run test:socialverified
 *   SOCIAL_SAMPLES_DIR=<folder> npm run test:socialverified   (also writes sample PNGs)
 *
 * Social posts — only verified tutors, the "I'm a Verified Tutor" template, and
 * grey gender avatars for tutors who hid their photo (owner, 21 Oct 2026).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import QRCode from 'qrcode'

import { socialEligible, socialIneligibleReason, toFacts, type SocialEligibilityFacts } from '../lib/social/eligibilityCore'
import { SILHOUETTE_SVG, silhouetteDataUri, socialPortraitSrc } from '../lib/social/avatars'
import {
  SOCIAL_TEMPLATES,
  DEFAULT_SOCIAL_TEMPLATE,
  buildCaption,
  socialText,
  verifiedSubline,
  VERIFIED_SUBLINE,
  type SocialData,
  type SocialFormat,
} from '../lib/social/copy'
import { bannedClaims } from '../lib/brandClaims'
import { BRAND } from '../lib/brand'
import { renderSocialBanner, FORMATS, VERIFIED_MARGIN, type BannerTutor } from '../app/api/admin/social/image/render'

const root = path.join(__dirname, '..')
const src = (f: string) => readFileSync(path.join(root, f), 'utf8')

// ---- Part A: only verified tutors -----------------------------------------

const verified: SocialEligibilityFacts = {
  role: 'tutor',
  feePaid: true,
  cnicApproved: true,
  photoApproved: true,
  selfieApproved: true,
}

test('a verified tutor may be posted', () => {
  assert.equal(socialEligible(verified), true)
})

test('an unverified tutor is left out — each missing step on its own', () => {
  assert.equal(socialIneligibleReason({ ...verified, feePaid: false }), 'fee_unpaid')
  assert.equal(socialIneligibleReason({ ...verified, cnicApproved: false }), 'cnic_not_approved')
  assert.equal(socialIneligibleReason({ ...verified, photoApproved: false }), 'photo_not_approved')
  assert.equal(socialIneligibleReason({ ...verified, selfieApproved: false }), 'selfie_not_approved')
  assert.equal(socialIneligibleReason({ ...verified, suspended: true }), 'suspended')
  assert.equal(socialIneligibleReason({ ...verified, banned: true }), 'banned')
  assert.equal(socialIneligibleReason({ ...verified, isSeed: true }), 'fixture')
  assert.equal(socialIneligibleReason({ ...verified, isTest: true }), 'fixture')
  assert.equal(socialIneligibleReason({ ...verified, role: 'parent' }), 'not_tutor')
  // e.g. a listed tutor who paid but whose documents still wait for review.
  assert.equal(socialEligible({ ...verified, cnicApproved: false, photoApproved: false, selfieApproved: false }), false)
})

test('a newly verified tutor appears: the last approval flips them in', () => {
  const before = { ...verified, selfieApproved: false }
  assert.equal(socialEligible(before), false)
  assert.equal(socialEligible({ ...before, selfieApproved: true }), true)
})

test('the rows map to facts: an Owner-granted fee counts, an approved CNIC needs number + image', () => {
  const row = {
    id: 'x',
    role: 'tutor',
    cnic_verified_at: '2026-10-01T00:00:00Z',
    cnic_number: '35202-1234567-1',
    cnic_image_path: 'u/cnic.jpg',
    profile_pic_status: 'approved',
    selfie_status: 'Approved',
  }
  // An Owner grant stamps verified_fee_paid_at exactly as a payment does.
  const facts = toFacts(row, { verified_fee_paid_at: '2026-10-02T00:00:00Z', gender: 'female', show_avatar: false })
  assert.equal(socialEligible(facts), true)
  assert.equal(facts.photoHidden, true)
  assert.equal(facts.gender, 'female')
  assert.equal(socialEligible(toFacts(row, { verified_fee_paid_at: null })), false)
  assert.equal(socialEligible(toFacts({ ...row, cnic_image_path: null }, { verified_fee_paid_at: '2026-10-02' })), false)
  assert.equal(socialEligible(toFacts({ ...row, is_suspended: true }, { verified_fee_paid_at: '2026-10-02' })), false)
  assert.equal(socialEligible(toFacts({ ...row, is_banned: true }, { verified_fee_paid_at: '2026-10-02' })), false)
})

test('the picker and the render route both use the rule, uncached', () => {
  const page = src('app/admin/social/page.tsx')
  assert.match(page, /loadSocialEligibleTutors\(admin\)/)
  assert.match(page, /export const dynamic = 'force-dynamic'/)
  assert.doesNotMatch(page, /unstable_cache|revalidate\s*=/)
  const loader = src('lib/social/eligibility.ts')
  assert.doesNotMatch(loader, /unstable_cache|cache\(/)
  assert.match(loader, /socialEligible\(facts\)/)
  const route = src('app/api/admin/social/image/route.tsx')
  assert.match(route, /loadSocialTutorFacts\(admin/)
  assert.match(route, /!socialEligible\(facts\)\) return new Response\(NOT_VERIFIED_MESSAGE, \{ status: 403 \}\)/)
  assert.match(route, /if \(!actor\) return new Response\('Sign in\.', \{ status: 401 \}\)/)
  assert.match(src('app/admin/social/SocialClient.tsx'), /Only verified tutors appear here\. A tutor shows up as soon as they&rsquo;re verified\./)
})

// ---- Part C: hidden photos --------------------------------------------------

test('the silhouettes match public/avatars exactly', () => {
  for (const k of ['male', 'female', 'neutral'] as const) {
    assert.equal(SILHOUETTE_SVG[k], readFileSync(path.join(root, 'public/avatars', `${k}.svg`), 'utf8').trim())
  }
})

const decode = (uri: string) => Buffer.from(uri.split(',')[1], 'base64').toString('utf8')

test('a hidden photo gets the gender silhouette, never the real photo', () => {
  const real = 'https://example.supabase.co/storage/v1/object/public/avatars/u/photo.jpg'
  assert.equal(decode(socialPortraitSrc(real, true, 'female')), SILHOUETTE_SVG.female)
  assert.equal(decode(socialPortraitSrc(real, true, 'Male')), SILHOUETTE_SVG.male)
  assert.equal(decode(socialPortraitSrc(real, true, null)), SILHOUETTE_SVG.neutral)
  assert.equal(decode(socialPortraitSrc(real, true, 'trans')), SILHOUETTE_SVG.neutral)
  for (const g of ['female', 'male', null]) assert.ok(!socialPortraitSrc(real, true, g).includes('example.supabase.co'))
  assert.equal(socialPortraitSrc(real, false, 'female'), real)
  assert.equal(decode(silhouetteDataUri(undefined)), SILHOUETTE_SVG.neutral)
})

// ---- copy: no prices, no superlatives --------------------------------------

function data(over: Partial<SocialData> = {}): SocialData {
  return {
    slug: 'ayesha-khan',
    name: 'Ayesha Khan',
    badges: ['Verified'],
    subjects: ['O Level Physics', 'Matric Mathematics', 'Grade 8 English', 'Grade 6 Urdu'],
    ratingAvg: 4.8,
    ratingCount: 12,
    experienceYears: 6,
    teachingMode: 'Home Tutor',
    city: 'Lahore',
    area: 'Johar Town',
    profileUrl: 'https://www.tutormint.org/tutor/ayesha-khan',
    headline: 'New verified tutors this month',
    ...over,
  }
}

const PRICE = /\b(rs\.?|pkr|rupees?)\s*\d|\d\s*(rs|pkr|rupees?)\b|₨|\b(199|499|999)\b|\bfee\b/i

test('no template or caption carries a price, a fee or a superlative', () => {
  for (const t of SOCIAL_TEMPLATES) {
    const lines = [...socialText(t, data()), buildCaption(t, data())]
    for (const line of lines) {
      assert.doesNotMatch(line, PRICE, `${t}: ${line}`)
      assert.deepEqual(bannedClaims(line), [], `${t}: ${line}`)
    }
  }
})

test('the verified template is the default; the Headline field replaces the sub-line', () => {
  assert.equal(DEFAULT_SOCIAL_TEMPLATE, 'verified')
  assert.equal(SOCIAL_TEMPLATES[0], 'verified')
  assert.equal(verifiedSubline(''), VERIFIED_SUBLINE)
  assert.equal(verifiedSubline('  Now teaching in DHA  '), 'Now teaching in DHA')
  assert.equal(verifiedSubline('x'.repeat(120)).length, 90)
  const text = socialText('verified', data({ headline: null })).join('\n')
  assert.match(text, /I'm a Verified Tutor/)
  assert.match(text, /Get your profile verified → tutormint\.org/)
  assert.match(text, /New tuitions posted every day/)
  assert.equal((text.toLowerCase().match(/commission/g) ?? []).length, 1)
})

// ---- the render: margins, hidden photo -------------------------------------

const MAGENTA = { r: 255, g: 0, b: 255 }

async function solidPng(rgb: { r: number; g: number; b: number }) {
  const buf = await sharp({ create: { width: 64, height: 64, channels: 3, background: rgb } }).png().toBuffer()
  return `data:image/png;base64,${buf.toString('base64')}`
}

function tutor(over: Partial<BannerTutor> = {}): BannerTutor {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'ayesha-khan',
    full_name: 'Ayesha Khan',
    headline: null,
    city: 'Lahore',
    area: 'Johar Town',
    rating_avg: 0,
    rating_count: 0,
    avatar_url: null,
    experience_years: 6,
    teaching_mode: 'Home Tutor',
    gender: 'female',
    ...over,
  }
}

async function render(format: SocialFormat, t: BannerTutor, headline = '') {
  const qrDataUri = await QRCode.toDataURL('https://www.tutormint.org/tutor/ayesha-khan', { margin: 1 })
  const mono = readFileSync(path.join(root, 'public/brand/tutormint-monogram.png'))
  const res = renderSocialBanner({
    tutor: t,
    badges: ['Verified'],
    subjects: ['O Level Physics', 'Matric Mathematics', 'Grade 8 English'],
    format,
    template: 'verified',
    qrDataUri,
    profileUrl: 'https://www.tutormint.org/tutor/ayesha-khan',
    headline,
    logoDataUri: `data:image/png;base64,${mono.toString('base64')}`,
  })
  return Buffer.from(await res.arrayBuffer())
}

function hex(c: string) {
  const n = parseInt(c.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

async function marginProblems(png: Buffer, format: SocialFormat): Promise<string[]> {
  const { data: px, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = FORMATS[format]
  assert.equal(info.width, width)
  assert.equal(info.height, height)
  const m = VERIFIED_MARGIN[format]
  const bg = hex(BRAND.bg)
  const out: string[] = []
  for (let y = 0; y < height && out.length < 5; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= m && x < width - m && y >= m && y < height - m) continue
      const i = (y * width + x) * 3
      if (Math.abs(px[i] - bg.r) > 3 || Math.abs(px[i + 1] - bg.g) > 3 || Math.abs(px[i + 2] - bg.b) > 3) {
        out.push(`(${x},${y})`)
        break
      }
    }
  }
  return out
}

async function hasColour(png: Buffer, c: { r: number; g: number; b: number }) {
  const { data: px } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < px.length; i += 3) {
    if (Math.abs(px[i] - c.r) < 8 && Math.abs(px[i + 1] - c.g) < 8 && Math.abs(px[i + 2] - c.b) < 8) return true
  }
  return false
}

const samples = process.env.SOCIAL_SAMPLES_DIR
if (samples) mkdirSync(samples, { recursive: true })

for (const format of ['square', 'story', 'wide'] as const) {
  test(`verified template, ${format}: renders at size with nothing in the margins`, async () => {
    const photo = await solidPng(MAGENTA)
    const withPhoto = await render(format, tutor({ avatar_url: photo }))
    assert.deepEqual(await marginProblems(withPhoto, format), [])
    assert.equal(await hasColour(withPhoto, MAGENTA), true, 'the real photo is drawn when shown')

    // A long name and a long headline still stay inside the margins.
    const long = await render(
      format,
      tutor({ full_name: 'Muhammad Abdul Rehman Siddiqui Qureshi' }),
      'Teaching O Level Physics and Matric Maths in Johar Town, Lahore — book a demo lesson',
    )
    assert.deepEqual(await marginProblems(long, format), [])

    // Hidden photo: the route hands the silhouette, never the real photo.
    const hidden = await render(format, tutor({ avatar_url: socialPortraitSrc(photo, true, 'female') }))
    assert.equal(await hasColour(hidden, MAGENTA), false, 'the hidden photo never reaches the PNG')
    assert.equal(await hasColour(hidden, hex('#E5E7EB')), true, 'the grey silhouette is drawn')
    assert.deepEqual(await marginProblems(hidden, format), [])

    if (samples) {
      writeFileSync(path.join(samples, `verified-${format}-photo.png`), withPhoto)
      writeFileSync(path.join(samples, `verified-${format}-hidden-photo.png`), hidden)
      writeFileSync(path.join(samples, `verified-${format}-long-name.png`), long)
    }
  })
}
