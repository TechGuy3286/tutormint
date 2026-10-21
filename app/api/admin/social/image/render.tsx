import { ImageResponse } from 'next/og'
import { BRAND, NEUTRAL } from '@/lib/brand'
import { silhouetteDataUri } from '@/lib/social/avatars'
import type { BadgeName } from '@/lib/planBadges'
import { SOCIAL_MARKS } from '@/lib/social/marks'
import { JAKARTA_500_B64, JAKARTA_700_B64, JAKARTA_800_B64 } from '@/lib/social/fonts'
import { GEIST_REGULAR_DATA_URI } from '@/lib/cv/font'
import { accentTail, fitWords, plainWords, textWidth, type Word } from '@/lib/social/fit'
import {
  bandTextLines,
  buildCaption,
  ctaParts,
  headlineFor,
  subLineFor,
  occasionFor,
  subjectLabels,
  HANDLE,
  SITE,
  TAGLINE,
  WORDMARK,
  X_HANDLE,
  type SocialData,
  type SocialFormat,
  type SocialTemplate,
} from '@/lib/social/copy'

// The social image generator — five templates × three formats, satori/next-og.
//
// ONE STRUCTURE FOR EVERY TEMPLATE (owner, 21 Oct 2026 — "PR C2"): the tutor's
// photo is the hero, large, in a gradient ring with a small green ✓ badge; a
// heavy Plus Jakarta Sans headline (about twice the old size) with its key words
// in green; then the name, up to three subject chips and the city; a CTA pill;
// and the small brand footer (wordmark, tagline, site, handles, marks, QR).
// Square and Story are a centred stack; Wide puts the photo left and the words
// right. Each template only changes the look (THEMES below).
//
// Fitting: every headline and name is wrapped and sized here with the font's own
// widths (lib/social/fit.ts) — at most two lines — and the photo takes the room
// that is left, so nothing can spill into the SAFE_MARGIN (6%+ on every side).
// scripts/test-social-verified.ts renders all 15 combinations and checks the
// margins hold no ink, with a long name and a long headline too.
//
// All colours are hex literals from lib/brand.ts (satori resolves neither
// Tailwind nor CSS vars). Renders are pixel-stable (no clock, no randomness).
// Every word comes from lib/social/copy.ts — the module the caption box and the
// tests read — so the creative cannot word anything on its own.

export const FORMATS: Record<SocialFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  wide: { width: 1200, height: 630 },
}

/** The empty margin on every side, per format (px) — at least 6% of the side. */
export const SAFE_MARGIN: Record<SocialFormat, { x: number; y: number }> = {
  square: { x: 72, y: 72 },
  story: { x: 72, y: 124 },
  wide: { x: 76, y: 40 },
}

const NAVY = BRAND.navy
const GREEN = BRAND.greenDeep
const MINT = BRAND.mint
const SLATE = NEUTRAL.slate700

/** The public profile data the render draws. */
export type BannerTutor = {
  id: string
  slug: string
  full_name: string
  headline: string | null
  city: string | null
  area: string | null
  rating_avg: number | null
  rating_count: number | null
  /** Already cropped by lib/social/crop.ts in the routes; a silhouette when hidden. */
  avatar_url: string | null
  experience_years?: number | null
  teaching_mode?: string | null
  /** The profile gender — picks the grey silhouette when there is no photo
   *  (a hidden photo arrives here as null; see the routes). */
  gender?: string | null
}

export type BannerParams = {
  tutor: BannerTutor
  badges: BadgeName[]
  subjects: string[]
  format: SocialFormat
  template: SocialTemplate
  qrDataUri: string
  profileUrl: string
  /** The editable Headline field (max 90). */
  headline?: string
  /** announcement only: a detail line and a date chip. */
  subhead?: string
  dateLabel?: string
  /** success only. */
  successKind?: 'verified' | 'hired'
  /** The TM monogram as a data URI; null → typed wordmark only. */
  logoDataUri?: string | null
  /** Draw the green ✓ badge on the photo ring (default: the badges include Verified). */
  verified?: boolean
}

/** Turn render params into the pure SocialData the copy helpers read. */
function toData(p: BannerParams): SocialData {
  return {
    slug: p.tutor.slug,
    name: p.tutor.full_name,
    tutorHeadline: p.tutor.headline,
    badges: p.badges,
    subjects: p.subjects,
    ratingAvg: p.tutor.rating_avg,
    ratingCount: p.tutor.rating_count,
    experienceYears: p.tutor.experience_years ?? null,
    teachingMode: p.tutor.teaching_mode ?? null,
    city: p.tutor.city,
    area: p.tutor.area,
    profileUrl: p.profileUrl,
    successKind: p.successKind,
    headline: p.headline ?? null,
    subhead: p.subhead ?? null,
  }
}

