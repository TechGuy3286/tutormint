/**
 * scripts/contrast-check.ts  —  npm run check:contrast
 *
 * Three assertions about colour, all of them things a reviewer would otherwise
 * have to notice by eye:
 *
 *   1. DRIFT. app/globals.css defines the palette; lib/brand.ts repeats it for
 *      the four render targets that cannot read a CSS custom property (SVG fill
 *      attributes, satori, global-error's inline styles, a standalone HTML
 *      string). Two sources for one colour is how a button ends up a different
 *      red from the badge beside it, so the file is parsed and compared rather
 *      than trusted.
 *
 *   2. CONTRAST. Every foreground/background pair the app actually puts on
 *      screen is checked against WCAG 2.1 AA — 4.5:1 for body text, 3:1 for
 *      large text and UI boundaries. The pairs are listed explicitly: a checker
 *      that infers them from markup would quietly stop covering a pair the day
 *      someone reformatted a className.
 *
 *   3. MISUSE. tm-gold is unreadable as a foreground (2.05:1 on the page
 *      ground) and tm-mint is too light to carry text at all. Both are fills.
 *      The source is scanned for the two ways that rule gets broken.
 *
 * Exit code 1 on any failure, so it can gate CI alongside rls:audit.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BRAND, BRAND_TOKENS, NEUTRAL } from '../lib/brand'

const GLOBALS = 'app/globals.css'
const ROOTS = ['app', 'components']

// --------------------------------------------------------------- colour ----

function srgb(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ---------------------------------------------------------------- input ----

/** Every --color-* declaration inside the @theme block. */
function themeTokens(): Map<string, string> {
  const css = readFileSync(GLOBALS, 'utf8')
  const block = css.match(/@theme\s*\{([\s\S]*?)\n\}/)
  if (!block) {
    console.error(`✗ no @theme block found in ${GLOBALS}`)
    process.exit(1)
  }
  const out = new Map<string, string>()
  for (const m of block[1].matchAll(/(--color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out.set(m[1], m[2].toUpperCase())
  }
  return out
}

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p)
    }
  }
  ROOTS.forEach(walk)
  return out
}

// ----------------------------------------------------------------- pairs ----

const C = {
  white: '#FFFFFF',
  ...Object.fromEntries(Object.entries(BRAND)),
  ...Object.fromEntries(Object.entries(NEUTRAL)),
  slate500: '#64748B',
  slate100: '#F1F5F9',
  // Tailwind's own greys, needed because admin leans on them for muted text.
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray100: '#F3F4F6',
  gray700: '#374151',
} as Record<string, string>

type Pair = { fg: string; bg: string; where: string; large?: boolean }

