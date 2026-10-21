import { BRAND, NEUTRAL } from '@/lib/brand'
import type { BadgeName } from '@/lib/planBadges'
import { SOCIAL_MARKS } from '@/lib/social/marks'
import { CAVEAT_700_B64, JAKARTA_500_B64, JAKARTA_700_B64, JAKARTA_800_B64 } from '@/lib/social/fonts'
import { GEIST_REGULAR_DATA_URI } from '@/lib/cv/font'
import { textWidth, type Word } from '@/lib/social/fit'
import {
  buildCaption,
  HANDLE,
  SITE,
  TAGLINE,
  X_HANDLE,
  type SocialData,
  type SocialFormat,
  type SocialTemplate,
} from '@/lib/social/copy'

// Shared pieces of the social render (PR C3): formats, margins, fonts, the
// render params, and the small drawn parts every layout uses — the wordmark,
// the logo, the ringed photo, chips, the CTA pill and the brand footer.
// ./render.tsx (the C2 layout) and ./layouts.tsx (the seven C3 layouts) both
// build from these, so a footer or a badge cannot differ between templates.

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

export const NAVY = BRAND.navy
export const GREEN = BRAND.greenDeep
export const MINT = BRAND.mint
export const SLATE = NEUTRAL.slate700

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
  /** PR C3 — the colour look (lib/social/templates.ts variants), default 0. */
  variant?: number
  /** PR C3 — the tutor's subjects as level + subject (the subject template). */
  subjectParts?: { level: string; subject: string | null }[]
  /** PR C3 — group only: the city and its 4–6 verified tutors, photos already
   *  cropped (a hidden photo is the grey silhouette). */
  group?: { city: string; tutors: GroupTutor[] } | null
  /** Replace the template's CTA (the tutor link preview: "View profile"). */
  cta?: { label: string; site: string }
}

export type GroupTutor = { slug: string; name: string; subject: string | null; avatar_url: string; gender?: string | null }

/** Turn render params into the pure SocialData the copy helpers read. */
export function toData(p: BannerParams): SocialData {
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
    subjectParts: p.subjectParts,
    group: p.group ? { city: p.group.city, tutors: p.group.tutors.map((t) => ({ name: t.name, subject: t.subject })) } : null,
  }
}

/** The caption for the admin box — same data, so what's pasted matches the art. */
export function socialCaption(p: BannerParams): string {
  return buildCaption(p.template, toData(p))
}

// --- fonts -------------------------------------------------------------------

