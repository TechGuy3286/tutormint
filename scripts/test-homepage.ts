/**
 * scripts/test-homepage.ts — npm run test:homepage
 *
 * The three owner-approved homepage changes (13 Oct 2026) and nothing else:
 * the H1, the "For parents" / "For tutors" cards, and the balanced link block.
 * Source checks — no network, no database.
 */

import { brandLine } from '../lib/brandClaims'
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
  // PR-12 (owner-authorised): 'No commission' became 'Free to join'.
  assert.deepEqual(HOME_CARDS[1].points, ['Get verified', 'Find tuitions near you', 'Free to join'])
  assert.deepEqual(HOME_CARDS[0].links, [
    { label: 'Browse tutors', href: '/browse/tutors' },
    { label: 'Post a tuition', href: '/register?next=%2Fparent%2Fdashboard%2Fpost-job&role=parent' },
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
  assert.ok(block.includes('cityPagesCachedForLinks()') && block.includes('liveLandingPages()'), 'every city with an open tuition (16 Nov 2026)')
  assert.ok(block.includes("filter((p) => p.kind === 'tutors')") && block.includes('.sort((a, b) => b.count - a.count'))
  assert.ok(block.includes('HOME_TUTOR_PAGES_MAX = 6') && block.includes('.slice(0, HOME_TUTOR_PAGES_MAX)'))
  assert.deepEqual(HOME_MORE_LINKS.map((l) => l.label), ['Browse tutors', 'Post a tuition', 'Become a tutor', 'Blog'])
  assert.deepEqual(HOME_MORE_LINKS.map((l) => l.href), ['/browse/tutors', '/register?next=%2Fparent%2Fdashboard%2Fpost-job&role=parent', '/register', '/blog'])
  // Each city link once: the homepage lists them, so the footer leaves its copy out THERE.
  const footer = read('components/Footer.tsx')
  // PR-15: the footer's columns are built in lib/footerLinksCore.
  assert.ok(read('lib/footerLinksCore.ts').includes('hideOnHome: true') && footer.includes('<HideOnHome'))
  assert.ok(read('components/HideOnHome.tsx').includes("if (pathname === '/') return null"))
  assert.equal((home.match(/CityJobsLinks/g) ?? []).length, 0, 'the homepage has one city list, in HomeLinks')
})

test('PR-09 "crystal" polish is look only (owner, 18 Nov 2026)', () => {
  const css = read('app/globals.css')
  const block = read('components/home/HomeLinks.tsx')
  // The glow is one empty, hidden box; glass and gloss are classes only.
  assert.ok(home.includes('<div aria-hidden className="tm-hero-glow" />'))
  for (const cls of ['.tm-hero-glow', '.tm-glass ', '.tm-glass-card', '.tm-gloss ', '.tm-gloss::before', '.tm-glass-tile', '.tm-glass-chip']) {
    assert.ok(css.includes(cls), `${cls} is defined`)
  }
  // Solid-white fallback, smaller blur on phones, reduced motion respected.
  assert.ok(css.includes('@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))'))
  assert.ok(css.includes('backdrop-filter: blur(7px)') && css.includes('backdrop-filter: blur(12px)'))
  assert.ok(/prefers-reduced-motion: reduce\) \{\s*\.tm-glass-card:hover/.test(css))
  // The sheen ends inside the button padding (p-5 = 20px), so no text sits on it.
  assert.ok(/\.tm-gloss::before \{[^}]*height: 18px/.test(css) && home.includes('rounded-2xl p-5 text-left text-white'))
  // Brand button colours untouched.
  assert.ok(home.includes("'tm-gloss-green bg-tm-green-deep hover:bg-tm-green-deep-hover focus-visible:outline-tm-green-deep'"))
  assert.ok(home.includes("'tm-gloss-navy bg-tm-navy hover:bg-tm-navy-hover focus-visible:outline-tm-navy'"))
  // City chips: 40px tall on phones, same link, no dot separators, and no
  // count (owner PR-09, 19 Nov 2026: no numbers on the homepage).
  assert.ok(block.includes('tm-glass-chip inline-flex min-h-10'))
  assert.ok(/className=\{CITY_CHIP\}>\s*\{p\.city\}\s*<\/Link>/.test(block) && !block.includes('{p.count}') && block.includes('href={cityPagePath(p.citySlug)}'))
  // The contrast gate checks text on the glow and on glass.
  const contrast = read('scripts/contrast-check.ts')
  assert.ok(contrast.includes("C.heroGlow = over(C.greenDeep, over(C.navy, over(C.mint, C.bg, 0.28), 0.06), 0.05)"))
  assert.ok(css.includes('var(--color-tm-mint) 28%') && css.includes('var(--color-tm-navy) 6%') && css.includes('var(--color-tm-green-deep) 5%'))
  assert.ok(css.includes('rgb(255 255 255 / 0.66)') && contrast.includes('over(C.white, C.heroGlow, 0.66)'))
  assert.ok(read('docs/history/2026-11.md').includes('Homepage — seventh owner authorisation'))
})