/** Large text = 18.66px bold or 24px regular; AA allows 3:1 there. */
const PAIRS: Pair[] = [
  // Solid brand surfaces with white text.
  { fg: 'white', bg: 'red', where: 'primary buttons, alerts' },
  { fg: 'white', bg: 'redHover', where: 'primary button hover' },
  { fg: 'white', bg: 'navy', where: 'Find Tuitions button, dark buttons' },
  { fg: 'white', bg: 'navyHover', where: 'navy button hover' },
  { fg: 'white', bg: 'greenDeep', where: 'Find Tutors button, success buttons' },
  { fg: 'white', bg: 'greenDeepHover', where: 'green button hover' },
  { fg: 'white', bg: 'black', where: 'footer, dark panels' },

  // Gold is a fill and takes dark text.
  { fg: 'black', bg: 'gold', where: 'social-post Featured chip, admin Hold button' },
  { fg: 'black', bg: 'goldHover', where: 'Hold button hover' },
  { fg: 'navy', bg: 'gold', where: 'FeaturedTag pill' },

  // Mint is a fill; the only text near it is dark.
  { fg: 'black', bg: 'mint', where: 'mint fills' },

  // Brand foregrounds on light grounds.
  { fg: 'red', bg: 'white', where: 'links, headings, prices' },
  { fg: 'red', bg: 'bg', where: 'homepage subline, body text' },
  { fg: 'red', bg: 'tintRed', where: 'error and danger panels' },
  { fg: 'navy', bg: 'white', where: 'headings' },
  { fg: 'navy', bg: 'bg', where: 'headings on the page ground' },
  { fg: 'navy', bg: 'tintNavy', where: 'info panels' },
  { fg: 'greenDeep', bg: 'white', where: 'Verified badge label, success text' },
  { fg: 'greenDeep', bg: 'bg', where: 'HIRE, eyebrow pill' },
  { fg: 'greenDeep', bg: 'tintGreen', where: 'success panels, homepage pill' },
  { fg: 'goldInk', bg: 'white', where: 'Featured badge label, warnings' },
  { fg: 'goldInk', bg: 'bg', where: 'quota and expiry warnings' },
  { fg: 'goldInk', bg: 'tintGold', where: 'warning panels' },

  // The footer, which is the one place mint is a foreground.
  { fg: 'mint', bg: 'black', where: 'footer column headings' },
  { fg: 'slate300', bg: 'black', where: 'footer links' },
  { fg: 'slate400', bg: 'black', where: 'footer brand blurb, copyright line' },
  // slate-500 on tm-black is 4.16:1 and is deliberately NOT used: it was the
  // footer's copyright colour until this check rejected it.

  // Body copy.
  { fg: 'slate700', bg: 'white', where: 'body text on cards' },
  { fg: 'slate700', bg: 'bg', where: 'body text on the page ground' },

  // Muted copy. gray-400 is 2.54:1 on white and cannot be text at any size --
  // section 3 greps for it. gray-500 is the lightest grey that clears AA, and
  // is what the admin panel's labels, timestamps and empty states use.
  { fg: 'gray500', bg: 'white', where: 'admin labels, table headers, empty states' },
  { fg: 'gray500', bg: 'bg', where: 'admin muted copy on the page ground' },
  // slate-500 on slate-100 is 4.34:1 -- under AA, and invisible to a palette
  // check because both are Tailwind neutrals rather than brand tokens. It was
  // carrying the role and status chips on /admin/users, /admin/team and the
  // member timeline until a rendered audit measured it.
  { fg: 'slate700', bg: 'slate100', where: 'admin role and status chips' },
  // gray-500 on gray-100 is 4.39:1 -- the same near-miss as the slate pair, in
  // the 'expired' and 'inactive' chips. Both neutrals, so again invisible to a
  // brand-token check.
  { fg: 'gray700', bg: 'gray100', where: 'expired and inactive chips' },

  // Admin, explicitly. These combinations are already checked above through
  // the public surfaces that share them; they are named again so the gate
  // states in words that the admin panel is covered, and so removing a public
  // use does not silently drop admin's only guarantee.
  { fg: 'white', bg: 'red', where: 'admin Suspend and destructive buttons' },
  { fg: 'goldInk', bg: 'tintGold', where: 'admin Warn chips and hold notices' },
  { fg: 'red', bg: 'tintRed', where: 'admin suspended badges, rejection panels' },
  { fg: 'greenDeep', bg: 'tintGreen', where: 'admin approved and reinstated badges' },
  { fg: 'navy', bg: 'white', where: 'admin headings and table text' },
  { fg: 'mint', bg: 'black', where: 'admin header wordmark on the black bar' },

  // The homepage hero pill, authorised 2 Sep 2026.
  { fg: 'navy', bg: 'tintGreen', where: 'homepage hero pill' },
]

// ----------------------------------------------------------------- run ------

let failures = 0
const fail = (msg: string) => {
  console.log(`  ✗ ${msg}`)
  failures++
}

console.log('\nBrand colour check\n' + '='.repeat(64))

// 1. drift ------------------------------------------------------------------
console.log('\n1. globals.css @theme  vs  lib/brand.ts')
const tokens = themeTokens()
let drift = 0
for (const [key, token] of Object.entries(BRAND_TOKENS)) {
  if (!token) continue // `white` is not a theme token
  const css = tokens.get(token)
  const ts = BRAND[key as keyof typeof BRAND].toUpperCase()
  if (!css) {
    fail(`${token} is in lib/brand.ts but not in ${GLOBALS}`)
    drift++
  } else if (css !== ts) {
    fail(`${token}: ${GLOBALS} says ${css}, lib/brand.ts says ${ts}`)
    drift++
  }
}
console.log(`  ${tokens.size} tokens defined, ${Object.keys(BRAND_TOKENS).length - 1} mirrored, ${drift} mismatched`)

// 2. contrast ---------------------------------------------------------------
console.log('\n2. WCAG AA contrast')
for (const p of PAIRS) {
  const fg = C[p.fg]
  const bg = C[p.bg]
  if (!fg || !bg) {
    fail(`unknown colour in pair ${p.fg}/${p.bg}`)
    continue
  }
  const r = ratio(fg, bg)
  const need = p.large ? 3 : 4.5
  const ok = r >= need
  const grade = r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA-large' : 'FAIL'
  const line = `${p.fg} on ${p.bg}`.padEnd(30) + `${r.toFixed(2).padStart(6)}  ${grade.padEnd(9)} ${p.where}`
  if (ok) console.log(`  ✓ ${line}`)
  else fail(`${line}  (needs ${need}:1)`)
}

