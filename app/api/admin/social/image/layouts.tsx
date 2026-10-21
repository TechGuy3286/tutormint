import type { ReactNode } from 'react'
import { BRAND, NEUTRAL } from '@/lib/brand'
import { silhouetteDataUri } from '@/lib/social/avatars'
import { accentTail, fitWords, plainWords, textWidth, type Weight, type Word } from '@/lib/social/fit'
import {
  ctaParts,
  headlineFor,
  IDCARD_SEAL,
  IDCARD_TITLE,
  ownWords,
  subjectLabels,
  subjectWord,
  subLineFor,
  type SocialData,
  type SocialFormat,
  type SocialTemplate,
} from '@/lib/social/copy'
import { clampVariant } from '@/lib/social/templates'
import {
  FORMATS,
  SAFE_MARGIN,
  NAVY,
  GREEN,
  MINT,
  SLATE,
  BrandFooter,
  CtaPill,
  Decor,
  FramedPhoto,
  Logo,
  PinIcon,
  Tick,
  chipWidth,
  ctaHeight,
  footerHeight,
  runs,
  toData,
  type BannerParams,
  type GroupTutor,
  type Theme,
} from './pieces'

// The seven PR C3 layouts (owner, 21 Oct 2026). Each template has a layout of
// its own — not a recolour of the C2 stack:
//
//   split         a large rounded photo filling one half, the words beside it
//   idcard        a tutor card: photo, name, subjects, city, a "Verified by
//                 TutorMint" seal and the profile QR. Never a government ID:
//                 no CNIC, no date of birth, no phone, navy (not NADRA green)
//   quote         the tutor's OWN profile headline as a big quote
//   subject       the top subject as a huge low-contrast background word
//   group         4–6 verified tutors from one city in a grid
//   justverified  text only — no photo at all
//   polaroid      a tilted print, the name handwritten under the photo
//
// HOW EVERYTHING FITS. The safe area (SAFE_MARGIN, 6%+ a side) holds the body
// and the brand footer; the body is built as a stack of blocks whose heights
// are known before satori draws them (text wrapped with the font's own widths,
// lib/social/fit.ts). When the blocks do not fit, every size steps down by 5%
// until they do. The safe area also clips (overflow hidden), so whatever the
// text, nothing can ever reach the margins. scripts/test-social-verified.ts
// renders 12 templates × 3 formats with a very long name and headline.
//
// Colours: brand literals from lib/brand.ts (navy, green, white, soft greys;
// gold only on the celebratory Just verified). Every text pair is listed in
// scripts/contrast-check.ts.

export type LayoutTemplate = 'split' | 'idcard' | 'quote' | 'subject' | 'group' | 'justverified' | 'polaroid'

const LAYOUTS: LayoutTemplate[] = ['split', 'idcard', 'quote', 'subject', 'group', 'justverified', 'polaroid']

export function isLayoutTemplate(t: SocialTemplate): t is LayoutTemplate {
  return (LAYOUTS as string[]).includes(t)
}

// ---- themes: two colour looks each -------------------------------------------

const light = (bg: string, over: Partial<Theme> = {}): Theme => ({
  bg,
  fg: NAVY,
  accent: GREEN,
  muted: SLATE,
  dark: false,
  ring: `linear-gradient(135deg, ${NAVY} 0%, ${GREEN} 100%)`,
  shadow: '0 12px 24px rgba(21,30,107,0.14)',
  chipBg: BRAND.tintNavy,
  chipFg: NAVY,
  ctaStyle: 'fill',
  ctaBg: GREEN,
  ctaFg: BRAND.white,
  blobs: [MINT, NAVY],
  blobOpacity: 0.1,
  stroke: GREEN,
  footerRule: NEUTRAL.slate200,
  ...over,
})

const dark = (over: Partial<Theme> = {}): Theme => ({
  bg: NAVY,
  fg: BRAND.white,
  accent: MINT,
  muted: NEUTRAL.slate300,
  dark: true,
  ring: `linear-gradient(135deg, ${MINT} 0%, ${GREEN} 100%)`,
  shadow: '0 12px 26px rgba(0,0,0,0.3)',
  chipBg: BRAND.white,
  chipFg: NAVY,
  ctaStyle: 'fill',
  ctaBg: MINT,
  ctaFg: NAVY,
  blobs: [MINT, BRAND.white],
  blobOpacity: 0.07,
  stroke: MINT,
  footerRule: 'rgba(255,255,255,0.18)',
  ...over,
})

const THEMES: Record<LayoutTemplate, Theme[]> = {
  split: [light(BRAND.white), dark()],
  idcard: [light(BRAND.tintNavy, { blobs: [BRAND.white, NAVY], blobOpacity: 0.12 }), dark()],
  quote: [light(BRAND.tintGreen, { chipBg: BRAND.white, blobs: [MINT, GREEN], blobOpacity: 0.14, ring: `linear-gradient(135deg, ${GREEN} 0%, ${MINT} 100%)` }), dark()],
  subject: [light(BRAND.white, { blobs: [BRAND.tintNavy, MINT] }), dark()],
  group: [light(BRAND.bg), dark({ ring: `linear-gradient(135deg, ${BRAND.white} 0%, ${MINT} 100%)` })],
  justverified: [
    light(BRAND.white, { blobs: [BRAND.gold, MINT], blobOpacity: 0.12, stroke: BRAND.gold }),
    dark({ blobs: [BRAND.gold, MINT], blobOpacity: 0.08, stroke: BRAND.gold }),
  ],
  polaroid: [
    light(NEUTRAL.slate100, { blobs: [MINT, NAVY], blobOpacity: 0.12, ctaStyle: 'fill', ctaBg: NAVY, ctaFg: BRAND.white }),
    light(BRAND.tintGreen, { blobs: [MINT, GREEN], blobOpacity: 0.16, chipBg: BRAND.white }),
  ],
}

