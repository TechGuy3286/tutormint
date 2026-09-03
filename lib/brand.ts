// lib/brand.ts
//
// The brand palette as JavaScript values.
//
// app/globals.css is where the colours are DEFINED, and Tailwind utilities
// (bg-tm-red, text-tm-navy, …) are how components should use them. This file
// exists for the handful of places that cannot reach a CSS custom property at
// all:
//
//   * components/badges/* — inline SVG `fill` is a presentation attribute, not
//     a CSS declaration, so it takes a literal colour.
//   * app/api/admin/social/image/route.tsx — next/og renders through satori,
//     which resolves neither Tailwind classes nor var(); social posts must be
//     pixel-stable, so every colour has to be a literal.
//   * app/global-error.tsx — it replaces the root layout when the root layout
//     itself has failed, which means globals.css is not loaded. Inline styles
//     are the only thing that works.
//   * app/api/auth/youtube/callback/route.ts — a standalone HTML string with no
//     stylesheet attached.
//
// Everywhere else, use the Tailwind utility. A raw hex in a className is the
// thing this file is meant to prevent, not enable.
//
// KEEPING THE TWO IN STEP: `npm run check:contrast` parses the @theme block in
// app/globals.css and asserts every value here matches it. Two sources of truth
// for a colour is how a button ends up a different red from the badge beside
// it, so the drift is made into a failing check rather than something a
// reviewer has to notice.

export const BRAND = {
  red: '#C20202',
  redHover: '#A10202',
  navy: '#151E6B',
  navyHover: '#0E1450',
  mint: '#9AE899',
  black: '#0A0A0A',
  greenDeep: '#2E7D4F',
  greenDeepHover: '#24633F',
  gold: '#F59E0B',
  goldHover: '#D98A08',
  goldInk: '#92400E',
  tintRed: '#FBEAEA',
  tintNavy: '#E8EAF5',
  tintGreen: '#EEFBEE',
  tintGold: '#FEF6E6',
  bg: '#F8FAFC',
  white: '#FFFFFF',
} as const

/** The CSS custom-property name each key maps to in app/globals.css. */
export const BRAND_TOKENS: Record<keyof typeof BRAND, string> = {
  red: '--color-tm-red',
  redHover: '--color-tm-red-hover',
  navy: '--color-tm-navy',
  navyHover: '--color-tm-navy-hover',
  mint: '--color-tm-mint',
  black: '--color-tm-black',
  greenDeep: '--color-tm-green-deep',
  greenDeepHover: '--color-tm-green-deep-hover',
  gold: '--color-tm-gold',
  goldHover: '--color-tm-gold-hover',
  goldInk: '--color-tm-gold-ink',
  tintRed: '--color-tm-tint-red',
  tintNavy: '--color-tm-tint-navy',
  tintGreen: '--color-tm-tint-green',
  tintGold: '--color-tm-tint-gold',
  bg: '--color-tm-bg',
  white: '',
}

/**
 * Tailwind's own slate/gray values, as literals.
 *
 * The brief keeps Tailwind's default grays for borders and muted text, and the
 * same four render targets that cannot read a CSS variable cannot read a
 * Tailwind class either. These are not brand colours and nothing in a className
 * should reference them — write `text-slate-700`, not `NEUTRAL.slate700`.
 */
export const NEUTRAL = {
  slate100: '#F1F5F9',
  slate200: '#E2E8F0',
  slate300: '#CBD5E1',
  slate400: '#94A3B8',
  slate700: '#334155',
  slate800: '#1E293B',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray500: '#6B7280',
} as const

/**
 * The four tint/ink pairs an initials avatar can take.
 *
 * Here rather than in components/Avatar.tsx because two render targets need
 * the same answer in two different forms: the React component needs Tailwind
 * class names, and next/og needs literal hex, since satori resolves neither
 * classes nor var(). Splitting them would mean a tutor whose avatar is green
 * on the site and navy on the social post we publish about them.
 *
 * The colour carries no meaning -- not a role, not a plan, not a status. It
 * exists so a list of avatars is scannable. All four pairs are AA-checked in
 * scripts/contrast-check.ts.
 */
export const AVATAR_TINTS = [
  { bg: BRAND.tintNavy, fg: BRAND.navy, className: 'bg-tm-tint-navy text-tm-navy' },
  { bg: BRAND.tintGreen, fg: BRAND.greenDeep, className: 'bg-tm-tint-green text-tm-green-deep' },
  { bg: BRAND.tintRed, fg: BRAND.red, className: 'bg-tm-tint-red text-tm-red' },
  { bg: BRAND.tintGold, fg: BRAND.goldInk, className: 'bg-tm-tint-gold text-tm-gold-ink' },
] as const

/** Stable across server, client and satori: a pure function of the seed string. */
export function avatarTint(seed: string): (typeof AVATAR_TINTS)[number] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_TINTS[h % AVATAR_TINTS.length]
}

/** First letters of up to two words. '?' when there is no name at all. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

/**
 * The chart palette, and the evidence for it.
 *
 * Two series need two hues that a colour-blind reader can still tell apart.
 * Run through the dataviz validator against the light chart surface:
 *
 *   #2E7D4F + #F59E0B   lightness band PASS · chroma PASS
 *                       CVD separation PASS (ΔE 18.7 protan, 32.7 tritan)
 *                       normal-vision PASS (ΔE 30.4)
 *                       contrast vs surface WARN — #F59E0B is 2.09:1
 *
 * The two other brand pairs that clear the lightness band both land in the
 * 6–8 CVD floor band (green↔red ΔE 7.1, green↔gold-ink ΔE 7.4), which is a
 * worse failure: a reader who cannot separate the series cannot read the chart
 * at all, whereas a fill that is light against white is still perfectly
 * locatable next to its legend swatch. tm-navy fails the band outright at
 * L 0.289 — it is a heading colour, not a fill.
 *
 * The gold WARN is relieved as the guidance requires: every chart here ships a
 * table view, and gold is used only as a FILL, which is what CLAUDE.md's brand
 * rules already restrict it to.
 *
 * `single` is for one-series charts, where there is no separation to preserve
 * and navy is the platform's data colour.
 */
export const CHART = {
  /** Fixed order — a series keeps its hue when a filter changes the count. */
  series: [BRAND.greenDeep, BRAND.gold] as const,
  single: BRAND.navy,
  /** Gridlines and axes: one step off the surface, hairline, solid. */
  grid: NEUTRAL.slate200,
  /**
   * Axis ticks and direct labels.
   *
   * The recessive grey a chart wants is slate-400, and slate-400 is 2.6:1 on
   * white -- it cannot be text at any size, which is the same finding that
   * removed text-gray-400 from admin in the September brand pass. Axis labels
   * ARE text, so this is gray-500 (4.83:1) and the recession is carried by
   * size and weight instead of by lightness.
   */
  axisInk: NEUTRAL.gray500,
  /** What the 2px gap between touching marks is painted in. */
  surface: BRAND.white,
} as const
