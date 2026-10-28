/**
 * scripts/test-post-tuition.ts — the public /post-tuition page (owner, 28 Oct
 * 2026): the button's routing (signed out / parent / tutor), its link preview
 * (og:title exact, og:image /og/post-tuition, a description with no price),
 * its sitemap entry, and that robots.txt does not block it.
 *   npm run test:posttuitionpage
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  POST_TUITION_DESCRIPTION,
  POST_TUITION_HEADING,
  POST_TUITION_OG_IMAGE,
  POST_TUITION_OG_TITLE,
  POST_TUITION_PUBLIC_PATH,
  POST_TUITION_STEPS,
  POST_TUITION_BUTTON,
  postTuitionButtonHref,
} from '@/lib/postTuitionPage'
import { socialMeta } from '@/lib/seo'
import robots from '@/app/robots'

const PAGE = readFileSync('app/(site)/post-tuition/page.tsx', 'utf8')
const OG = readFileSync('app/og/post-tuition/route.tsx', 'utf8')
const SITEMAPS = readFileSync('lib/sitemaps.ts', 'utf8')

test('signed out → sign-up with Parent selected, then the post form', () => {
  const href = postTuitionButtonHref(null)
  assert.ok(href.startsWith('/register?'))
  const q = new URLSearchParams(href.split('?')[1])
  assert.equal(q.get('role'), 'parent')
  assert.equal(q.get('next'), '/parent/dashboard/post-job')
})

test('signed in as a parent → straight to the post form', () => {
  assert.equal(postTuitionButtonHref('parent'), '/parent/dashboard/post-job')
})

test('signed in as a tutor (or anything else) → parent sign-up, never the form', () => {
  for (const role of ['tutor', 'admin', '', undefined]) {
    const href = postTuitionButtonHref(role)
    assert.ok(href.startsWith('/register?') && href.includes('role=parent'), String(role))
  }
})

test('the page shows the heading, the three steps and one button', () => {
  assert.equal(POST_TUITION_HEADING, 'Post your tuition for free')
  assert.deepEqual([...POST_TUITION_STEPS], [
    'Tell us the class and subjects.',
    'Add your city and area.',
    'Verified tutors apply and you choose.',
  ])
  assert.equal(POST_TUITION_BUTTON, 'Post your tuition')
  assert.equal((PAGE.match(/<Link\b/g) ?? []).length, 1, 'exactly one button')
  assert.ok(PAGE.includes('<Breadcrumbs'))
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(PAGE), 'no raw hex')
})

test('og tags: exact title, own image, a clear description with no price', () => {
  assert.equal(POST_TUITION_OG_TITLE, 'Post your tuition for free | TutorMint')
  assert.equal(POST_TUITION_PUBLIC_PATH, '/post-tuition')
  const meta = socialMeta({
    title: POST_TUITION_OG_TITLE,
    description: POST_TUITION_DESCRIPTION,
    path: POST_TUITION_PUBLIC_PATH,
    image: POST_TUITION_OG_IMAGE,
  })
  const og = meta.openGraph as { title: string; url: string; images: { url: string }[] }
  assert.equal(og.title, POST_TUITION_OG_TITLE)
  assert.ok(og.url.endsWith('/post-tuition'))
  assert.ok(og.images[0].url.endsWith('/og/post-tuition'))
  assert.equal((meta.twitter as { card: string }).card, 'summary_large_image')
  assert.ok(POST_TUITION_DESCRIPTION.length > 20 && POST_TUITION_DESCRIPTION.length <= 155)
  for (const text of [POST_TUITION_DESCRIPTION, POST_TUITION_OG_TITLE, ...POST_TUITION_STEPS]) {
    assert.ok(!/\b(rs\.?|pkr|rupees?)\b|\d{3,}/i.test(text), `no price: ${text}`)
    assert.ok(!/\b(largest|biggest|best|top|no\.?\s?1)\b/i.test(text), `no superlative: ${text}`)
  }
  // The page wires the same builder with the same values.
  for (const name of ['POST_TUITION_OG_TITLE', 'POST_TUITION_DESCRIPTION', 'POST_TUITION_OG_IMAGE', 'POST_TUITION_PUBLIC_PATH']) {
    assert.ok(PAGE.includes(name), name)
  }
  assert.ok(PAGE.includes('canonical: POST_TUITION_PUBLIC_PATH'))
})

test('the og image is a 1200×630 PNG with no price', () => {
  assert.ok(OG.includes('width: 1200, height: 630'))
  assert.ok(OG.includes("'Content-Type': 'image/png'"))
  assert.ok(!/\bRs\b|\bPKR\b/.test(OG))
})

test('the pages sitemap lists /post-tuition', () => {
  assert.ok(SITEMAPS.includes('${BASE}/post-tuition`'))
})

test('robots.txt does not block /post-tuition or its preview image', () => {
  const rules = robots().rules
  const list = Array.isArray(rules) ? rules : [rules]
  for (const r of list) {
    const dis = ([] as string[]).concat(r.disallow ?? [])
    for (const path of ['/post-tuition', '/og/post-tuition']) {
      assert.ok(!dis.some((d) => d && path.startsWith(d)), `${path} blocked by ${dis.find((d) => path.startsWith(d))}`)
    }
  }
})