/** The caption for the admin box — same data, so what's pasted matches the art. */
export function socialCaption(p: BannerParams): string {
  return buildCaption(p.template, toData(p))
}

// --- fonts -------------------------------------------------------------------

const b64ToArrayBuffer = (b64: string): ArrayBuffer => {
  const buf = Buffer.from(b64, 'base64')
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

let FONTS: { name: string; data: ArrayBuffer; weight: 400 | 500 | 700 | 800; style: 'normal' }[] | null = null
function fonts() {
  if (!FONTS) {
    FONTS = [
      { name: 'Jakarta', data: b64ToArrayBuffer(JAKARTA_500_B64), weight: 500, style: 'normal' },
      { name: 'Jakarta', data: b64ToArrayBuffer(JAKARTA_700_B64), weight: 700, style: 'normal' },
      { name: 'Jakarta', data: b64ToArrayBuffer(JAKARTA_800_B64), weight: 800, style: 'normal' },
      // Fallback for any glyph outside the Latin subset.
      { name: 'Geist', data: b64ToArrayBuffer(GEIST_REGULAR_DATA_URI.split(',')[1]), weight: 400, style: 'normal' },
    ]
  }
  return FONTS
}

// --- themes ------------------------------------------------------------------

type Theme = {
  bg: string
  /** Headline / name colour, and the green key word. */
  fg: string
  accent: string
  muted: string
  dark: boolean
  /** CSS gradient for the photo ring. */
  ring: string
  shadow: string
  chipBg: string
  chipFg: string
  /** 'fill' = solid pill, 'outline' = border + text. */
  ctaStyle: 'fill' | 'outline'
  ctaBg: string
  ctaFg: string
  /** Soft background shapes (low opacity). */
  blobs: [string, string]
  blobOpacity: number
  /** The small accent strokes near the headline. */
  stroke: string
  footerRule: string
}

const THEMES: Record<SocialTemplate, Theme> = {
  verified: {
    bg: BRAND.bg,
    fg: NAVY,
    accent: GREEN,
    muted: SLATE,
    dark: false,
    ring: `linear-gradient(135deg, ${NAVY} 0%, ${GREEN} 100%)`,
    shadow: '0 24px 48px rgba(21,30,107,0.22)',
    chipBg: BRAND.tintNavy,
    chipFg: NAVY,
    ctaStyle: 'fill',
    ctaBg: GREEN,
    ctaFg: BRAND.white,
    blobs: [MINT, NAVY],
    blobOpacity: 0.1,
    stroke: GREEN,
    footerRule: NEUTRAL.slate200,
  },
  spotlight: {
    bg: BRAND.white,
    fg: NAVY,
    accent: GREEN,
    muted: SLATE,
    dark: false,
    ring: `linear-gradient(135deg, ${GREEN} 0%, ${MINT} 100%)`,
    shadow: '0 24px 48px rgba(46,125,79,0.24)',
    chipBg: BRAND.tintGreen,
    chipFg: NAVY,
    ctaStyle: 'outline',
    ctaBg: BRAND.white,
    ctaFg: GREEN,
    blobs: [MINT, MINT],
    blobOpacity: 0.12,
    stroke: GREEN,
    footerRule: NEUTRAL.slate200,
  },
  bold: {
    bg: NAVY,
    fg: BRAND.white,
    accent: MINT,
    muted: NEUTRAL.slate300,
    dark: true,
    ring: `linear-gradient(135deg, ${MINT} 0%, ${GREEN} 100%)`,
    shadow: '0 24px 52px rgba(0,0,0,0.4)',
    chipBg: BRAND.white,
    chipFg: NAVY,
    ctaStyle: 'fill',
    ctaBg: MINT,
    ctaFg: NAVY,
    blobs: [MINT, BRAND.white],
    blobOpacity: 0.07,
    stroke: MINT,
    footerRule: 'rgba(255,255,255,0.18)',
  },
  success: {
    bg: BRAND.white,
    fg: NAVY,
    accent: GREEN,
    muted: SLATE,
    dark: false,
    ring: `linear-gradient(135deg, ${BRAND.gold} 0%, ${GREEN} 100%)`,
    shadow: '0 24px 48px rgba(146,64,14,0.2)',
    chipBg: BRAND.tintNavy,
    chipFg: NAVY,
    ctaStyle: 'fill',
    ctaBg: GREEN,
    ctaFg: BRAND.white,
    blobs: [BRAND.gold, MINT],
    blobOpacity: 0.1,
    stroke: BRAND.gold,
    footerRule: NEUTRAL.slate200,
  },
  announcement: {
    bg: NAVY,
    fg: BRAND.white,
    accent: MINT,
    muted: NEUTRAL.slate300,
    dark: true,
    ring: `linear-gradient(135deg, ${BRAND.white} 0%, ${BRAND.white} 100%)`,
    shadow: '0 24px 52px rgba(0,0,0,0.4)',
    chipBg: BRAND.white,
    chipFg: NAVY,
    ctaStyle: 'outline',
    ctaBg: NAVY,
    ctaFg: MINT,
    blobs: [MINT, BRAND.white],
    blobOpacity: 0.07,
    stroke: MINT,
    footerRule: 'rgba(255,255,255,0.18)',
  },
}

// --- sizes per format ----------------------------------------------------------

type Sizes = {
  logo: number
  headMax: number
  headMin: number
  sub: number
  subLines: number
  occasionMax: number
  nameMax: number
  nameMin: number
  chip: number
  cta: number
  /** Footer scale (1 = the band's base sizes). */
  foot: number
  gap: number
  ringMax: number
  ringMin: number
  /** Width of the words column. */
  textWidth: number
}

const SIZES: Record<SocialFormat, Sizes> = {
  square: { logo: 40, headMax: 92, headMin: 42, sub: 28, subLines: 1, occasionMax: 48, nameMax: 54, nameMin: 34, chip: 25, cta: 28, foot: 0.54, gap: 14, ringMax: 470, ringMin: 270, textWidth: 936 },
  story: { logo: 60, headMax: 124, headMin: 56, sub: 40, subLines: 2, occasionMax: 66, nameMax: 76, nameMin: 46, chip: 32, cta: 38, foot: 0.76, gap: 30, ringMax: 580, ringMin: 420, textWidth: 936 },
  wide: { logo: 32, headMax: 66, headMin: 30, sub: 22, subLines: 2, occasionMax: 34, nameMax: 42, nameMin: 28, chip: 20, cta: 23, foot: 0.5, gap: 13, ringMax: 310, ringMin: 220, textWidth: 640 },
}

const HEAD_LH = 1.06
const NAME_LH = 1.1
const SUB_LH = 1.3

// --- small pieces --------------------------------------------------------------

// "TutorMint" is one word rendered as two coloured runs; satori inserts a
// word-space (~0.273em) between them that a negative right margin pulls back.
function Wordmark({ size, dark }: { size: number; dark: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline' }}>
      <div style={{ fontSize: size, fontWeight: 800, color: dark ? BRAND.white : BRAND.black, marginRight: -Math.round(size * 0.273) }}>Tutor</div>
      <div style={{ fontSize: size, fontWeight: 800, color: dark ? MINT : BRAND.red }}>Mint</div>
    </div>
  )
}

function Tick({ size, color, stroke = 3.2 }: { size: number; color: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 12.5l5 5L19.5 7" />
    </svg>
  )
}

function Arrow({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function PinIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12z M12 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
    </svg>
  )
}

/** A party popper — the 🎉 of "Congratulations 🎉", drawn (emoji are not in the font). */
function Confetti({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path d="M6 42 L17 13 L35 31 Z" fill={BRAND.gold} />
      <path d="M10.5 30 L14 21 L26 33 L17 36.5 Z" fill={BRAND.red} />
      <circle cx="30" cy="9" r="2.6" fill={GREEN} />
      <circle cx="41" cy="20" r="2.6" fill={NAVY} />
      <circle cx="38" cy="7" r="2" fill={BRAND.red} />
      <path d="M24 16 C 26 10, 31 12, 33 6" stroke={GREEN} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M32 24 C 37 22, 39 27, 44 25" stroke={BRAND.gold} strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/** Three short accent strokes, like a little burst — sits beside the headline. */
function Strokes({ size, color, flip }: { size: number; color: string; flip?: boolean }) {
  return (
    <svg width={size} height={size} style={{ marginTop: Math.round(size * 0.1) }} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round">
      <path d={flip ? 'M4 4 L8 9 M2 13 L7.5 13.5 M12 2 L11.5 7.5' : 'M20 4 L16 9 M22 13 L16.5 13.5 M12 2 L12.5 7.5'} />
    </svg>
  )
}

function Marks({ size, gap }: { size: number; gap: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap }}>
      <img src={SOCIAL_MARKS.facebook} width={size} height={size} alt="" />
      <img src={SOCIAL_MARKS.instagram} width={size} height={size} alt="" />
      <img src={SOCIAL_MARKS.youtube} width={size} height={size} alt="" />
      <img src={SOCIAL_MARKS.tiktok} width={size} height={size} alt="" />
    </div>
  )
}

/** The footer's height for a scale (kept in step with BrandFooter). */
function footerHeight(s: number): number {
  return Math.round(132 * s) + Math.round(22 * s) + 2
}

/** The small, light brand footer — identical content on every template and format. */
function BrandFooter({ theme, qrDataUri, s }: { theme: Theme; qrDataUri: string; s: number }) {
  const qr = Math.round(132 * s)
  const muted = theme.muted
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Math.round(20 * s),
        borderTop: `2px solid ${theme.footerRule}`,
        paddingTop: Math.round(22 * s),
        height: footerHeight(s),
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(8 * s) }}>
        <Wordmark size={Math.round(36 * s)} dark={theme.dark} />
        <div style={{ display: 'flex', fontSize: Math.round(24 * s), fontWeight: 700, color: theme.dark ? MINT : NAVY }}>{TAGLINE}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(12 * s), fontSize: Math.round(20 * s), fontWeight: 500, color: muted }}>
          <div style={{ display: 'flex', fontWeight: 700 }}>{SITE}</div>
          <div style={{ display: 'flex' }}>·</div>
          <div style={{ display: 'flex' }}>{HANDLE}</div>
          <Marks size={Math.round(28 * s)} gap={Math.round(9 * s)} />
          <div style={{ display: 'flex' }}>{X_HANDLE}</div>
        </div>
      </div>
      <img src={qrDataUri} width={qr} height={qr} alt="" style={theme.dark ? { borderRadius: Math.round(10 * s), border: `${Math.max(2, Math.round(4 * s))}px solid ${BRAND.white}` } : { borderRadius: Math.round(10 * s) }} />
    </div>
  )
}