// 3. misuse -----------------------------------------------------------------
console.log('\n3. fill-only colours used as foregrounds')
// text- (which is also how lucide sets an icon's stroke), not fill- or stroke-.
// Gold as the FILL of a shape is the use the brief endorses. The star ratings
// are gold, and in both places they convey nothing by colour alone: TutorCard's
// are aria-hidden beside the numeric rating in slate-700, and ReviewForm's are
// role="radio" with aria-checked. A gold glyph standing in for text is the case
// that actually fails a reader.
const GOLD_FG = /\b(?:[a-z-]+:)*(?:text|placeholder|caret|decoration)-tm-gold\b(?!-ink)/
const MINT_BG_WITH_TEXT = /className=(?:"|'|\{`)([^"'`]*\bbg-tm-mint\b[^"'`]*)(?:"|'|`\})/g
const GOLD_BG_WITH_LIGHT_TEXT =
  /\bbg-tm-gold\b(?!-)((?:(?!["'`]).)*?)\b(text-white|text-tm-bg)\b|\b(text-white|text-tm-bg)\b((?:(?!["'`]).)*?)\bbg-tm-gold\b(?!-)/g

// gray-400 is 2.54:1 on white and 2.43:1 on the page ground. It carried empty
// states, table headers, timestamps and field labels in 140 places -- all of
// them small text, so the large-text allowance never applied either. The pair
// list cannot catch this on its own: it checks the palette, and the palette
// never declared gray-400. Only a source scan does, and without one the next
// person who wants a lighter grey reaches for it again.
const FORBIDDEN_GREY = /\b(?:[a-z-]+:)*text-gray-400\b/

// tm-red on tm-black is 3.11:1. Red is a light-surface colour; the brand's
// readable member on a dark surface is tm-mint.
//
// LIMIT, stated because it matters: this is a per-line scan, so it catches the
// two classes on ONE element and nothing else. The case that actually shipped
// -- the admin header, where bg-tm-black is on the <header> and text-tm-red
// four lines below on a child -- is invisible to it, and was found by
// rendering the page and measuring, not by this check. Catching inherited
// backgrounds properly means resolving the JSX tree; until something does
// that, a rendered audit is the only reliable check for text on a dark
// surface. Treat a pass here as 'no obvious same-element mistake', not as
// proof.
const RED_ON_BLACK =
  /\bbg-tm-black\b(?:(?!["'`]).)*?\btext-tm-red\b|\btext-tm-red\b(?:(?!["'`]).)*?\bbg-tm-black\b/

let misuse = 0
for (const file of sourceFiles()) {
  const src = readFileSync(file, 'utf8')

  src.split('\n').forEach((line, i) => {
    if (GOLD_FG.test(line)) {
      fail(`${file}:${i + 1} uses tm-gold as a foreground (2.05:1) — use tm-gold-ink`)
      misuse++
    }
    if (FORBIDDEN_GREY.test(line)) {
      fail(`${file}:${i + 1} uses text-gray-400 (2.54:1 on white) - use text-gray-500`)
      misuse++
    }
    if (RED_ON_BLACK.test(line)) {
      fail(`${file}:${i + 1} puts text-tm-red on bg-tm-black (3.11:1) - use text-tm-mint`)
      misuse++
    }
  })

  // White on gold is 2.15:1. This is the failure the pair list cannot see,
  // because it checks the palette rather than what is written on what -- it
  // shipped on an admin button and only a source scan finds it.
  for (const m of src.matchAll(GOLD_BG_WITH_LIGHT_TEXT)) {
    fail(`${file} puts ${m[2] ?? m[3]} on bg-tm-gold (2.15:1) — gold takes text-tm-black`)
    misuse++
  }

  for (const m of src.matchAll(MINT_BG_WITH_TEXT)) {
    // A mint fill is fine; a mint fill with a text utility on the same element
    // means something is written on it.
    if (/\btext-(?!\[|xs|sm|base|lg|xl|\d)/.test(m[1])) {
      fail(`${file} puts text on bg-tm-mint — mint never carries text`)
      misuse++
    }
  }
}
if (misuse === 0)
  console.log(
    '  OK  tm-gold is never text; tm-mint never carries text; no gray-400; no red on black',
  )

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(64))
if (failures === 0) {
  console.log(`PASS — ${PAIRS.length} pairs at WCAG AA, palette in sync.\n`)
} else {
  console.log(`FAIL — ${failures} problem(s).\n`)
  process.exit(1)
}
