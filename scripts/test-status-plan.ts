/**
 * scripts/test-status-plan.ts — the plan badge on the WhatsApp status image and
 * the "Send welcome" button clean-up (owner, 10 Nov 2026). Invented data only;
 * nothing reads or writes the database.
 *   npm run test:statusplan
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

import { planBadgeNames, STATUS_PLAN_GLYPH, STATUS_PLAN_HEADLINE_ACCENT, STATUS_PLAN_LABEL, statusPlanFor } from '../lib/social/statusPlanCore'
import { headlineFor, type SocialData } from '../lib/social/copy'
import { imageVersionKey, STATUS_DRAW, type ImageProfileFacts } from '../lib/social/imageVersionCore'
import { renderSocialBanner, type BannerTutor } from '../app/api/admin/social/image/render'
import { BRAND } from '../lib/brand'
import { shownWelcome, showSendWelcome, showWelcomeUndo, type Welcome, type WelcomeLocal } from '../lib/paidWelcomeCore'

const root = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')
const NOW = Date.parse('2026-11-10T09:00:00Z')
const sub = (plan_code: string, expires_at: string, status = 'active') => ({ plan_code, status, expires_at })

// ── 1. The rule ──────────────────────────────────────────────────────────────

test('Featured, then Premium, then Verified — only while active', () => {
  assert.equal(statusPlanFor([], NOW), 'verified')
  assert.equal(statusPlanFor([sub('premium', '2026-12-08T19:00:00Z')], NOW), 'premium')
  assert.equal(statusPlanFor([sub('featured', '2026-12-09T19:00:00Z')], NOW), 'featured')
  assert.equal(statusPlanFor([sub('premium', '2027-01-30T19:00:00Z'), sub('featured', '2026-12-09T19:00:00Z')], NOW), 'featured')
  assert.equal(statusPlanFor([sub('featured', '2026-12-09T19:00:00Z', 'cancelled')], NOW), 'verified')
  assert.equal(statusPlanFor([sub('basic', '2027-12-09T19:00:00Z'), sub('verified', '2027-12-09T19:00:00Z')], NOW), 'verified')
})

test('an ended plan falls back to Verified — the boundary in Pakistan time', () => {
  // "ends 9 Dec" on the card: the plan runs to the end of 9 Dec, Pakistan time
  // (2026-12-09T19:00:00Z is midnight starting 10 Dec in Karachi).
  const end = '2026-12-09T19:00:00Z'
  const subs = [sub('featured', end)]
  assert.equal(statusPlanFor(subs, Date.parse('2026-12-09T18:59:59Z')), 'featured', '23:59:59 on 9 Dec PKT')
  assert.equal(statusPlanFor(subs, Date.parse(end)), 'verified', '00:00 on 10 Dec PKT')
  assert.equal(statusPlanFor(subs, Date.parse('2026-12-10T05:00:00Z')), 'verified')
  // A Premium that is still running shows once the Featured above it has ended.
  assert.equal(statusPlanFor([sub('featured', end), sub('premium', '2027-01-01T19:00:00Z')], Date.parse('2026-12-11T00:00:00Z')), 'premium')
})

test('each plan has its badge and label', () => {
  assert.deepEqual(STATUS_PLAN_LABEL, { verified: 'Verified tutor', premium: 'Premium tutor', featured: 'Featured tutor' })
  assert.deepEqual(STATUS_PLAN_GLYPH, { verified: 'tick', premium: 'bolt', featured: 'crown' })
  assert.deepEqual(planBadgeNames('featured'), ['Verified', 'Premium', 'Featured'])
  assert.deepEqual(planBadgeNames('premium'), ['Verified', 'Premium'])
  assert.deepEqual(planBadgeNames('verified'), ['Verified'])
  const data = {
    slug: 'x',
    name: 'Ayesha Khan',
    badges: [],
    subjects: [],
    ratingAvg: null,
    ratingCount: null,
    experienceYears: null,
    teachingMode: null,
    city: 'Lahore',
    area: null,
    profileUrl: 'https://www.tutormint.org/tutor/x',
  } as SocialData
  assert.equal(headlineFor('verified', data).text, "I'm a Verified Tutor")
  assert.equal(headlineFor('verified', { ...data, statusPlan: 'featured' }).text, "I'm a Featured Tutor")
  assert.equal(headlineFor('verified', { ...data, statusPlan: 'premium' }).text, "I'm a Premium Tutor")
  for (const v of [...Object.values(STATUS_PLAN_HEADLINE_ACCENT), ...Object.values(STATUS_PLAN_LABEL)]) {
    assert.doesNotMatch(v, /Rs|\d|best|top|largest|No\.?\s?1/i)
  }
})

test('a plan change is a new image URL; a Verified key is unchanged', () => {
  const f: ImageProfileFacts = { name: 'Ayesha Khan', photo: null, photoHidden: false, subjects: [1], city: 'Lahore', headline: null, verified: true }
  const base = imageVersionKey(f, STATUS_DRAW)
  assert.equal(imageVersionKey({ ...f, plan: 'verified' }, STATUS_DRAW), base)
  assert.notEqual(imageVersionKey({ ...f, plan: 'featured' }, STATUS_DRAW), base)
  assert.notEqual(imageVersionKey({ ...f, plan: 'premium' }, STATUS_DRAW), imageVersionKey({ ...f, plan: 'featured' }, STATUS_DRAW))
})

// ── 2. The drawing ───────────────────────────────────────────────────────────

const tutor: BannerTutor = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'ayesha-khan',
  full_name: 'Ayesha Khan',
  headline: null,
  city: 'Lahore',
  area: null,
  rating_avg: 0,
  rating_count: 0,
  avatar_url: null,
  experience_years: 5,
  teaching_mode: 'Home Tutor',
  gender: 'female',
}

async function draw(plan: 'verified' | 'premium' | 'featured') {
  const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 0, b: 255 } } }).png().toBuffer()
  const res = renderSocialBanner({
    tutor: { ...tutor, avatar_url: `data:image/png;base64,${photo.toString('base64')}` },
    badges: planBadgeNames(plan),
    subjects: ['Matric Mathematics'],
    format: 'story',
    template: 'verified',
    qrDataUri: `data:image/png;base64,${photo.toString('base64')}`,
    profileUrl: 'https://www.tutormint.org/tutor/ayesha-khan',
    headline: '',
    verified: true,
    statusPlan: plan,
  })
  return Buffer.from(await res.arrayBuffer())
}

async function count(png: Buffer, hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const c = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  const { data: px } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let k = 0
  for (let i = 0; i < px.length; i += 3) {
    if (Math.abs(px[i] - c.r) < 6 && Math.abs(px[i + 1] - c.g) < 6 && Math.abs(px[i + 2] - c.b) < 6) k++
  }
  return k
}

test('Featured draws the gold crown badge and label; Premium the navy badge; Verified as today', async () => {
  const [v, p, f] = await Promise.all([draw('verified'), draw('premium'), draw('featured')])
  for (const png of [v, p, f]) {
    const meta = await sharp(png).metadata()
    assert.equal(meta.width, 1080)
    assert.equal(meta.height, 1920)
  }
  const gold = await Promise.all([v, p, f].map((x) => count(x, BRAND.gold)))
  const navy = await Promise.all([v, p].map((x) => count(x, BRAND.navy)))
  assert.ok(gold[2] > 5000, `Featured: gold crown disc + "Featured tutor" pill (${gold[2]} gold pixels)`)
  assert.ok(gold[0] < 200 && gold[1] < 200, `Verified and Premium draw no gold (${gold[0]}, ${gold[1]})`)
  assert.ok(navy[1] > navy[0] + 3000, `Premium: navy badge disc + "Premium tutor" pill (${navy[1]} vs ${navy[0]})`)
})

test('the status image uses the display name and never a phone, CNIC name or price', () => {
  const post = read('lib/social/postTutor.ts')
  assert.match(post, /full_name: formatName\(\(tp\.full_name as string\)/)
  assert.doesNotMatch(post, /cnic_name|phone_number|whatsapp|cnic_number/)
  const status = read('lib/social/statusImage.ts')
  assert.match(status, /tutor: post\.tutor/)
  assert.match(status, /statusPlan: plan/)
  assert.doesNotMatch(status, /phone|whatsapp|price_pkr|amount/)
  const pieces = read('app/api/admin/social/image/pieces.tsx')
  assert.doesNotMatch(pieces, /phone_number|whatsapp_number|price_pkr/)
})

// ── 3. Send welcome ──────────────────────────────────────────────────────────

test('"Send welcome" hides once a welcome is logged and comes back on Undo', () => {
  const stored: Welcome = { id: 'w1', at: '2026-11-09T10:00:00Z', by: 'Staff A' }
  // Not welcomed: the button shows.
  assert.equal(showSendWelcome(shownWelcome(null, { kind: 'none' })), true)
  // Stored welcome: hidden, the line shows.
  assert.equal(showSendWelcome(shownWelcome(stored, { kind: 'none' })), false)
  // Just sent here (stored row not refreshed yet): hidden at once, Undo open.
  const sent: WelcomeLocal = { kind: 'sent', welcome: { id: 'w2', at: '2026-11-10T09:00:00Z', by: null } }
  assert.equal(showSendWelcome(shownWelcome(null, sent)), false)
  assert.equal(shownWelcome(null, sent)?.id, 'w2')
  assert.equal(showWelcomeUndo(sent, NOW + 5_000, 10_000), true)
  assert.equal(showWelcomeUndo(sent, NOW + 10_000, 10_000), false, 'Undo closes with the window')
  assert.equal(showWelcomeUndo({ kind: 'none' }, NOW, 10_000), false)
  // Undo: the button comes back even while the stored row still says welcomed.
  assert.equal(shownWelcome(stored, { kind: 'undone' }), null)
  assert.equal(showSendWelcome(shownWelcome(stored, { kind: 'undone' })), true)
  // Read-only staff never see it.
  assert.equal(showSendWelcome(null, true), false)
  // The card wires the rule and keeps the status image.
  const card = read('components/admin/PaidWelcomeActions.tsx')
  assert.match(card, /showSendWelcome\(shown, readOnly\)/)
  assert.match(card, /setLocal\(\{ kind: 'undone' \}\)/)
  assert.match(card, /Status image/)
})
