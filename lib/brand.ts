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
} as const
