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
import { renderSocialBanner, FORMATS, SAFE_MARGIN, templateBackground, type BannerTutor, type GroupTutor } from '../app/api/admin/social/image/render'
import { headlineFor, subLineFor, bodyTextLines, captionVariants, NO_HEADLINE_MESSAGE } from '../lib/social/copy'
import { shufflePick, templateUnavailable, TEMPLATE_INFO, variantCount } from '../lib/social/templates'
import { tutorOgTitle, tutorOgDescription, shareImageVersion, shareImagePath } from '../lib/seo/tutorOg'
import { SOCIAL_FORMATS, type SocialTemplate } from '../lib/social/copy'
import { cropBox, parseCropAdjust, cropQuery, NO_ADJUST } from '../lib/social/cropCore'
import { croppedPortrait } from '../lib/social/crop'
import { fitWords, accentTail, splitsAccent, textWidth } from '../lib/social/fit'
import { contactSheet } from './socialContactSheet'

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
  // PR C3: the route reads the tutor through lib/social/postTutor.ts, which
  // applies the rule; the route refuses anyone it marks not eligible.
  const post = src('lib/social/postTutor.ts')
  assert.match(post, /loadSocialTutorFacts\(admin/)
  assert.match(post, /socialEligible\(facts\)/)
  const route = src('app/api/admin/social/image/route.tsx')
  assert.match(route, /if \(!post\.eligible\) return new Response\(NOT_VERIFIED_MESSAGE, \{ status: 403 \}\)/)
  assert.match(route, /tutors\.some\(\(t\) => !t!\.eligible\)\) return new Response\(NOT_VERIFIED_MESSAGE, \{ status: 403 \}\)/)
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
  assert.equal((text.toLowerCase().match(/commission/g) ?? []).length, 1)
})

// ---- PR C2: text fitting ----------------------------------------------------

test('the headline keeps "Verified Tutor" together and never exceeds two lines', () => {
  const words = accentTail("I'm a Verified Tutor", 2)
  // The three formats' real headline boxes (square, story, wide).
  for (const [max, maxWidth] of [[92, 805], [124, 769], [66, 620]]) {
    const f = fitWords(words, { max, min: 30, weight: 800, maxWidth, maxLines: 2, tail: 0.98 * max })
    assert.ok(f.lines.length <= 2)
    assert.equal(splitsAccent(f.lines), false, `split at ${maxWidth}`)
  }
  const long = fitWords(accentTail('Teaching O Level Physics and Matric Maths in Johar Town, Lahore — book a demo lesson', 1), {
    max: 92, min: 42, weight: 800, maxWidth: 890, maxLines: 2,
  })
  assert.ok(long.lines.length <= 2)
  for (const line of long.lines) assert.ok(textWidth(line.map((w) => w.text).join(' '), long.size, 800) <= 890)
})

// ---- PR C2: the crop is for this post only ---------------------------------

test('the default crop favours the face: a full-length photo is cropped tight from the top', () => {
  const tall = cropBox(600, 1200)
  assert.ok(tall.size < 600, 'zoomed in on a full-length photo')
  assert.ok(tall.top < 200, 'taken from the upper part')
  assert.equal(tall.left, Math.round((600 - tall.size) / 2), 'centred')
  const wide = cropBox(1600, 900)
  assert.equal(wide.size, 900)
  assert.equal(wide.left, 350)
  // Zoom and move change the box, and the box stays inside the picture.
  const z = cropBox(600, 1200, { zoom: 2, x: 5, y: 5 })
  assert.ok(z.size < tall.size)
  assert.ok(z.left + z.size <= 600 && z.top + z.size <= 1200 && z.left >= 0 && z.top >= 0)
})