/** Lines of words; accent words in the theme's green. `tail` draws after the last word. */
function Lines({
  lines,
  size,
  weight,
  lh,
  color,
  accent,
  align,
  tail,
}: {
  lines: Word[][]
  size: number
  weight: 500 | 700 | 800
  lh: number
  color: string
  accent: string
  align: 'center' | 'flex-start'
  tail?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align }}>
      {lines.map((line, li) => (
        <div key={li} style={{ display: 'flex', alignItems: 'center', height: Math.round(size * lh), fontSize: size, fontWeight: weight, letterSpacing: weight === 800 ? -0.5 : 0 }}>
          {runs(line).map((r, ri) => (
            <div key={ri} style={{ display: 'flex', color: r.accent ? accent : color, marginLeft: ri === 0 ? 0 : Math.round(textWidth(' ', size, weight)) }}>
              {r.text}
            </div>
          ))}
          {li === lines.length - 1 && tail ? <div style={{ display: 'flex', marginLeft: Math.round(size * 0.18) }}>{tail}</div> : null}
        </div>
      ))}
    </div>
  )
}

/** Join consecutive words of the same colour into one text run. */
function runs(line: Word[]): { text: string; accent: boolean }[] {
  const out: { text: string; accent: boolean }[] = []
  for (const w of line) {
    const last = out[out.length - 1]
    if (last && last.accent === !!w.accent) last.text += ' ' + w.text
    else out.push({ text: w.text, accent: !!w.accent })
  }
  return out
}