test('nothing else on the homepage changed', () => {
  // HIRE, the red line, the Urdu line, both buttons. The pill keeps its
  // styling; its TEXT is the computed brand line (owner-approved, 14 Oct 2026).
  // Same type and size; the surface became glass in PR-09 (owner, 18 Nov 2026).
  assert.ok(home.includes('tm-glass rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-tm-navy sm:text-xs sm:tracking-[0.18em]'))
  assert.ok(home.includes('{pill}') && home.includes('const pill = BRAND_LINE_GROWING') && !home.includes('cachedBrandLine'))
  assert.ok(!home.replace(/\/\/.*$/gm, '').includes('Largest'))
  assert.equal(brandLine(0), "Pakistan's fast-growing tutor network")
  assert.equal(brandLine(99), "Pakistan's fast-growing tutor network")
  assert.equal(brandLine(100), '100+ verified tutors across Pakistan')
  assert.equal(brandLine(260), '250+ verified tutors across Pakistan')
  // "HIRE" is gone (owner-approved, 15 Oct 2026) — and nothing else with it.
  assert.ok(!home.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').includes('HIRE'))
  // PR-12 (owner-authorised for this purpose only): no commission / middleman wording.
  assert.ok(home.includes('Free Profile &bull; Verified Tutors &bull; Contact Directly &bull; Live Demo'))
  assert.ok(home.includes('مفت پروفائل &bull; تصدیق شدہ ٹیوٹرز &bull; براہِ راست رابطہ &bull; لائیو ڈیمو'))
  assert.ok(home.includes('label="Find Tutors / Teachers"') && home.includes('label="Find Tuitions / Jobs"'))
  assert.equal(SITE_TAGLINE, 'Free to join. Verified tutors. Contact tutors directly.')
  // Not added: "How it works", the features list, live counts. No count
  // anywhere on the homepage (owner PR-09, 19 Nov 2026).
  assert.ok(!/\.count\}|cachedBrandLine|verifiedBadgeTutorCount/.test(home + read('components/home/HomeLinks.tsx')))
  assert.ok(read('CLAUDE.md').includes('homepage shows no member, tutor or tuition counts'))
  assert.ok(!/SITE_HOW_IT_WORKS|SITE_FEATURES|How TutorMint works|What you get/.test(home + read('components/home/HomeLinks.tsx')))
  // The lock note records the three changes and the date.
  // The dated authorisations moved, unchanged, to docs/history (PR-05);
  // CLAUDE.md keeps the one-line lock rule.
  const claude = read('docs/history/2026-10.md')
  assert.ok(read('CLAUDE.md').includes('Homepage is LOCKED'))
  assert.ok(claude.includes('Homepage — fourth owner authorisation (13 Oct 2026)'))
  assert.ok(claude.includes('Homepage — fifth owner authorisation (14 Oct 2026)'))
  assert.ok(claude.includes('Homepage — sixth owner authorisation (15 Oct 2026)'))
})