function themeOf(t: LayoutTemplate, variant: number | undefined): Theme {
  return THEMES[t][clampVariant(t, variant)]
}

/** The ground colour of a template's look (the margin test compares against it). */
export function layoutBackground(t: LayoutTemplate, variant = 0): string {
  return themeOf(t, variant).bg
}

// ---- sizes -------------------------------------------------------------------

/** The footer scale per format (same as the C2 layout). */
const FOOT: Record<SocialFormat, number> = { square: 0.54, story: 0.76, wide: 0.5 }
/** The base text scale per format: 1 = the square's sizes. */
const SCALE: Record<SocialFormat, number> = { square: 1, story: 1.3, wide: 0.72 }

// ---- text blocks -------------------------------------------------------------

type Block = { h: number; node: ReactNode }

type TextOpts = {
  size: number
  min?: number
  weight?: Exclude<Weight, 'hand'>
  hand?: boolean
  lh?: number
  maxLines: number
  width: number
  color: string
  accent?: string
  align?: 'center' | 'flex-start'
  /** Drawn after the last word (a tick). `factor` = its width in em. */
  tail?: { factor: number; draw: (size: number) => ReactNode }
}

/** Wrap and size text to its box, and return its exact height and node. */
function textBlock(words: Word[], o: TextOpts): Block & { size: number } {
  const weight: Weight = o.hand ? 'hand' : (o.weight ?? 800)
  const lh = o.lh ?? 1.12
  const fit = fitWords(words, {
    max: Math.round(o.size),
    min: Math.round(o.min ?? o.size * 0.7),
    weight,
    maxWidth: Math.floor(o.width * 0.97),
    maxLines: o.maxLines,
    tail: o.tail ? o.tail.factor * o.size : 0,
  })
  const size = fit.size
  const space = textWidth(' ', size, weight)
  const node = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: o.align ?? 'center', width: o.width }}>
      {fit.lines.map((line, li) => (
        <div
          key={li}
          style={{
            display: 'flex',
            alignItems: 'center',
            height: Math.round(size * lh),
            fontSize: size,
            fontFamily: o.hand ? 'Hand' : 'Jakarta',
            fontWeight: o.hand ? 700 : weight === 'hand' ? 700 : weight,
            letterSpacing: !o.hand && weight === 800 ? -0.5 : 0,
          }}
        >
          {runs(line).map((r, ri) => (
            <div key={ri} style={{ display: 'flex', color: r.accent ? (o.accent ?? o.color) : o.color, marginLeft: ri === 0 ? 0 : Math.round(space) }}>
              {r.text}
            </div>
          ))}
          {li === fit.lines.length - 1 && o.tail ? <div style={{ display: 'flex', marginLeft: Math.round(size * 0.2) }}>{o.tail.draw(size)}</div> : null}
        </div>
      ))}
    </div>
  )
  return { h: Math.round(fit.lines.length * size * lh), node, size }
}

/** A headline's words with its green key words. */
function headWords(h: { text: string; accentWords: number; accentAll?: boolean }): Word[] {
  if (h.accentAll) return plainWords(h.text).map((w) => ({ ...w, accent: true }))
  return h.accentWords > 0 ? accentTail(h.text, h.accentWords) : plainWords(h.text)
}

/** Subject chips that wrap onto at most `maxLines` lines; subjects that do not
 *  fit are dropped from the end, then the size steps down. */
function chipsBlock(labels: string[], o: { size: number; width: number; theme: Theme; align: 'center' | 'flex-start'; maxLines?: number }): Block | null {
  if (!labels.length) return null
  const maxLines = o.maxLines ?? 2
  const layout = (size: number, list: string[]) => {
    const gap = size * 0.4
    const lines: string[][] = []
    let cur: string[] = []
    let w = 0
    for (const l of list) {
      const cw = Math.min(chipWidth(l, size), o.width)
      const next = cur.length ? w + gap + cw : cw
      if (cur.length && next > o.width) {
        lines.push(cur)
        cur = [l]
        w = cw
      } else {
        cur.push(l)
        w = next
      }
    }
    if (cur.length) lines.push(cur)
    return lines
  }
  let size = o.size
  let list = labels
  let lines = layout(size, list)
  for (let s = o.size; s >= Math.round(o.size * 0.75) && lines.length > maxLines; s -= 1) {
    size = s
    lines = layout(size, list)
  }
  while (lines.length > maxLines && list.length > 1) {
    list = list.slice(0, -1)
    lines = layout(size, list)
  }
  const rowH = Math.round(size * 1.15 + 2 * size * 0.34) + 2
  const gap = Math.round(size * 0.4)
  return {
    h: lines.length * rowH + (lines.length - 1) * gap,
    node: (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: o.align, gap, width: o.width }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', gap, justifyContent: o.align }}>
            {line.map((l) => (
              <div
                key={l}
                style={{
                  display: 'flex',
                  maxWidth: o.width,
                  overflow: 'hidden',
                  padding: `${Math.round(size * 0.34)}px ${Math.round(size * 0.78)}px`,
                  borderRadius: 999,
                  background: o.theme.chipBg,
                  color: o.theme.chipFg,
                  fontSize: size,
                  fontWeight: 700,
                  lineHeight: 1.15,
                }}
              >
                {l}
              </div>
            ))}
          </div>
        ))}
      </div>
    ),
  }
}

/** "📍 City" — a pin and the city name. */
function cityBlock(city: string | null, o: { size: number; width: number; color: string; pin: string; align: 'center' | 'flex-start' }): Block | null {
  if (!city) return null
  const size = Math.min(o.size, Math.floor((o.width * 0.9) / Math.max(1, textWidth(city, 1, 700) + 1.4)))
  return {
    h: Math.round(size * 1.3),
    node: (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: o.align, gap: Math.round(size * 0.25), height: Math.round(size * 1.3), width: o.width, fontSize: size, fontWeight: 700, color: o.color }}>
        <PinIcon size={Math.round(size * 1.1)} color={o.pin} />
        <div style={{ display: 'flex' }}>{city}</div>
      </div>
    ),
  }
}

