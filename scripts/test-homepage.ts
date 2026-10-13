/**
 * scripts/test-homepage.ts — npm run test:homepage
 *
 * The three owner-approved homepage changes (13 Oct 2026) and nothing else:
 * the H1, the "For parents" / "For tutors" cards, and the balanced link block.
 * Source checks — no network, no database.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { HOME_CARDS, HOME_H1, HOME_H1_LINES, HOME_MORE_LINKS, SITE_TAGLINE } from '../lib/siteIdentity'

const read = (p: string) => readFileSync(p, 'utf8')
const home = read('app/(site)/page.tsx')

test('a) the H1 is the approved text, in the same styling', () => {
  assert.equal(HOME_H1, 'Find verified tutors in Pakistan — or find tuitions as a tutor')
  assert.deepEqual([...HOME_H1_LINES], ['Find verified tutors in Pakistan', '— or find tuitions as a tutor'])
  assert.ok(home.includes('text-3xl font-black leading-[1.15] text-tm-black sm:mt-3 sm:text-5xl md:text-6xl'), 'the approved size classes')
  assert.equal((home.match(/<h1 className=/g) ?? []).length, 1)
  assert.ok(!home.includes('Tutors/Teachers'), 'the old H1 is gone')
})

test('b) two cards directly below the buttons, from lib/siteIdentity, with real routes', () => {
  assert.deepEqual(HOME_CARDS.map((c) => c.title), ['For parents', 'For tutors'])
  assert.deepEqual(HOME_CARDS[0].points, ['Find verified tutors free', 'Post a tuition free', 'Contact tutors directly'])
  assert.deepEqual(HOME_CARDS[1].points, ['Get verified', 'Find tuitions near you', 'No commission'])
  assert.deepEqual(HOME_CARDS[0].links, [
    { label: 'Browse tutors', href: '/browse/tutors' },
    { label: 'Post a tuition', href: '/parent/dashboard/post-job' },
  ])
  assert.deepEqual(HOME_CARDS[1].links, [
    { label: 'Become a tutor', href: '/register' },
    { label: 'Tuition jobs', href: '/browse/tuitions' },
  ])
  // Side by side, stacked on a phone; after the buttons and before the links.
  assert.ok(home.includes('grid w-full max-w-3xl grid-cols-1 gap-3 text-left sm:grid-cols-2'))
  const buttons = home.indexOf('label="Find Tuitions / Jobs"')
  const cards = home.indexOf('{HOME_CARDS.map(')
  const links = home.indexOf('<HomeLinks />')
  assert.ok(buttons > 0 && buttons < cards && cards < links)
  // No plan price on the homepage.
  assert.ok(!/Rs\.?\s?\d/.test(home + JSON.stringify(HOME_CARDS)))
})

test('c) the link block: city links once, up to six tutor pages, and four links', () => {
  const block = read('components/home/HomeLinks.tsx')
  assert.ok(block.includes('indexableCityPages()') && block.includes('liveLandingPages()'))
  assert.ok(block.includes("filter((p) => p.kind === 'tutors')") && block.includes('.sort((a, b) => b.count - a.count'))
  assert.ok(block.includes('HOME_TUTOR_PAGES_MAX = 6') && block.includes('.slice(0, HOME_TUTOR_PAGES_MAX)'))
  assert.deepEqual(HOME_MORE_LINKS.map((l) => l.label), ['Browse tutors', 'Post a tuition', 'Become a tutor', 'Blog'])
  assert.deepEqual(HOME_MORE_LINKS.map((l) => l.href), ['/browse/tutors', '/parent/dashboard/post-job', '/register', '/blog'])
  // Each city link once: the homepage lists them, so the footer leaves its copy out THERE.
  const footer = read('components/Footer.tsx')
  assert.ok(footer.includes('hideOnHome: true') && footer.includes('<HideOnHome'))
  assert.ok(read('components/HideOnHome.tsx').includes("if (pathname === '/') return null"))
  assert.equal((home.match(/CityJobsLinks/g) ?? []).length, 0, 'the homepage has one city list, in HomeLinks')
})

test('nothing else on the homepage changed', () => {
  // Pill, HIRE, the red line, the Urdu line, both buttons.
  assert.ok(home.includes('Pakistan&rsquo;s Largest Verified Tutors &amp; Teachers Network'))
  assert.ok(home.includes('>\n          HIRE\n        </p>'))
  assert.ok(home.includes('Free to Join &bull; No Commission &bull; No Middleman &bull; Live Demo'))
  assert.ok(home.includes('کوئی فیس نہیں &bull; کوئی کمیشن نہیں &bull; کوئی مڈل مین نہیں &bull; لائیو ڈیمو'))
  assert.ok(home.includes('label="Find Tutors / Teachers"') && home.includes('label="Find Tuitions / Jobs"'))
  assert.equal(SITE_TAGLINE, 'Free to join. No commission. No middleman.')
  // Not added: "How it works", the features list, live counts.
  assert.ok(!/SITE_HOW_IT_WORKS|SITE_FEATURES|How TutorMint works|What you get/.test(home + read('components/home/HomeLinks.tsx')))
  // The lock note records the three changes and the date.
  const claude = read('CLAUDE.md')
  assert.ok(claude.includes('Homepage — fourth owner authorisation (13 Oct 2026)'))
})