/** The framed photo: gradient ring, a gap, the photo, a soft shadow, the ✓ badge. */
function FramedPhoto({ src, size, theme, verified }: { src: string; size: number; theme: Theme; verified: boolean }) {
  const ring = Math.max(6, Math.round(size * 0.028))
  const gapPx = Math.max(5, Math.round(size * 0.022))
  const photo = size - 2 * (ring + gapPx)
  const badge = Math.round(size * 0.17)
  const r = size / 2
  const badgeCentre = r + r * 0.7071
  return (
    <div style={{ display: 'flex', position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div
        style={{
          display: 'flex',
          width: size,
          height: size,
          borderRadius: size,
          backgroundImage: theme.ring,
          padding: ring,
          boxShadow: theme.shadow,
        }}
      >
        <div style={{ display: 'flex', width: size - 2 * ring, height: size - 2 * ring, borderRadius: size, background: theme.bg, padding: gapPx }}>
          <img src={src} alt="" width={photo} height={photo} style={{ width: photo, height: photo, borderRadius: photo, objectFit: 'cover' }} />
        </div>
      </div>
      {verified ? (
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            left: Math.round(badgeCentre - badge / 2),
            top: Math.round(badgeCentre - badge / 2),
            width: badge,
            height: badge,
            borderRadius: badge,
            background: GREEN,
            border: `${Math.max(3, Math.round(badge * 0.09))}px solid ${BRAND.white}`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Tick size={Math.round(badge * 0.58)} color={BRAND.white} stroke={3.6} />
        </div>
      ) : null}
    </div>
  )
}

function Chip({ label, size, theme }: { label: string; size: number; theme: Theme }) {
  return (
    <div
      style={{
        display: 'flex',
        padding: `${Math.round(size * 0.34)}px ${Math.round(size * 0.78)}px`,
        borderRadius: 999,
        background: theme.chipBg,
        color: theme.chipFg,
        fontSize: size,
        fontWeight: 700,
        lineHeight: 1.15,
      }}
    >
      {label}
    </div>
  )
}

/** Height of a chip row (kept in step with Chip). */
const chipRowHeight = (size: number) => Math.round(size * 1.15 + 2 * size * 0.34) + 2

function chipWidth(label: string, size: number) {
  return textWidth(label, size, 700) + 2 * size * 0.78
}

/**
 * Subjects (up to three) and the city on ONE row: drop subjects from the end,
 * then shrink, until the row fits the width.
 */
function fitChipRow(subjects: string[], city: string | null, base: number, maxWidth: number) {
  const cityWidth = (size: number) => (city ? textWidth(city, size, 700) + size * 1.5 : 0)
  for (let size = base; size >= Math.round(base * 0.7); size -= 1) {
    for (let n = subjects.length; n >= Math.min(1, subjects.length); n--) {
      const shown = subjects.slice(0, n)
      const gap = size * 0.4
      const w = shown.reduce((acc, s) => acc + chipWidth(s, size), 0) + Math.max(0, shown.length - 1) * gap + (city ? (shown.length ? size * 0.9 : 0) + cityWidth(size) : 0)
      if (w <= maxWidth) return { size, shown }
    }
  }
  return { size: Math.round(base * 0.7), shown: subjects.slice(0, 1) }
}

function CtaPill({ label, site, size, theme }: { label: string; site: string; size: number; theme: Theme }) {
  const filled = theme.ctaStyle === 'fill'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: Math.round(size * 0.4),
        background: filled ? theme.ctaBg : 'transparent',
        color: theme.ctaFg,
        border: `${Math.max(2, Math.round(size * 0.11))}px solid ${filled ? theme.ctaBg : theme.ctaFg}`,
        borderRadius: 999,
        padding: `${Math.round(size * 0.5)}px ${Math.round(size * 1.1)}px`,
        fontSize: size,
        fontWeight: 600,
        lineHeight: 1.1,
      }}
    >
      <div style={{ display: 'flex', fontWeight: 700 }}>{label}</div>
      <Arrow size={Math.round(size * 1.05)} color={theme.ctaFg} />
      <div style={{ display: 'flex', fontWeight: 800 }}>{site}</div>
    </div>
  )
}