/** The CTA pill, sized to its width. */
function ctaBlock(cta: { label: string; site: string }, o: { size: number; width: number; theme: Theme; align: 'center' | 'flex-start' }): Block {
  const w = (size: number) => textWidth(cta.label, size, 700) + textWidth(cta.site, size, 800) + size * 1.05 + 2 * size * 0.4 + 2 * size * 1.1
  let size = Math.round(o.size)
  while (size > 12 && w(size) > o.width) size -= 1
  return {
    h: ctaHeight(size),
    node: (
      <div style={{ display: 'flex', justifyContent: o.align, width: o.width }}>
        <CtaPill label={cta.label} site={cta.site} size={size} theme={o.theme} />
      </div>
    ),
  }
}

function logoBlock(size: number, p: BannerParams, theme: Theme, width: number, align: 'center' | 'flex-start'): Block {
  return {
    h: size,
    node: (
      <div style={{ display: 'flex', justifyContent: align, width }}>
        <Logo size={size} logoDataUri={p.logoDataUri} dark={theme.dark} />
      </div>
    ),
  }
}

/** A column of blocks of known height inside a box of `height`; the spare room
 *  is spread around them. */
function Stack({ blocks, width, height, gap, align }: { blocks: (Block | null)[]; width: number; height: number; gap: number; align: 'center' | 'flex-start' }) {
  const list = blocks.filter(Boolean) as Block[]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, justifyContent: 'space-around', width, height, gap, overflow: 'hidden' }}>
      {list.map((b, i) => (
        <div key={i} style={{ display: 'flex', flexShrink: 0, height: b.h, width, justifyContent: align, alignItems: 'center' }}>
          {b.node}
        </div>
      ))}
    </div>
  )
}

const stackHeight = (blocks: (Block | null)[], gap: number) => {
  const list = blocks.filter(Boolean) as Block[]
  return list.reduce((a, b) => a + b.h, 0) + Math.max(0, list.length - 1) * gap
}

/** Build at scale k = 1, 0.95, 0.9 … until the blocks fit `height`. */
function fitScale<T>(build: (k: number) => { blocks: (Block | null)[]; gap: number; extra?: number } & T, height: number) {
  let last = build(1)
  for (let k = 1; k >= 0.5; k -= 0.05) {
    last = build(k)
    if (stackHeight(last.blocks, last.gap) + (last.extra ?? 0) <= height) return last
  }
  return last
}

// ---- small drawn parts ---------------------------------------------------------

/** "✓ Verified by TutorMint" — the ID card's seal. */
function Seal({ size, color }: { size: number; color: string }) {
  const disc = Math.round(size * 1.7)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.45) }}>
      <div style={{ display: 'flex', width: disc, height: disc, borderRadius: disc, background: GREEN, alignItems: 'center', justifyContent: 'center', border: `${Math.max(2, Math.round(size * 0.12))}px solid ${BRAND.tintGreen}` }}>
        <Tick size={Math.round(disc * 0.6)} color={BRAND.white} stroke={3.6} />
      </div>
      <div style={{ display: 'flex', fontSize: size, fontWeight: 800, color }}>{IDCARD_SEAL}</div>
    </div>
  )
}

const sealWidth = (size: number) => size * 1.7 + size * 0.45 + textWidth(IDCARD_SEAL, size, 800)

/** A big decorative quote mark (drawn, so it never depends on a glyph). */
function QuoteMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={Math.round(size * 0.78)} viewBox="0 0 100 78">
      <path d="M0 78V46C0 20 12 4 38 0l4 12C28 16 22 26 22 38h18v40zM58 78V46C58 20 70 4 96 0l4 12C86 16 80 26 80 38h18v40z" fill={color} />
    </svg>
  )
}

/** A tutor's photo, or the grey silhouette (a hidden photo arrives as null). */
function photoSrc(p: BannerParams): string {
  return p.tutor.avatar_url || silhouetteDataUri(p.tutor.gender ?? null)
}

// ---- the frame: ground, soft shapes, safe area, footer ------------------------

type Ctx = {
  p: BannerParams
  data: SocialData
  theme: Theme
  format: SocialFormat
  /** The body box (safe area minus the footer). */
  w: number
  h: number
  /** The text scale of the format. */
  s: number
  verified: boolean
}

function frame(p: BannerParams, body: (ctx: Ctx) => ReactNode, opts: { qr?: boolean; decor?: (w: number, h: number, theme: Theme) => ReactNode } = {}) {
  const t = p.template as LayoutTemplate
  const theme = themeOf(t, p.variant)
  const { width: W, height: H } = FORMATS[p.format]
  const m = SAFE_MARGIN[p.format]
  const foot = FOOT[p.format]
  const footGap = Math.round(18 * SCALE[p.format])
  const w = W - 2 * m.x
  const h = H - 2 * m.y - footerHeight(foot) - footGap
  const ctx: Ctx = { p, data: toData(p), theme, format: p.format, w, h, s: SCALE[p.format], verified: p.verified ?? p.badges.includes('Verified') }
  return (
    <div style={{ width: W, height: H, display: 'flex', position: 'relative', overflow: 'hidden', background: theme.bg, fontFamily: 'Jakarta' }}>
      <Decor w={W} h={H} theme={theme} />
      {opts.decor ? opts.decor(W, H, theme) : null}
      <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: m.x, top: m.y, width: w, height: H - 2 * m.y, overflow: 'hidden', gap: footGap }}>
        <div style={{ display: 'flex', width: w, height: h, overflow: 'hidden' }}>{body(ctx)}</div>
        <BrandFooter theme={theme} qrDataUri={p.qrDataUri} s={foot} qr={opts.qr ?? true} />
      </div>
    </div>
  )
}

