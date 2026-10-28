// scripts/test-ai-visibility.ts — /llms.txt and the "How TutorMint works" FAQ
// (owner, 28 Oct 2026).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { llmsText } from '../lib/siteIdentity'
import { FAQ_GROUPS, FAQ_ITEMS } from '../lib/faqContent'
import { faqJsonLd } from '../lib/seo'

test('/llms.txt names the main pages and support', () => {
  const t = llmsText()
  for (const path of ['/tuition-jobs/lahore', '/tuition-jobs/karachi', '/post-tuition', '/membership-plans', '/browse/tutors', '/browse/tuitions', '/faq', '/sitemap.xml']) {
    assert.ok(t.includes(`https://www.tutormint.org${path})`), path)
  }
  assert.match(t, /## For tutors/)
  assert.match(t, /## For parents/)
  assert.match(t, /## Support/)
  assert.match(t, /WhatsApp: /)
})

test('/llms.txt has no prices', () => {
  const t = llmsText()
  assert.doesNotMatch(t, /\bRs\.?\b/i)
  assert.doesNotMatch(t, /\bPKR\b/i)
  assert.doesNotMatch(t, /\/month|per month|a month/i)
  // No figure that could be a price (support number and links aside).
  const plain = t.replace(/https?:\/\/\S+/g, '').replace(/\d{4} \d{7}/g, '')
  assert.doesNotMatch(plain, /\d{3}/)
  assert.ok(t.includes('membership-plans'), 'costs point at the plans page')
})

test('the FAQ opens with "How TutorMint works" and answers the four questions', () => {
  const basics = FAQ_GROUPS[0]
  assert.equal(basics.id, 'basics')
  assert.equal(basics.heading, 'How TutorMint works')
  const qs = basics.items.map((i) => i.q)
  assert.equal(qs[0], 'Is TutorMint free to join?')
  for (const q of ['How are tutors verified?', 'How do I post a tuition?', 'How do parents contact tutors?']) assert.ok(qs.includes(q), q)
  const verified = basics.items.find((i) => i.q === 'How are tutors verified?')!
  assert.match(verified.a, /Verification Fee/)
  assert.match(verified.a, /CNIC/)
  assert.match(verified.a, /selfie/)
  for (const item of basics.items) assert.doesNotMatch(item.a, /Rs\.?\s?\d/, item.q)
  const page = readFileSync('app/(site)/faq/page.tsx', 'utf8')
  assert.ok(page.includes('id="how-it-works"'))
})

test('FAQPage JSON-LD is built from the same items the page shows', () => {
  const ld = faqJsonLd(FAQ_ITEMS) as { '@type': string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] }
  assert.equal(ld['@type'], 'FAQPage')
  assert.equal(ld.mainEntity.length, FAQ_ITEMS.length)
  FAQ_ITEMS.forEach((item, i) => {
    assert.equal(ld.mainEntity[i].name, item.q)
    assert.equal(ld.mainEntity[i].acceptedAnswer.text, item.a)
  })
  assert.ok(ld.mainEntity.some((m) => m.name === 'Is TutorMint free to join?'))
  assert.ok(readFileSync('app/(site)/faq/page.tsx', 'utf8').includes('faqJsonLd(FAQ_ITEMS)'))
})