const ctaHeight = (size: number) => Math.round(size * 1.1 + 2 * size * 0.5 + 2 * Math.max(2, Math.round(size * 0.11)))

function Logo({ size, logoDataUri, dark }: { size: number; logoDataUri?: string | null; dark: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.25), height: size }}>
      {logoDataUri ? (
        // The monogram has black strokes: on a dark ground it sits on a white tile.
        <div style={{ display: 'flex', padding: dark ? Math.round(size * 0.14) : 0, background: dark ? BRAND.white : 'transparent', borderRadius: Math.round(size * 0.24) }}>
          <img src={logoDataUri} alt="" height={dark ? Math.round(size * 0.72) : size} width={Math.round((dark ? size * 0.72 : size) * (869 / 814))} />
        </div>
      ) : null}
      <Wordmark size={Math.round(size * 0.66)} dark={dark} />
    </div>
  )
}

/** Soft background shapes — corners only, low opacity, never strong enough to
 *  hurt the contrast of text that sits over them. */
function Decor({ w, h, theme }: { w: number; h: number; theme: Theme }) {
  const big = Math.round(Math.max(w, h) * 0.62)
  const small = Math.round(Math.min(w, h) * 0.5)
  return (
    <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: w, height: h }}>
      <div style={{ display: 'flex', position: 'absolute', width: big, height: big, borderRadius: big, background: theme.blobs[0], opacity: theme.blobOpacity, left: Math.round(w - big * 0.62), top: Math.round(-big * 0.5) }} />
      <div style={{ display: 'flex', position: 'absolute', width: small, height: small, borderRadius: small, background: theme.blobs[1], opacity: theme.blobOpacity, left: Math.round(-small * 0.45), top: Math.round(h - small * 0.62) }} />
    </div>
  )
}