// ---- 1. Split card ---------------------------------------------------------------

function split(p: BannerParams) {
  return frame(p, (c) => {
    const { theme, data, s } = c
    const head = headlineFor('split', data)
    const sub = subLineFor('split', data)
    const subjects = subjectLabels(data.subjects)
    const city = data.city?.trim() || null
    const isStory = c.format === 'story'
    const gapX = Math.round(44 * s)
    const photoW = isStory ? c.w : Math.round((c.w - gapX) * (c.format === 'wide' ? 0.4 : 0.47))
    const colW = isStory ? c.w : c.w - photoW - gapX
    const align = isStory ? 'center' : 'flex-start'
    const build = (k: number) => {
      const z = (n: number) => n * s * k
      const blocks = [
        logoBlock(Math.round(z(40)), p, theme, colW, align),
        textBlock(headWords(head), { size: z(isStory ? 84 : 78), maxLines: 3, width: colW, color: theme.fg, accent: theme.accent, align, lh: 1.06 }),
        sub ? textBlock(plainWords(sub), { size: z(25), weight: 500, maxLines: 2, width: colW, color: theme.muted, align, lh: 1.3 }) : null,
        textBlock(plainWords(data.name || 'Tutor'), { size: z(isStory ? 60 : 52), maxLines: 2, width: colW, color: theme.fg, align, lh: 1.1 }),
        chipsBlock(subjects, { size: z(27), width: colW, theme, align, maxLines: isStory ? 2 : 3 }),
        cityBlock(city, { size: z(25), width: colW, color: theme.fg, pin: theme.accent, align }),
        ctaBlock(p.cta ?? ctaParts('split', data), { size: z(25), width: colW, theme, align }),
      ]
      return { blocks, gap: Math.round(z(16)) }
    }
    // Story: the photo takes the top part; the words take what they need below.
    if (isStory) {
      const words = fitScale(build, Math.round(c.h * 0.5))
      const wordsH = Math.min(Math.round(c.h * 0.5), stackHeight(words.blocks, words.gap) + 40)
      const photoH = c.h - wordsH - Math.round(30 * s)
      return (
        <div style={{ display: 'flex', flexDirection: 'column', width: c.w, height: c.h, gap: Math.round(30 * s) }}>
          <SplitPhoto src={photoSrc(p)} w={c.w} h={photoH} theme={theme} verified={c.verified} />
          <Stack blocks={words.blocks} width={c.w} height={wordsH} gap={words.gap} align="center" />
        </div>
      )
    }
    const words = fitScale(build, c.h)
    return (
      <div style={{ display: 'flex', width: c.w, height: c.h, gap: gapX }}>
        <SplitPhoto src={photoSrc(p)} w={photoW} h={c.h} theme={theme} verified={c.verified} />
        <Stack blocks={words.blocks} width={colW} height={c.h} gap={words.gap} align="flex-start" />
      </div>
    )
  })
}

/** The split card's big rounded photo, with the ✓ badge in its corner. */
function SplitPhoto({ src, w, h, theme, verified }: { src: string; w: number; h: number; theme: Theme; verified: boolean }) {
  const r = Math.round(Math.min(w, h) * 0.08)
  const badge = Math.round(Math.min(w, h) * 0.14)
  return (
    <div style={{ display: 'flex', position: 'relative', width: w, height: h, flexShrink: 0 }}>
      <div style={{ display: 'flex', width: w, height: h, borderRadius: r, overflow: 'hidden', backgroundImage: theme.ring, padding: Math.max(6, Math.round(Math.min(w, h) * 0.018)) }}>
        <img src={src} alt="" width={w} height={h} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: Math.max(4, r - 8) }} />
      </div>
      {verified ? (
        <div style={{ display: 'flex', position: 'absolute', right: Math.round(badge * 0.35), bottom: Math.round(badge * 0.35), width: badge, height: badge, borderRadius: badge, background: GREEN, border: `${Math.max(3, Math.round(badge * 0.09))}px solid ${BRAND.white}`, alignItems: 'center', justifyContent: 'center' }}>
          <Tick size={Math.round(badge * 0.58)} color={BRAND.white} stroke={3.6} />
        </div>
      ) : null}
    </div>
  )
}

// ---- 2. Verified ID card ------------------------------------------------------------
//
// A tutor card, NOT an identity document: it carries the name, up to three
// subjects, the city, the seal and the profile QR — and nothing else. No CNIC
// number, no date of birth, no phone, no flag or crest, navy rather than the
// green of a national ID.