export const b64ToArrayBuffer = (b64: string): ArrayBuffer => {
  const buf = Buffer.from(b64, 'base64')
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

let FONTS: { name: string; data: ArrayBuffer; weight: 400 | 500 | 700 | 800; style: 'normal' }[] | null = null
export function fonts() {
  if (!FONTS) {
    FONTS = [
      { name: 'Jakarta', data: b64ToArrayBuffer(JAKARTA_500_B64), weight: 500, style: 'normal' },
      { name: 'Jakarta', data: b64ToArrayBuffer(JAKARTA_700_B64), weight: 700, style: 'normal' },
      { name: 'Jakarta', data: b64ToArrayBuffer(JAKARTA_800_B64), weight: 800, style: 'normal' },
      // The Polaroid's handwritten name (PR C3).
      { name: 'Hand', data: b64ToArrayBuffer(CAVEAT_700_B64), weight: 700, style: 'normal' },
      // Fallback for any glyph outside the Latin subset.
      { name: 'Geist', data: b64ToArrayBuffer(GEIST_REGULAR_DATA_URI.split(',')[1]), weight: 400, style: 'normal' },
    ]
  }
  return FONTS
}

// --- themes ------------------------------------------------------------------

export type Theme = {
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

export const HEAD_LH = 1.06
export const NAME_LH = 1.1
export const SUB_LH = 1.3

// --- small pieces --------------------------------------------------------------

// "TutorMint" is one word rendered as two coloured runs; satori inserts a
// word-space (~0.273em) between them that a negative right margin pulls back.
export function Wordmark({ size, dark }: { size: number; dark: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline' }}>
      <div style={{ fontSize: size, fontWeight: 800, color: dark ? BRAND.white : BRAND.black, marginRight: -Math.round(size * 0.273) }}>Tutor</div>
      <div style={{ fontSize: size, fontWeight: 800, color: dark ? MINT : BRAND.red }}>Mint</div>
    </div>
  )
}

export function Tick({ size, color, stroke = 3.2 }: { size: number; color: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 12.5l5 5L19.5 7" />
    </svg>
  )
}

export function Arrow({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function PinIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12z M12 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
    </svg>
  )
}

/** A party popper — the 🎉 of "Congratulations 🎉", drawn (emoji are not in the font). */
export function Confetti({ size }: { size: number }) {
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
export function Strokes({ size, color, flip }: { size: number; color: string; flip?: boolean }) {
  return (
    <svg width={size} height={size} style={{ marginTop: Math.round(size * 0.1) }} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round">
      <path d={flip ? 'M4 4 L8 9 M2 13 L7.5 13.5 M12 2 L11.5 7.5' : 'M20 4 L16 9 M22 13 L16.5 13.5 M12 2 L12.5 7.5'} />
    </svg>
  )
}

export function Marks({ size, gap }: { size: number; gap: number }) {
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
export function footerHeight(s: number): number {
  return Math.round(132 * s) + Math.round(22 * s) + 2
}

/** The small, light brand footer — identical content on every template and format. */
/** `qr: false` leaves the QR out — the ID card carries the same QR on the card. */
export function BrandFooter({ theme, qrDataUri, s, qr: showQr = true }: { theme: Theme; qrDataUri: string; s: number; qr?: boolean }) {
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
      {showQr ? <img src={qrDataUri} width={qr} height={qr} alt="" style={theme.dark ? { borderRadius: Math.round(10 * s), border: `${Math.max(2, Math.round(4 * s))}px solid ${BRAND.white}` } : { borderRadius: Math.round(10 * s) }} /> : null}
    </div>
  )
}

/** Lines of words; accent words in the theme's green. `tail` draws after the last word. */
export function Lines({
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
export function runs(line: Word[]): { text: string; accent: boolean }[] {
  const out: { text: string; accent: boolean }[] = []
  for (const w of line) {
    const last = out[out.length - 1]
    if (last && last.accent === !!w.accent) last.text += ' ' + w.text
    else out.push({ text: w.text, accent: !!w.accent })
  }
  return out
}

/** The framed photo: gradient ring, a gap, the photo, a soft shadow, the ✓ badge. */
export function FramedPhoto({ src, size, theme, verified }: { src: string; size: number; theme: Theme; verified: boolean }) {
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

export function Chip({ label, size, theme }: { label: string; size: number; theme: Theme }) {
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
export const chipRowHeight = (size: number) => Math.round(size * 1.15 + 2 * size * 0.34) + 2

export function chipWidth(label: string, size: number) {
  return textWidth(label, size, 700) + 2 * size * 0.78
}

/**
 * Subjects (up to three) and the city on ONE row: drop subjects from the end,
 * then shrink, until the row fits the width.
 */
export function fitChipRow(subjects: string[], city: string | null, base: number, maxWidth: number) {
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

export function CtaPill({ label, site, size, theme }: { label: string; site: string; size: number; theme: Theme }) {
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

export const ctaHeight = (size: number) => Math.round(size * 1.1 + 2 * size * 0.5 + 2 * Math.max(2, Math.round(size * 0.11)))

export function Logo({ size, logoDataUri, dark }: { size: number; logoDataUri?: string | null; dark: boolean }) {
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
export function Decor({ w, h, theme }: { w: number; h: number; theme: Theme }) {
  const big = Math.round(Math.max(w, h) * 0.62)
  const small = Math.round(Math.min(w, h) * 0.5)
  return (
    <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: w, height: h }}>
      <div style={{ display: 'flex', position: 'absolute', width: big, height: big, borderRadius: big, background: theme.blobs[0], opacity: theme.blobOpacity, left: Math.round(w - big * 0.62), top: Math.round(-big * 0.5) }} />
      <div style={{ display: 'flex', position: 'absolute', width: small, height: small, borderRadius: small, background: theme.blobs[1], opacity: theme.blobOpacity, left: Math.round(-small * 0.45), top: Math.round(h - small * 0.62) }} />
    </div>
  )
}