// --- the layout ----------------------------------------------------------------

/**
 * Everything the layout needs, decided up front so the photo can take the rest.
 * Very long text (a long name AND a long headline) steps every word size down a
 * little until the whole post fits; the usual post is drawn at full size.
 */
function plan(p: BannerParams) {
  let last: ReturnType<typeof planAt> | null = null
  for (let k = 1; k >= 0.6; k -= 0.05) {
    last = planAt(p, k)
    if (last.fits) return last
  }
  return last as ReturnType<typeof planAt>
}

function planAt(p: BannerParams, k: number) {
  const { format, template } = p
  const base = SIZES[format]
  const sc = (n: number) => Math.round(n * k)
  const z: Sizes = {
    ...base,
    headMax: sc(base.headMax),
    headMin: Math.min(base.headMin, sc(base.headMax)),
    sub: sc(base.sub),
    occasionMax: sc(base.occasionMax),
    nameMax: sc(base.nameMax),
    nameMin: Math.min(base.nameMin, sc(base.nameMax)),
    chip: sc(base.chip),
    cta: sc(base.cta),
    gap: sc(base.gap),
  }
  const theme = THEMES[template]
  const data = toData(p)
  const { width: W, height: H } = FORMATS[format]
  const m = SAFE_MARGIN[format]
  const isWide = format === 'wide'
  const textW = isWide ? z.textWidth : W - 2 * m.x

  // Headline: two lines at most; the verified tick and the confetti draw after
  // the last word, so their width is reserved.
  const head = headlineFor(template, data)
  const headWords: Word[] = head.accentAll
    ? plainWords(head.text).map((w) => ({ ...w, accent: true }))
    : head.accentWords > 0
      ? accentTail(head.text, head.accentWords)
      : plainWords(head.text)
  const tailFactor = head.tail === 'tick' ? 0.98 : head.tail === 'confetti' ? 1.08 : 0
  const strokeRoom = isWide ? 0 : z.headMax * 1.15
  let headFit = fitWords(headWords, { max: z.headMax, min: z.headMin, weight: 800, maxWidth: Math.round((textW - strokeRoom) * 0.97), maxLines: 2, tail: tailFactor * z.headMax })
  // Re-fit with the tail sized to the chosen size (it shrinks with the text).
  headFit = fitWords(headWords, { max: headFit.size, min: z.headMin, weight: 800, maxWidth: Math.round((textW - strokeRoom) * 0.97), maxLines: 2, tail: tailFactor * headFit.size })

  const occasion = occasionFor(template, data)
  const occFit = occasion ? fitWords(plainWords(occasion), { max: z.occasionMax, min: Math.round(z.occasionMax * 0.6), weight: 800, maxWidth: textW, maxLines: 2 }) : null

  const sub = subLineFor(template, data)
  let subFit = sub ? fitWords(plainWords(sub), { max: z.sub, min: Math.round(z.sub * 0.8), weight: 500, maxWidth: textW, maxLines: z.subLines }) : null

  const nameFit = fitWords(plainWords(data.name || 'Tutor'), { max: z.nameMax, min: z.nameMin, weight: 800, maxWidth: textW, maxLines: 2 })

  const subjects = subjectLabels(data.subjects)
  const city = data.city?.trim() || null
  const chips = fitChipRow(subjects, city, z.chip, textW)
  const pills = p.badges.filter((b) => b !== 'Verified')
  const pillSize = Math.round(z.chip * 0.85)
  const pillsWidth = pills.reduce((acc, b) => acc + textWidth(b, pillSize, 800) + 2 * pillSize * 0.78 + pillSize * 0.4, 0)
  const nameWidth = textWidth(nameFit.lines[0].map((w) => w.text).join(' '), nameFit.size, 800)
  // Plan badges (Premium / Featured) sit beside a one-line name when they fit.
  const pillsInline = pills.length > 0 && nameFit.lines.length === 1 && nameWidth + pillSize * 0.7 + pillsWidth <= textW

  const cta = ctaParts(template, data)
  const ctaSize = (() => {
    let s = z.cta
    const w = (size: number) => textWidth(cta.label, size, 700) + textWidth(cta.site, size, 800) + size * 1.05 + 2 * size * 0.4 + 2 * size * 1.1
    while (s > z.cta * 0.7 && w(s) > textW) s -= 1
    return s
  })()

  const dateChip = template === 'announcement' && p.dateLabel?.trim() ? p.dateLabel.trim() : null

  // Heights of the blocks, matching the render's own structure.
  const hFoot = footerHeight(z.foot)
  const hHead = Math.round(headFit.lines.length * headFit.size * HEAD_LH)
  const hOcc = occFit ? Math.round(occFit.lines.length * occFit.size * HEAD_LH) : 0
  const hName = Math.round(nameFit.lines.length * nameFit.size * NAME_LH)
  const hPills = pills.length ? chipRowHeight(pillSize) : 0
  const hChips = chips.shown.length || city ? chipRowHeight(chips.size) : 0
  const hCta = ctaHeight(ctaSize)
  const stack = (hs: number[], gap: number) => {
    const xs = hs.filter((h) => h > 0)
    return xs.reduce((a, b) => a + b, 0) + Math.max(0, xs.length - 1) * gap
  }
  const wordsH = (withSub: boolean) =>
    stack([z.logo, dateChip ? chipRowHeight(z.chip) : 0, hHead, hOcc, withSub && subFit ? Math.round(subFit.lines.length * subFit.size * SUB_LH) : 0], z.gap)
  const whoH = stack([pillsInline ? Math.max(hName, hPills) : hName, pillsInline ? 0 : hPills, hChips], Math.round(z.gap * 0.7))
  const minSpace = Math.round(z.gap * 1.3)
  const rawRing = (withSub: boolean) => H - 2 * m.y - (wordsH(withSub) + whoH + hCta + hFoot + z.gap + 3 * minSpace)
  const ringFor = (withSub: boolean) => Math.max(z.ringMin, Math.min(z.ringMax, rawRing(withSub)))

  let ring: number
  let fits: boolean
  if (isWide) {
    ring = Math.min(z.ringMax, H - 2 * m.y - hFoot - z.gap)
    // The right column: words, the tutor and the CTA, as the render stacks them.
    const rightH = stack([wordsH(true), whoH, hCta], Math.round(z.gap * 1.4))
    fits = rightH <= H - 2 * m.y - hFoot - z.gap
  } else {
    ring = ringFor(true)
    // On a square the photo matters more than a sub-line: drop the line when
    // keeping it would shrink the photo below about 37% of the width.
    // Only a standard line is dropped — never what the admin typed.
    const subIsAdmin = template === 'announcement' ? !!p.subhead?.trim() : !!p.headline?.trim()
    let withSub = true
    if (format === 'square' && subFit && !subIsAdmin && ring < 400) {
      subFit = null
      withSub = false
      ring = ringFor(false)
    }
    fits = rawRing(withSub) >= z.ringMin
  }

  return { theme, data, W, H, m, isWide, textW, z, head, headFit, occFit, subFit, nameFit, chips, city, pills, pillsInline, cta, ctaSize, dateChip, ring, hFoot, fits }
}