test('crop controls are read from the URL, clamped, and default to nothing', () => {
  assert.deepEqual(parseCropAdjust(new URLSearchParams('')), NO_ADJUST)
  assert.deepEqual(parseCropAdjust(new URLSearchParams('zoom=9&x=-40&y=abc')), { zoom: 3, x: -5, y: 0 })
  assert.deepEqual(cropQuery(NO_ADJUST), {})
  assert.deepEqual(cropQuery({ zoom: 1.5, x: 0, y: -2 }), { zoom: '1.5', y: '-2' })
})

test('the crop changes only the post: nothing is saved to the profile', () => {
  const route = src('app/api/admin/social/image/route.tsx')
  assert.match(route, /parseCropAdjust\(url\.searchParams\)/)
  assert.match(src('lib/social/postTutor.ts'), /croppedPortrait\(/)
  assert.doesNotMatch(route, /\.(update|insert|upsert|delete)\(/, 'the render route writes nothing')
  assert.doesNotMatch(src('lib/social/postTutor.ts'), /\.(update|insert|upsert|delete)\(/, 'the loader writes nothing')
  assert.doesNotMatch(src('lib/social/crop.ts'), /supabase|\.from\('|\.update\(|\.upsert\(/)
  const client = src('app/admin/social/SocialClient.tsx')
  assert.match(client, /cropQuery\(crop\)/, 'zoom / move travel only on the image URL')
  assert.doesNotMatch(client, /\/api\/(profile|tutor)/)
})

test('a hidden photo is never cropped from the real photo — the silhouette passes through', async () => {
  const sil = silhouetteDataUri('female')
  assert.equal(await croppedPortrait(sil), sil)
})

// ---- the render: 15 combinations, margins, hidden photo ---------------------

const MAGENTA = { r: 255, g: 0, b: 255 }

async function solidPng(rgb: { r: number; g: number; b: number }, w = 64, h = 64) {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).png().toBuffer()
  return `data:image/png;base64,${buf.toString('base64')}`
}

function tutor(over: Partial<BannerTutor> = {}): BannerTutor {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'ayesha-khan',
    full_name: 'Ayesha Khan',
    headline: 'Physics and maths made simple',
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

const LONG_NAME = 'Muhammad Abdul Rehman Siddiqui Qureshi'
const LONG_HEADLINE = 'Teaching O Level Physics and Matric Maths in Johar Town, Lahore — book a demo lesson'
const LONG_OWN = 'I help students who find maths hard to finally enjoy it, with patient step by step lessons, weekly tests and clear notes for every chapter'

const GROUP_NAMES = ['Ayesha Khan', 'Bilal Ahmed', 'Sara Iqbal', 'Usman Tariq', 'Hina Malik', 'Zain Ali']
const GROUP_SUBJECTS = ['O Level Physics', 'Matric Mathematics', 'Grade 8 English', 'FSc Chemistry', 'A Level Biology', 'Holy Quran']

function groupOf(avatar: string, long = false, n = 6): GroupTutor[] {
  return GROUP_NAMES.slice(0, n).map((name, i) => ({
    slug: `t${i}`,
    name: long && i === 0 ? LONG_NAME : name,
    subject: GROUP_SUBJECTS[i],
    avatar_url: avatar,
    gender: i % 2 ? 'male' : 'female',
  }))
}

async function render(template: SocialTemplate, format: SocialFormat, t: BannerTutor, headline = '', opts: { variant?: number; group?: GroupTutor[]; template2?: SocialTemplate; verified?: boolean } = {}) {
  const qrDataUri = await QRCode.toDataURL('https://www.tutormint.org/tutor/ayesha-khan', { margin: 1 })
  const mono = readFileSync(path.join(root, 'public/brand/tutormint-monogram.png'))
  const res = renderSocialBanner({
    tutor: t,
    badges: opts.verified === false ? [] : ['Verified', 'Premium'],
    subjects: ['O Level Physics', 'Matric Mathematics', 'Grade 8 English'],
    subjectParts: [{ level: 'Matric', subject: 'Mathematics' }],
    format,
    template,
    variant: opts.variant ?? 0,
    qrDataUri,
    profileUrl: 'https://www.tutormint.org/tutor/ayesha-khan',
    headline,
    subhead: template === 'announcement' ? 'Ten new verified tutors joined this week' : '',
    dateLabel: template === 'announcement' ? 'October 2026' : '',
    logoDataUri: `data:image/png;base64,${mono.toString('base64')}`,
    verified: opts.verified ?? true,
    group: template === 'group' ? { city: 'Lahore', tutors: opts.group ?? groupOf('') } : null,
  })
  return Buffer.from(await res.arrayBuffer())
}

function hex(c: string) {
  const n = parseInt(c.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** Pixels in the safe margin that are "ink": far from the ground colour. The
 *  soft background shapes are low-opacity and stay well under the threshold. */
async function marginProblems(png: Buffer, template: SocialTemplate, format: SocialFormat, variant = 0): Promise<string[]> {
  const { data: px, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = FORMATS[format]
  assert.equal(info.width, width)
  assert.equal(info.height, height)
  const m = SAFE_MARGIN[format]
  assert.ok(m.x >= Math.ceil(width * 0.06) && m.y >= Math.ceil(height * 0.06), 'margins are at least 6%')
  const bg = hex(templateBackground(template, variant))
  const out: string[] = []
  for (let y = 0; y < height && out.length < 5; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= m.x && x < width - m.x && y >= m.y && y < height - m.y) continue
      const i = (y * width + x) * 3
      if (Math.abs(px[i] - bg.r) > 40 || Math.abs(px[i + 1] - bg.g) > 40 || Math.abs(px[i + 2] - bg.b) > 40) {
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
const sheet: Record<string, Buffer[]> = {}

/** Templates that draw no photo of the one tutor. */
const NO_SOLO_PHOTO = new Set<SocialTemplate>(['justverified', 'group'])

for (const template of SOCIAL_TEMPLATES) {
  for (const variant of Array.from({ length: variantCount(template) }, (_, i) => i)) {
    for (const format of SOCIAL_FORMATS) {
      const label = `${template}${variant ? ` (look ${variant + 1})` : ''} × ${format}`
      test(`${label}: renders at size with nothing in the safe margins`, async () => {
        const photo = await solidPng(MAGENTA)
        const withPhoto = await render(template, format, tutor({ avatar_url: photo }), '', { variant, group: groupOf(photo) })
        assert.deepEqual(await marginProblems(withPhoto, template, format, variant), [])
        if (template === 'justverified') assert.equal(await hasColour(withPhoto, MAGENTA), false, 'Just verified draws no photo')
        else assert.equal(await hasColour(withPhoto, MAGENTA), true, 'the photo is drawn')

        // A very long name and a long headline (and a long own-words headline)
        // still stay inside the margins.
        const long = await render(template, format, tutor({ full_name: LONG_NAME, headline: LONG_OWN }), LONG_HEADLINE, { variant, group: groupOf('', true) })
        assert.deepEqual(await marginProblems(long, template, format, variant), [], 'long name + headline')

        if (format === 'square' && !NO_SOLO_PHOTO.has(template)) {
          // Hidden photo: the route hands the silhouette — drawn inside the frame.
          const hidden = await render(template, format, tutor({ avatar_url: socialPortraitSrc(photo, true, 'female') }), '', { variant })
          assert.equal(await hasColour(hidden, MAGENTA), false, 'the hidden photo never reaches the PNG')
          assert.equal(await hasColour(hidden, hex('#E5E7EB')), true, 'the grey silhouette is drawn')
          assert.deepEqual(await marginProblems(hidden, template, format, variant), [])
          if (samples && variant === 0) writeFileSync(path.join(samples, `${template}-${format}-hidden-photo.png`), hidden)
        }
        if (samples) {
          const v = variant ? `-look${variant + 1}` : ''
          writeFileSync(path.join(samples, `${template}${v}-${format}.png`), withPhoto)
          writeFileSync(path.join(samples, `${template}${v}-${format}-long.png`), long)
          if (variant === 0) (sheet[template] ??= [])[SOCIAL_FORMATS.indexOf(format)] = withPhoto
        }
      })
    }
  }
}

if (samples) {
  test('contact sheets', async () => {
    const rows = SOCIAL_TEMPLATES.map((t) => ({ label: TEMPLATE_INFO[t].label, images: sheet[t] }))
    writeFileSync(path.join(samples, 'contact-sheet.png'), await contactSheet(rows))
    // All twelve in Square, four to a row.
    const squares = SOCIAL_TEMPLATES.map((t) => sheet[t][0])
    const rows2 = [0, 4, 8].map((i) => ({ label: SOCIAL_TEMPLATES.slice(i, i + 4).map((t) => TEMPLATE_INFO[t].label).join('  ·  '), images: squares.slice(i, i + 4) }))
    writeFileSync(path.join(samples, 'contact-sheet-square.png'), await contactSheet(rows2, 520))
  })
}

// ---- PR C3: the double tick, the ID card, own words, the group -------------

test('"I\'m a Verified Tutor" has no tick in the headline — the ✓ badge on the ring is the only one', () => {
  const h = headlineFor('verified', data())
  assert.equal(h.text, "I'm a Verified Tutor")
  assert.equal(h.tail, undefined)
  assert.doesNotMatch(h.text, /✓/)
})

test('the ID card shows no CNIC, date of birth or phone, and nothing like a government ID', () => {
  const d = data({ headline: null })
  const text = socialText('idcard', d).join('\n')
  assert.match(text, /Verified by TutorMint/)
  assert.doesNotMatch(text, /cnic|date of birth|\bdob\b|birth|phone|mobile|whatsapp|identity card|national|government|nadra|islamic republic/i)
  assert.doesNotMatch(text, /\d{5}-?\d{7}-?\d|(\+?92|0)3\d{2}[\s-]?\d{7}/, 'no CNIC or phone number shape')
  // The layout and the data it is drawn from never read any of them.
  const layout = src('app/api/admin/social/image/layouts.tsx').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(layout, /cnic|birth|phone|mobile|whatsapp|email/i)
  const loader = src('lib/social/postTutor.ts').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(loader.replace(/loadSocialTutorFacts|SocialTutorFacts/g, ''), /cnic_number|date_of_birth|\bdob\b|phone|whatsapp|\.email/i)
})

test("Tutor's own words is disabled without a profile headline", () => {
  assert.equal(templateUnavailable('quote', { headline: null }), 'No headline on profile')
  assert.equal(templateUnavailable('quote', { headline: '   ' }), 'No headline on profile')
  assert.equal(templateUnavailable('quote', { headline: 'Maths made simple' }), null)
  assert.equal(templateUnavailable('verified', { headline: null }), null)
  assert.equal(NO_HEADLINE_MESSAGE, 'No headline on profile')
  // The quote is the tutor's own words exactly (trimmed), never the admin's.
  assert.equal(headlineFor('quote', data({ tutorHeadline: '  Maths   made simple ', headline: 'Something else' })).text, 'Maths made simple')
  const route = src('app/api/admin/social/image/route.tsx')
  assert.match(route, /template === 'quote' && !ownWords\(\{ tutorHeadline: post\.tutor\.headline \}\)/)
  assert.match(route, /return new Response\(NO_HEADLINE_MESSAGE, \{ status: 409 \}\)/)
})

test('the group grid draws hidden photos as grey silhouettes, never the real photo', async () => {
  const photo = await solidPng(MAGENTA)
  // Half the tutors hid their photo: the route hands their silhouettes.
  const tutors = groupOf(photo).map((t, i) => (i % 2 ? { ...t, avatar_url: socialPortraitSrc(photo, true, t.gender) } : t))
  for (const format of SOCIAL_FORMATS) {
    const png = await render('group', format, tutor(), '', { group: tutors })
    assert.equal(await hasColour(png, hex('#E5E7EB')), true, `${format}: silhouettes drawn`)
    assert.equal(await hasColour(png, MAGENTA), true, `${format}: shown photos drawn`)
    assert.deepEqual(await marginProblems(png, 'group', format), [])
  }
  const allHidden = await render('group', 'square', tutor(), '', { group: groupOf(socialPortraitSrc(photo, true, null)) })
  assert.equal(await hasColour(allHidden, MAGENTA), false)
  const text = socialText('group', data({ group: { city: 'Lahore', tutors: GROUP_NAMES.map((n, i) => ({ name: n, subject: GROUP_SUBJECTS[i] })) } })).join('\n')
  assert.match(text, /Verified tutors in Lahore/)
  for (const n of GROUP_NAMES) assert.ok(text.includes(n))
})

// ---- PR C3: Shuffle ----------------------------------------------------------

function seq(...xs: number[]) {
  let i = 0
  return () => xs[i++ % xs.length]
}

test('Shuffle never repeats the previous template and never offers the group post', () => {
  for (const previous of [...SOCIAL_TEMPLATES, null]) {
    for (let r = 0; r < 1; r += 0.07) {
      const pick = shufflePick({ format: 'square', photoHidden: false, hasHeadline: true, previous: previous as SocialTemplate | null, rand: seq(r, r) })
      assert.notEqual(pick.template, previous)
      assert.notEqual(pick.template, 'group')
      assert.ok(pick.variant >= 0 && pick.variant < variantCount(pick.template))
    }
  }
  // Wide always uses the first look; Square / Story may use another.
  assert.equal(shufflePick({ format: 'wide', photoHidden: false, hasHeadline: true, previous: null, rand: () => 0.99 }).variant, 0)
  const story = shufflePick({ format: 'story', photoHidden: false, hasHeadline: true, previous: 'verified', rand: () => 0.99 })
  assert.equal(story.variant, variantCount(story.template) - 1)
  // Without a headline, "Tutor's own words" is never picked.
  for (let r = 0; r < 1; r += 0.05) assert.notEqual(shufflePick({ format: 'square', photoHidden: false, hasHeadline: false, previous: null, rand: () => r }).template, 'quote')
})

test('Shuffle respects a hidden photo: only photo-free templates, Just verified among them', () => {
  const seen = new Set<SocialTemplate>()
  let prev: SocialTemplate | null = null
  for (let r = 0; r < 1; r += 0.01) {
    const pick: ReturnType<typeof shufflePick> = shufflePick({ format: 'square', photoHidden: true, hasHeadline: true, previous: prev, rand: () => r })
    assert.ok(TEMPLATE_INFO[pick.template].photoFree, pick.template)
    assert.notEqual(pick.template, prev)
    seen.add(pick.template)
    prev = pick.template
  }
  assert.ok(seen.has('justverified'))
  for (const t of ['verified', 'spotlight', 'bold', 'split', 'polaroid'] as SocialTemplate[]) assert.ok(!seen.has(t), t)
})

// ---- PR C3: three captions -----------------------------------------------------

const PRICE_C = /\b(rs\.?|pkr|rupees?)\s*\d|\d\s*(rs|pkr|rupees?)\b|₨|\b(199|499|999)\b|\bfee\b/i

test('every template has 3 distinct captions: same link, hashtags and tagline, no price or superlative', () => {
  const d = data({ headline: 'New verified tutors this month', tutorHeadline: 'Physics made simple', group: { city: 'Lahore', tutors: GROUP_NAMES.map((n, i) => ({ name: n, subject: GROUP_SUBJECTS[i] })) }, subjectParts: [{ level: 'Matric', subject: 'Mathematics' }] })
  for (const t of SOCIAL_TEMPLATES) {
    const caps = captionVariants(t, d)
    assert.equal(caps.length, 3)
    assert.equal(new Set(caps).size, 3, `${t}: captions differ`)
    const tails = caps.map((c) => c.split('\n').slice(1).join('\n'))
    assert.equal(new Set(tails).size, 1, `${t}: same tagline, link, handles and hashtags`)
    for (const c of caps) {
      assert.equal((c.match(/Free to join\. No commission\. No middleman\./g) ?? []).length, 1, `${t}: tagline once`)
      assert.doesNotMatch(c, PRICE_C, `${t}: ${c}`)
      assert.deepEqual(bannedClaims(c), [], `${t}: ${c}`)
    }
    assert.ok(caps[0].includes(t === 'group' ? 'https://www.tutormint.org/browse/tutors?city=Lahore' : d.profileUrl), `${t}: link`)
    assert.equal(caps[0], buildCaption(t, d))
  }
  // The group caption lists the names and the city link.
  const g = captionVariants('group', d)[0]
  for (const n of GROUP_NAMES) assert.ok(g.includes(n))
})

// ---- PR C3: the tutor profile link preview ---------------------------------------

test('the profile og:title fits ~60 characters and is cut at a whole word or subject', () => {
  const long = tutorOgTitle({
    name: 'Ayesha Khan',
    subjects: ['English', 'General Knowledge', 'General Science', 'Urdu', 'Mathematics'],
    levels: ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'],
    city: 'Lahore',
  })
  assert.equal(long, 'Ayesha Khan — Grade 1–5 tutor in Lahore | TutorMint')
  assert.equal(tutorOgTitle({ name: 'Ayesha Khan', subjects: ['Physics', 'Chemistry'], levels: ['O Level'], city: 'Lahore' }), 'Ayesha Khan — Physics, Chemistry tutor in Lahore | TutorMint')
  const subjects = ['General Knowledge', 'English Language and Literature', 'Computer Science', 'Mathematics']
  for (const name of ['Ayesha Khan', LONG_NAME, 'Muhammad Abdul Rehman Siddiqui Qureshi Al Hashmi Bin Tariq']) {
    for (const city of ['Lahore', 'Dera Ghazi Khan', null]) {
      for (const n of [0, 1, 2, 4]) {
        const t = tutorOgTitle({ name, subjects: subjects.slice(0, n), levels: n ? ['Grade 9 & 10 - Science'] : [], city })
        assert.ok(t.length <= 60, `${t.length}: ${t}`)
        assert.doesNotMatch(t, /…|,\s*$|—\s*$/, t)
        // Every word in the title is a whole word of the name, a subject, the
        // level, the city or the fixed words — never a fragment.
        const allowed = new Set([...name.split(' '), ...subjects.join(' ').split(' '), 'Grade', '9', '&', '10', '-', 'Science', ...(city ?? '').split(' '), '—', 'tutor', 'Tutor', 'in', '|', 'TutorMint'].map((w) => w.replace(/,$/, '')))
        for (const w of t.split(' ')) assert.ok(allowed.has(w.replace(/,$/, '')), `fragment "${w}" in ${t}`)
        // And a subject is never cut: each subject-ish run is a whole subject.
        for (const s of subjects) if (t.includes(s.split(' ')[0] + ' ') && s.includes(' ') && t.includes(s.split(' ')[0])) assert.ok(t.includes(s) || !t.includes(`${s.split(' ')[0]} tutor`), t)
      }
    }
  }
  assert.doesNotMatch(tutorOgTitle({ name: 'Ayesha', subjects: ['English', 'General Knowledge', 'General Science'], levels: [], city: 'Lahore' }), /General(?! Knowledge| Science)/)
})

test('the profile og:description is at most 155 characters and ends with the tagline', () => {
  const d = tutorOgDescription({ headline: LONG_OWN + ' ' + LONG_OWN, subjects: [], city: 'Lahore' })
  assert.ok(d.length <= 155, String(d.length))
  assert.ok(d.endsWith('Free to join. No commission. No middleman.'))
  assert.equal(tutorOgDescription({ headline: null, subjects: ['Physics', 'Chemistry'], city: 'Lahore' }), 'Teaches Physics, Chemistry in Lahore. Free to join. No commission. No middleman.')
})

test('the profile og:image never says Verified for an unverified tutor, never uses a hidden photo, and refreshes', async () => {
  // The unverified look's words.
  const d = data({ headline: null, tutorHeadline: 'Verified maths tutor with 10 years' })
  for (const line of bodyTextLines('profile', d)) assert.doesNotMatch(line, /verif/i, line)
  assert.equal(subLineFor('profile', data({ tutorHeadline: 'Maths made simple' })), 'Maths made simple')
  // The route picks the look from the verified rule, and drops badges otherwise.
  const route = src('app/og/tutor/[slug]/route.tsx')
  assert.match(route, /template: verified \? 'verified' : 'profile'/)
  assert.match(route, /badges: verified \? post\.badges : \[\]/)
  assert.match(route, /verified,\n/)
  assert.match(route, /under_review \|\| \(flags\?\.imported && !flags\?\.claimed_at\)/)
  // Served at /og/tutor/<slug> — not under /api, which robots.txt disallows.
  assert.doesNotMatch(src('app/robots.ts'), /'\/og/)
  assert.match(src('lib/seo/tutorOg.ts'), /return `\/og\/tutor\//)
  // The render: no ✓ badge and no green ring for the unverified look; a hidden
  // photo is the silhouette.
  const photo = await solidPng(MAGENTA)
  const unverified = await render('profile' as SocialTemplate, 'wide', tutor({ avatar_url: photo }), '', { verified: false })
  assert.deepEqual(await marginProblems(unverified, 'profile' as SocialTemplate, 'wide'), [])
  assert.equal(await hasColour(unverified, hex(BRAND.greenDeep)), false, 'no ✓ badge, no green')
  const hidden = await render('verified', 'wide', tutor({ avatar_url: socialPortraitSrc(photo, true, 'male') }))
  assert.equal(await hasColour(hidden, MAGENTA), false)
  assert.equal(await hasColour(hidden, hex('#E5E7EB')), true)
  // The page hands a versioned URL that changes with the photo, name or verification.
  const base = { avatar: 'https://x/a.jpg', photoShown: true, name: 'Ayesha Khan', verified: true, city: 'Lahore', subjects: ['Physics'] }
  const v = shareImageVersion(base)
  assert.equal(shareImageVersion({ ...base }), v)
  assert.notEqual(shareImageVersion({ ...base, avatar: 'https://x/b.jpg' }), v)
  assert.notEqual(shareImageVersion({ ...base, photoShown: false }), v)
  assert.notEqual(shareImageVersion({ ...base, name: 'Ayesha K.' }), v)
  assert.notEqual(shareImageVersion({ ...base, verified: false }), v)
  assert.equal(shareImageVersion({ ...base, photoShown: false }), shareImageVersion({ ...base, avatar: 'https://x/c.jpg', photoShown: false }), 'a hidden photo’s URL is not part of it')
  assert.equal(shareImagePath('ayesha-khan', v), `/og/tutor/ayesha-khan?v=${v}`)
  const page = src('app/(site)/tutor/[slug]/page.tsx')
  assert.match(page, /image: shareImagePath\(/)
  assert.match(page, /const title = tutorOgTitle\(/)
  if (samples) {
    writeFileSync(path.join(samples, 'og-profile-unverified.png'), unverified)
    writeFileSync(path.join(samples, 'og-profile-verified-hidden-photo.png'), hidden)
    writeFileSync(path.join(samples, 'og-profile-verified.png'), await render('verified', 'wide', tutor({ avatar_url: photo }), 'Physics and maths made simple'))
  }
})