function idcard(p: BannerParams) {
  return frame(
    p,
    (c) => {
      const { theme, data, s } = c
      const head = headlineFor('idcard', data)
      const subjects = subjectLabels(data.subjects)
      const city = data.city?.trim() || null
      const isWide = c.format === 'wide'
      const isStory = c.format === 'story'
      const cardW = isWide ? Math.round(c.w * 0.62) : c.w
      const outerW = isWide ? c.w - cardW - Math.round(40 * s) : c.w
      const align = isWide ? 'flex-start' : 'center'

      // The card's inside, at scale k.
      const card = (k: number) => {
        const z = (n: number) => n * s * k
        const pad = Math.round(z(30))
        const bandH = Math.round(z(64))
        const photo = Math.round(isStory ? z(330) : isWide ? z(250) : z(230))
        const qr = Math.round(isStory ? z(150) : z(128))
        const innerW = cardW - 2 * pad
        const infoW = isStory ? innerW : innerW - photo - Math.round(z(28))
        const infoAlign = isStory ? 'center' : 'flex-start'
        const name = textBlock(plainWords(data.name || 'Tutor'), { size: z(isStory ? 54 : 44), maxLines: 2, width: infoW, color: NAVY, align: infoAlign, lh: 1.1 })
        const subj = subjects.map((l) =>
          textBlock(plainWords(l), { size: z(24), min: z(18), weight: 700, maxLines: 1, width: infoW, color: SLATE, align: infoAlign, lh: 1.3 }),
        )
        const cityB = cityBlock(city, { size: z(24), width: infoW, color: NAVY, pin: GREEN, align: infoAlign })
        const info = [name, ...subj, cityB].filter(Boolean) as Block[]
        const infoGap = Math.round(z(8))
        const infoH = stackHeight(info, infoGap)
        let sealSize = Math.round(z(26))
        while (sealSize > 12 && sealWidth(sealSize) > innerW - qr - Math.round(z(20))) sealSize -= 1
        const bottomH = Math.max(qr, Math.round(sealSize * 1.7))
        const bodyH = isStory ? photo + Math.round(z(22)) + infoH : Math.max(photo, infoH)
        const cardH = bandH + pad + bodyH + Math.round(z(24)) + bottomH + pad
        const node = (
          <div style={{ display: 'flex', flexDirection: 'column', width: cardW, height: cardH, background: BRAND.white, borderRadius: Math.round(z(30)), border: `2px solid ${NEUTRAL.slate200}`, boxShadow: '0 12px 24px rgba(21,30,107,0.12)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: bandH, padding: `0 ${pad}px`, background: NAVY }}>
              <div style={{ display: 'flex', fontSize: Math.round(z(26)), fontWeight: 800, color: BRAND.white }}>{IDCARD_TITLE}</div>
              <div style={{ display: 'flex', width: Math.round(z(80)), height: Math.round(z(8)), borderRadius: 99, background: MINT }} />
            </div>
            <div style={{ display: 'flex', flexDirection: isStory ? 'column' : 'row', alignItems: isStory ? 'center' : 'center', gap: Math.round(z(isStory ? 22 : 28)), padding: `${pad}px ${pad}px 0 ${pad}px`, height: pad + bodyH }}>
              <img src={photoSrc(p)} alt="" width={photo} height={photo} style={{ width: photo, height: photo, borderRadius: Math.round(photo * 0.12), objectFit: 'cover', border: `${Math.max(3, Math.round(z(5)))}px solid ${BRAND.tintNavy}` }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: infoAlign, gap: infoGap, width: infoW }}>
                {info.map((b, i) => (
                  <div key={i} style={{ display: 'flex', height: b.h }}>
                    {b.node}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${Math.round(z(24))}px ${pad}px ${pad}px ${pad}px`, borderTop: `2px dashed ${NEUTRAL.slate200}`, marginTop: 0 }}>
              <Seal size={sealSize} color={GREEN} />
              <img src={p.qrDataUri} alt="" width={qr} height={qr} style={{ width: qr, height: qr, borderRadius: Math.round(z(10)) }} />
            </div>
          </div>
        )
        return { h: cardH, node }
      }

      const build = (k: number) => {
        const z = (n: number) => n * s * k
        const cardB = card(k)
        const blocks = isWide
          ? [cardB]
          : [
              logoBlock(Math.round(z(40)), p, theme, outerW, align),
              textBlock(headWords(head), { size: z(56), maxLines: 2, width: outerW, color: theme.fg, accent: theme.accent, align, lh: 1.06 }),
              cardB,
              ctaBlock(p.cta ?? ctaParts('idcard', data), { size: z(25), width: outerW, theme, align }),
            ]
        return { blocks, gap: Math.round(z(isStory ? 34 : 18)) }
      }
      const fit = fitScale(build, c.h)
      if (!isWide) return <Stack blocks={fit.blocks} width={c.w} height={c.h} gap={fit.gap} align="center" />
      const left = fitScale(
        (k) => ({
          blocks: [
            logoBlock(Math.round(40 * s * k), p, theme, outerW, 'flex-start'),
            textBlock(headWords(head), { size: 60 * s * k, maxLines: 3, width: outerW, color: theme.fg, accent: theme.accent, align: 'flex-start', lh: 1.06 }),
            ctaBlock(p.cta ?? ctaParts('idcard', data), { size: 25 * s * k, width: outerW, theme, align: 'flex-start' }),
          ],
          gap: Math.round(22 * s * k),
        }),
        c.h,
      )
      return (
        <div style={{ display: 'flex', width: c.w, height: c.h, gap: Math.round(40 * s), alignItems: 'center' }}>
          <Stack blocks={left.blocks} width={outerW} height={c.h} gap={left.gap} align="flex-start" />
          <Stack blocks={fit.blocks} width={cardW} height={c.h} gap={fit.gap} align="center" />
        </div>
      )
    },
    { qr: false },
  )
}

// ---- 3. Tutor's own words -------------------------------------------------------------

function quote(p: BannerParams) {
  return frame(p, (c) => {
    const { theme, data, s } = c
    const words = ownWords(data) ?? ''
    const city = data.city?.trim() || null
    const isWide = c.format === 'wide'
    const align = 'flex-start'
    const build = (k: number) => {
      const z = (n: number) => n * s * k
      const ring = Math.round(z(isWide ? 150 : 170))
      const nameW = c.w - ring - Math.round(z(26))
      const name = textBlock(plainWords(data.name || 'Tutor'), { size: z(40), maxLines: 2, width: nameW, color: theme.fg, align, lh: 1.1 })
      const cityB = cityBlock(city, { size: z(24), width: nameW, color: theme.muted, pin: theme.accent, align })
      const whoH = Math.max(ring, name.h + (cityB ? cityB.h + Math.round(z(6)) : 0))
      const who: Block = {
        h: whoH,
        node: (
          <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(z(26)), width: c.w }}>
            <FramedPhoto src={photoSrc(p)} size={ring} theme={theme} verified={c.verified} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(z(6)) }}>
              <div style={{ display: 'flex', height: name.h }}>{name.node}</div>
              {cityB ? <div style={{ display: 'flex', height: cityB.h }}>{cityB.node}</div> : null}
            </div>
          </div>
        ),
      }
      const mark = Math.round(z(isWide ? 70 : 110))
      const blocks = [
        logoBlock(Math.round(z(40)), p, theme, c.w, align),
        { h: Math.round(mark * 0.78), node: <QuoteMark size={mark} color={theme.accent} /> },
        textBlock(plainWords(words), { size: z(c.format === 'story' ? 76 : 70), min: z(30), maxLines: c.format === 'story' ? 7 : isWide ? 3 : 5, width: c.w, color: theme.fg, align, lh: 1.18 }),
        who,
        ctaBlock(p.cta ?? ctaParts('quote', data), { size: z(25), width: c.w, theme, align }),
      ]
      return { blocks, gap: Math.round(z(18)) }
    }
    const fit = fitScale(build, c.h)
    return <Stack blocks={fit.blocks} width={c.w} height={c.h} gap={fit.gap} align={align} />
  })
}

// ---- 4. Subject spotlight ----------------------------------------------------------------

function subject(p: BannerParams) {
  const t = themeOf('subject', p.variant)
  // The huge word: inside the safe area, in a colour only a shade off the
  // ground (low contrast on purpose — it is decoration, not text to read).
  const wordColour = t.dark ? 'rgba(255,255,255,0.08)' : BRAND.tintNavy
  return frame(p, (c) => {
    const { theme, data, s } = c
    const word = subjectWord(data)
    const isWide = c.format === 'wide'
    const align = isWide ? 'flex-start' : 'center'
    // The background word, fitted to the full body width, up to two lines.
    const big = textBlock(plainWords(word), { size: (isWide ? 190 : 260) * s, min: 40, maxLines: 2, width: c.w, color: wordColour, align: 'center', lh: 0.96 })
    const head = headlineFor('subject', data)
    const colW = isWide ? Math.round(c.w * 0.58) : c.w
    const build = (k: number) => {
      const z = (n: number) => n * s * k
      const ring = Math.round(z(isWide ? 330 : c.format === 'story' ? 500 : 320))
      const blocks = isWide
        ? [
            logoBlock(Math.round(z(40)), p, theme, colW, align),
            textBlock(plainWords(head.text), { size: z(60), maxLines: 3, width: colW, color: theme.fg, align, lh: 1.08 }),
            textBlock(plainWords(data.name || 'Tutor'), { size: z(40), maxLines: 2, width: colW, color: theme.accent, align, lh: 1.1 }),
            ctaBlock(p.cta ?? ctaParts('subject', data), { size: z(25), width: colW, theme, align }),
          ]
        : [
            logoBlock(Math.round(z(40)), p, theme, c.w, align),
            { h: ring, node: <FramedPhoto src={photoSrc(p)} size={ring} theme={theme} verified={c.verified} /> },
            textBlock(plainWords(head.text), { size: z(56), maxLines: 2, width: c.w, color: theme.fg, align, lh: 1.08 }),
            textBlock(plainWords(data.name || 'Tutor'), { size: z(38), maxLines: 2, width: c.w, color: theme.accent, align, lh: 1.1 }),
            ctaBlock(p.cta ?? ctaParts('subject', data), { size: z(25), width: c.w, theme, align }),
          ]
      return { blocks, gap: Math.round(z(18)), ring }
    }
    const fit = fitScale(build, c.h)
    const behind = (
      <div style={{ display: 'flex', position: 'absolute', left: 0, top: isWide ? Math.round((c.h - big.h) / 2) : Math.round(c.h * 0.16), width: c.w, justifyContent: 'center' }}>{big.node}</div>
    )
    if (!isWide) {
      return (
        <div style={{ display: 'flex', position: 'relative', width: c.w, height: c.h }}>
          {behind}
          <Stack blocks={fit.blocks} width={c.w} height={c.h} gap={fit.gap} align="center" />
        </div>
      )
    }
    const ring = Math.min(Math.round(c.h * 0.86), Math.round(c.w - colW - 40 * s))
    return (
      <div style={{ display: 'flex', position: 'relative', width: c.w, height: c.h, gap: Math.round(40 * s), alignItems: 'center' }}>
        {behind}
        <Stack blocks={fit.blocks} width={colW} height={c.h} gap={fit.gap} align="flex-start" />
        <FramedPhoto src={photoSrc(p)} size={ring} theme={theme} verified={c.verified} />
      </div>
    )
  })
}

// ---- 5. Meet our verified tutors (several tutors) -------------------------------------------

function group(p: BannerParams) {
  return frame(p, (c) => {
    const { theme, data, s } = c
    const tutors: GroupTutor[] = (p.group?.tutors ?? []).slice(0, 6)
    const head = headlineFor('group', data)
    const isWide = c.format === 'wide'
    const isStory = c.format === 'story'
    const n = Math.max(1, tutors.length)
    const cols = isStory ? 2 : n <= 4 ? 2 : 3
    const rows = Math.ceil(n / cols)
    const leftW = isWide ? Math.round(c.w * 0.34) : c.w
    const gridW = isWide ? c.w - leftW - Math.round(36 * s) : c.w
    const align = isWide ? 'flex-start' : 'center'

    const grid = (k: number, height: number): Block => {
      const z = (n2: number) => n2 * s * k
      const colGap = Math.round(z(24))
      const rowGap = Math.round(z(20))
      const cellW = Math.floor((gridW - (cols - 1) * colGap) / cols)
      const nameSize = z(isStory ? 34 : 26)
      const subSize = z(isStory ? 24 : 19)
      // The photo takes what the rows leave.
      const textH = Math.round(nameSize * 1.1) * 2 + Math.round(subSize * 1.3) + Math.round(z(10))
      const ring = Math.max(60, Math.min(cellW - 8, Math.floor((height - (rows - 1) * rowGap) / rows - textH)))
      const cells = tutors.map((t) => {
        const name = textBlock(plainWords(t.name || 'Tutor'), { size: nameSize, min: nameSize * 0.75, maxLines: 2, width: cellW, color: theme.fg, align: 'center', lh: 1.1 })
        const sub = t.subject ? textBlock(plainWords(t.subject), { size: subSize, min: subSize * 0.8, weight: 700, maxLines: 1, width: cellW, color: theme.muted, align: 'center', lh: 1.3 }) : null
        return (
          <div key={t.slug} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: cellW, gap: Math.round(z(5)) }}>
            <FramedPhoto src={t.avatar_url || silhouetteDataUri(t.gender ?? null)} size={ring} theme={theme} verified />
            <div style={{ display: 'flex', height: name.h }}>{name.node}</div>
            {sub ? <div style={{ display: 'flex', height: sub.h }}>{sub.node}</div> : null}
          </div>
        )
      })
      const rowsNodes: ReactNode[] = []
      for (let r = 0; r < rows; r++) {
        rowsNodes.push(
          <div key={r} style={{ display: 'flex', gap: colGap, justifyContent: 'center', width: gridW }}>
            {cells.slice(r * cols, r * cols + cols)}
          </div>,
        )
      }
      const h = rows * (ring + textH + Math.round(z(10))) + (rows - 1) * rowGap
      return { h: Math.min(h, height), node: <div style={{ display: 'flex', flexDirection: 'column', gap: rowGap, width: gridW }}>{rowsNodes}</div> }
    }

    if (isWide) {
      const left = fitScale(
        (k) => ({
          blocks: [
            logoBlock(Math.round(40 * s * k), p, theme, leftW, 'flex-start'),
            textBlock(headWords(head), { size: 60 * s * k, maxLines: 3, width: leftW, color: theme.fg, accent: theme.accent, align: 'flex-start', lh: 1.06 }),
            ctaBlock(p.cta ?? ctaParts('group', data), { size: 22 * s * k, width: leftW, theme, align: 'flex-start' }),
          ],
          gap: Math.round(22 * s * k),
        }),
        c.h,
      )
      const g = grid(1, c.h)
      return (
        <div style={{ display: 'flex', width: c.w, height: c.h, gap: Math.round(36 * s), alignItems: 'center' }}>
          <Stack blocks={left.blocks} width={leftW} height={c.h} gap={left.gap} align="flex-start" />
          <div style={{ display: 'flex', width: gridW, height: c.h, alignItems: 'center' }}>{g.node}</div>
        </div>
      )
    }
    const fit = fitScale((k) => {
      const z = (n2: number) => n2 * s * k
      const top = [
        logoBlock(Math.round(z(40)), p, theme, c.w, align),
        textBlock(headWords(head), { size: z(isStory ? 84 : 66), maxLines: 2, width: c.w, color: theme.fg, accent: theme.accent, align, lh: 1.06 }),
      ]
      const ctaB = ctaBlock(p.cta ?? ctaParts('group', data), { size: z(25), width: c.w, theme, align })
      const gap = Math.round(z(isStory ? 34 : 20))
      const room = c.h - stackHeight([...top, ctaB], gap) - 2 * gap
      return { blocks: [...top, grid(k, room), ctaB], gap }
    }, c.h)
    return <Stack blocks={fit.blocks} width={c.w} height={c.h} gap={fit.gap} align="center" />
  })
}

// ---- 6. Just verified (text only) ---------------------------------------------------------

function justverified(p: BannerParams) {
  return frame(
    p,
    (c) => {
      const { theme, data, s } = c
      const head = headlineFor('justverified', data)
      const isWide = c.format === 'wide'
      const align = isWide ? 'flex-start' : 'center'
      const subjects = subjectLabels(data.subjects)
      const build = (k: number) => {
        const z = (n: number) => n * s * k
        const blocks = [
          logoBlock(Math.round(z(44)), p, theme, c.w, align),
          textBlock(headWords(head), {
            size: z(isWide ? 74 : c.format === 'story' ? 96 : 86),
            maxLines: 4,
            width: c.w,
            color: theme.fg,
            accent: theme.accent,
            align,
            lh: 1.06,
            tail: { factor: 0.9, draw: (size) => <Tick size={Math.round(size * 0.8)} color={theme.accent} stroke={3.8} /> },
          }),
          { h: Math.round(z(8)), node: <div style={{ display: 'flex', width: Math.round(z(120)), height: Math.round(z(8)), borderRadius: 99, background: BRAND.gold }} /> },
          textBlock(plainWords(data.name || 'Tutor'), { size: z(c.format === 'story' ? 66 : 54), maxLines: 2, width: c.w, color: theme.fg, align, lh: 1.1 }),
          chipsBlock(subjects, { size: z(26), width: c.w, theme, align, maxLines: 2 }),
          ctaBlock(p.cta ?? ctaParts('justverified', data), { size: z(26), width: c.w, theme, align }),
        ]
        return { blocks, gap: Math.round(z(c.format === 'story' ? 36 : 20)) }
      }
      const fit = fitScale(build, c.h)
      return <Stack blocks={fit.blocks} width={c.w} height={c.h} gap={fit.gap} align={align} />
    },
    {
      // Soft celebratory shapes — confetti dots, low opacity, inside the frame.
      decor: (W, H, theme) => {
        const dots = [
          [0.16, 0.2, 0.05, BRAND.gold],
          [0.84, 0.3, 0.035, theme.accent],
          [0.12, 0.72, 0.03, theme.accent],
          [0.9, 0.78, 0.05, BRAND.gold],
          [0.5, 0.1, 0.025, theme.accent],
        ] as const
        return (
          <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: W, height: H }}>
            {dots.map(([x, y, r, col], i) => {
              const d = Math.round(Math.min(W, H) * r)
              return <div key={i} style={{ display: 'flex', position: 'absolute', left: Math.round(W * x - d / 2), top: Math.round(H * y - d / 2), width: d, height: d, borderRadius: d, background: col, opacity: theme.dark ? 0.1 : 0.14 }} />
            })}
          </div>
        )
      },
    },
  )
}

// ---- 7. Polaroid ------------------------------------------------------------------------------

const TILT = -4
const TILT_COS = Math.cos((Math.abs(TILT) * Math.PI) / 180)
const TILT_SIN = Math.sin((Math.abs(TILT) * Math.PI) / 180)

function polaroid(p: BannerParams) {
  return frame(p, (c) => {
    const { theme, data, s } = c
    const head = headlineFor('polaroid', data)
    const subjects = subjectLabels(data.subjects)
    const city = data.city?.trim() || null
    const isWide = c.format === 'wide'
    const align = isWide ? 'flex-start' : 'center'

    /** The print at a photo size: white frame, a deeper bottom with the name. */
    const print = (photo: number, maxBox: number): Block => {
      const pad = Math.round(photo * 0.06)
      const nameRoom = Math.round(photo * 0.26)
      const w = photo + 2 * pad
      const h = photo + pad + nameRoom
      // The rotated print's box.
      const bw = Math.ceil(w * TILT_COS + h * TILT_SIN)
      const bh = Math.ceil(h * TILT_COS + w * TILT_SIN)
      const name = textBlock(plainWords(data.name || 'Tutor'), { size: nameRoom * 0.6, min: nameRoom * 0.34, hand: true, maxLines: 1, width: photo, color: NAVY, align: 'center', lh: 1.1 })
      return {
        h: bh,
        node: (
          <div style={{ display: 'flex', width: Math.min(bw, maxBox), height: bh, alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: w, height: h, padding: `${pad}px ${pad}px 0 ${pad}px`, background: BRAND.white, borderRadius: 6, boxShadow: '0 12px 26px rgba(21,30,107,0.18)', transform: `rotate(${TILT}deg)` }}>
              <img src={photoSrc(p)} alt="" width={photo} height={photo} style={{ width: photo, height: photo, objectFit: 'cover', borderRadius: 3 }} />
              <div style={{ display: 'flex', height: nameRoom, alignItems: 'center', justifyContent: 'center', width: photo }}>{name.node}</div>
            </div>
          </div>
        ),
      }
    }
    const printFor = (box: number, height: number) => {
      // The largest photo whose rotated print fits box × height.
      let photo = Math.round(box * 0.9)
      for (; photo > 80; photo -= 4) {
        const pad = photo * 0.06
        const w = photo + 2 * pad
        const h = photo + pad + photo * 0.26
        if (w * TILT_COS + h * TILT_SIN <= box && h * TILT_COS + w * TILT_SIN <= height) break
      }
      return print(photo, box)
    }

    if (isWide) {
      const colW = Math.round(c.w * 0.56)
      const left = fitScale(
        (k) => ({
          blocks: [
            logoBlock(Math.round(40 * s * k), p, theme, colW, 'flex-start'),
            textBlock(headWords(head), { size: 62 * s * k, maxLines: 3, width: colW, color: theme.fg, accent: theme.accent, align: 'flex-start', lh: 1.06 }),
            chipsBlock(subjects, { size: 22 * s * k, width: colW, theme, align: 'flex-start', maxLines: 1 }),
            cityBlock(city, { size: 24 * s * k, width: colW, color: theme.fg, pin: theme.accent, align: 'flex-start' }),
            ctaBlock(p.cta ?? ctaParts('polaroid', data), { size: 25 * s * k, width: colW, theme, align: 'flex-start' }),
          ],
          gap: Math.round(20 * s * k),
        }),
        c.h,
      )
      const box = c.w - colW - Math.round(30 * s)
      const pr = printFor(box, c.h)
      return (
        <div style={{ display: 'flex', width: c.w, height: c.h, gap: Math.round(30 * s), alignItems: 'center' }}>
          <Stack blocks={left.blocks} width={colW} height={c.h} gap={left.gap} align="flex-start" />
          <div style={{ display: 'flex', width: box, height: c.h, alignItems: 'center', justifyContent: 'center' }}>{pr.node}</div>
        </div>
      )
    }
    const fit = fitScale((k) => {
      const z = (n: number) => n * s * k
      const gap = Math.round(z(c.format === 'story' ? 34 : 18))
      const top = [
        logoBlock(Math.round(z(40)), p, theme, c.w, align),
        textBlock(headWords(head), { size: z(c.format === 'story' ? 84 : 62), maxLines: 2, width: c.w, color: theme.fg, accent: theme.accent, align, lh: 1.06 }),
      ]
      const bottom = [
        chipsBlock([...subjects], { size: z(23), width: c.w, theme, align, maxLines: 1 }),
        cityBlock(city, { size: z(24), width: c.w, color: theme.fg, pin: theme.accent, align }),
        ctaBlock(p.cta ?? ctaParts('polaroid', data), { size: z(25), width: c.w, theme, align }),
      ]
      const room = c.h - stackHeight([...top, ...bottom], gap) - 2 * gap
      return { blocks: [...top, printFor(Math.round(c.w * 0.8), Math.max(120, room)), ...bottom], gap }
    }, c.h)
    return <Stack blocks={fit.blocks} width={c.w} height={c.h} gap={fit.gap} align="center" />
  })
}

// ---- dispatch -------------------------------------------------------------------------------

export function renderLayout(p: BannerParams) {
  switch (p.template as LayoutTemplate) {
    case 'split':
      return split(p)
    case 'idcard':
      return idcard(p)
    case 'quote':
      return quote(p)
    case 'subject':
      return subject(p)
    case 'group':
      return group(p)
    case 'justverified':
      return justverified(p)
    case 'polaroid':
      return polaroid(p)
  }
}