function render(p: BannerParams) {
  const L = plan(p)
  const { theme, z, W, H, m, isWide } = L
  const align = isWide ? 'flex-start' : 'center'
  const verified = p.verified ?? p.badges.includes('Verified')
  const src = p.tutor.avatar_url || silhouetteDataUri(p.tutor.gender ?? null)

  const headTail =
    L.head.tail === 'tick' ? (
      <Tick size={Math.round(L.headFit.size * 0.8)} color={theme.accent} stroke={3.6} />
    ) : L.head.tail === 'confetti' ? (
      <Confetti size={Math.round(L.headFit.size * 0.9)} />
    ) : undefined

  const strokeSize = Math.round(L.headFit.size * 0.42)
  const headline = (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: Math.round(strokeSize * 0.15) }}>
      {!isWide ? <Strokes size={strokeSize} color={theme.stroke} flip /> : null}
      <Lines lines={L.headFit.lines} size={L.headFit.size} weight={800} lh={HEAD_LH} color={theme.fg} accent={theme.accent} align={align} tail={headTail} />
      {!isWide ? <Strokes size={strokeSize} color={theme.stroke} /> : null}
    </div>
  )

  const dateChip = L.dateChip ? (
    <div style={{ display: 'flex', padding: `${Math.round(z.chip * 0.34)}px ${Math.round(z.chip * 0.78)}px`, borderRadius: 999, background: BRAND.gold, color: BRAND.black, fontSize: z.chip, fontWeight: 800, lineHeight: 1.15 }}>
      {L.dateChip}
    </div>
  ) : null

  const occasion = L.occFit ? <Lines lines={L.occFit.lines} size={L.occFit.size} weight={800} lh={HEAD_LH} color={theme.fg} accent={theme.accent} align={align} /> : null
  const sub = L.subFit ? <Lines lines={L.subFit.lines} size={L.subFit.size} weight={500} lh={SUB_LH} color={theme.muted} accent={theme.accent} align={align} /> : null
  const name = <Lines lines={L.nameFit.lines} size={L.nameFit.size} weight={800} lh={NAME_LH} color={theme.fg} accent={theme.accent} align={align} />

  const pillSize = Math.round(z.chip * 0.85)
  const pills = L.pills.length ? (
    <div style={{ display: 'flex', gap: Math.round(pillSize * 0.4) }}>
      {L.pills.map((b) => (
        <div
          key={b}
          style={{
            display: 'flex',
            padding: `${Math.round(pillSize * 0.34)}px ${Math.round(pillSize * 0.78)}px`,
            borderRadius: 999,
            fontSize: pillSize,
            fontWeight: 800,
            lineHeight: 1.15,
            background: b === 'Featured' ? BRAND.gold : theme.dark ? BRAND.white : NAVY,
            color: b === 'Featured' ? BRAND.black : theme.dark ? NAVY : BRAND.white,
          }}
        >
          {b}
        </div>
      ))}
    </div>
  ) : null

  const chipRow =
    L.chips.shown.length || L.city ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(L.chips.size * 0.4), justifyContent: align }}>
        {L.chips.shown.map((s) => (
          <Chip key={s} label={s} size={L.chips.size} theme={theme} />
        ))}
        {L.city ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(L.chips.size * 0.25), marginLeft: L.chips.shown.length ? Math.round(L.chips.size * 0.5) : 0, fontSize: L.chips.size, fontWeight: 700, color: theme.fg }}>
            <PinIcon size={Math.round(L.chips.size * 1.1)} color={theme.accent} />
            <div style={{ display: 'flex' }}>{L.city}</div>
          </div>
        ) : null}
      </div>
    ) : null

  const cta = <CtaPill label={L.cta.label} site={L.cta.site} size={L.ctaSize} theme={theme} />
  const logo = <Logo size={z.logo} logoDataUri={p.logoDataUri} dark={theme.dark} />
  const photo = <FramedPhoto src={src} size={L.ring} theme={theme} verified={verified} />
  const footer = <BrandFooter theme={theme} qrDataUri={p.qrDataUri} s={z.foot} />

  const words = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, gap: z.gap }}>
      {logo}
      {dateChip}
      {headline}
      {occasion}
      {sub}
    </div>
  )
  const who = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, gap: Math.round(z.gap * 0.7) }}>
      {L.pillsInline ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(pillSize * 0.7) }}>
          {name}
          {pills}
        </div>
      ) : (
        name
      )}
      {L.pillsInline ? null : pills}
      {chipRow}
    </div>
  )

  return (
    <div style={{ width: W, height: H, display: 'flex', position: 'relative', overflow: 'hidden', background: theme.bg, fontFamily: 'Jakarta' }}>
      <Decor w={W} h={H} theme={theme} />
      <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: m.x, top: m.y, width: W - 2 * m.x, height: H - 2 * m.y }}>
        {isWide ? (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 48, paddingBottom: z.gap }}>
            {photo}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: Math.round(z.gap * 1.4), width: L.textW }}>
              {words}
              {who}
              {cta}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', paddingBottom: z.gap }}>
            {words}
            {photo}
            {who}
            {cta}
          </div>
        )}
        {footer}
      </div>
    </div>
  )
}

export function renderSocialBanner(params: BannerParams): Response {
  const { width, height } = FORMATS[params.format]
  return new ImageResponse(render(params), { width, height, fonts: fonts() })
}

// Re-exported so callers keep one import surface.
export { bandTextLines, WORDMARK }

/** The ground colour of a template (the margin test compares against it). */
export function templateBackground(template: SocialTemplate): string {
  return THEMES[template].bg
}
