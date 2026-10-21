import { ImageResponse } from 'next/og'
import { BRAND, NEUTRAL } from '@/lib/brand'
import { silhouetteDataUri } from '@/lib/social/avatars'
import { accentTail, fitWords, plainWords, textWidth, type Word } from '@/lib/social/fit'
import {
  bandTextLines,
  ctaParts,
  headlineFor,
  subLineFor,
  occasionFor,
  subjectLabels,
  WORDMARK,
  type SocialFormat,
  type SocialTemplate,
} from '@/lib/social/copy'
import {
  FORMATS,
  SAFE_MARGIN,
  NAVY,
  GREEN,
  MINT,
  SLATE,
  HEAD_LH,
  NAME_LH,
  SUB_LH,
  BrandFooter,
  Chip,
  Confetti,
  CtaPill,
  Decor,
  FramedPhoto,
  Lines,
  Logo,
  PinIcon,
  Strokes,
  Tick,
  chipRowHeight,
  ctaHeight,
  fitChipRow,
  fonts,
  footerHeight,
  toData,
  type BannerParams,
  type Theme,
} from './pieces'
import { isLayoutTemplate, layoutBackground, renderLayout } from './layouts'

export { FORMATS, SAFE_MARGIN, socialCaption } from './pieces'
export type { BannerParams, BannerTutor, GroupTutor } from './pieces'


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
// PR C3 (owner, 21 Oct 2026) adds seven templates with layouts of their own —
// ./layouts.tsx — and renderSocialBanner below sends each template to its
// layout. The shared parts (footer, logo, ring, chips, CTA) live in ./pieces.tsx.
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

/** The templates drawn by THIS layout (the C2 structure). 'profile' is the
 *  neutral link-preview card for a tutor who is not verified. */
type ClassicTemplate = 'verified' | 'spotlight' | 'bold' | 'success' | 'announcement' | 'profile'

const THEMES: Record<ClassicTemplate, Theme> = {
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
  // The neutral preview: the verified look's ground, a slate ring, no ✓ badge.
  profile: {
    bg: BRAND.bg,
    fg: NAVY,
    accent: BRAND.red,
    muted: SLATE,
    dark: false,
    ring: `linear-gradient(135deg, ${NEUTRAL.slate300} 0%, ${NAVY} 100%)`,
    shadow: '0 24px 48px rgba(21,30,107,0.18)',
    chipBg: BRAND.tintNavy,
    chipFg: NAVY,
    ctaStyle: 'fill',
    ctaBg: NAVY,
    ctaFg: BRAND.white,
    blobs: [NEUTRAL.slate300, NAVY],
    blobOpacity: 0.1,
    stroke: NAVY,
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
  const theme = THEMES[template as ClassicTemplate]
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

  const cta = p.cta ?? ctaParts(template, data)
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
  const tree = isLayoutTemplate(params.template) ? renderLayout(params) : render(params)
  return new ImageResponse(tree, { width, height, fonts: fonts() })
}

// Re-exported so callers keep one import surface.
export { bandTextLines, WORDMARK }

/** The ground colour of a template (the margin test compares against it). */
export function templateBackground(template: SocialTemplate, variant = 0): string {
  if (isLayoutTemplate(template)) return layoutBackground(template, variant)
  return THEMES[template as ClassicTemplate].bg
}
