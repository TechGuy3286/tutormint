import { ImageResponse } from 'next/og'
import { BRAND, NEUTRAL, avatarTint, initialsOf } from '@/lib/brand'
import type { BadgeName } from '@/lib/planBadges'
import { SOCIAL_MARKS } from '@/lib/social/marks'
import {
  bandTextLines,
  buildCaption,
  ctaText,
  experienceText,
  placeText,
  ratingText,
  subjectLabels,
  teachingChip,
  HANDLE,
  SITE,
  TAGLINE,
  WORDMARK,
  X_HANDLE,
  type SocialData,
  type SocialFormat,
  type SocialTemplate,
} from '@/lib/social/copy'

// The social image generator — four templates × three formats, satori/next-og.
//
// EVERY POST IS RECOGNISABLY OURS: a fixed brand band (BrandBand) rides every
// template and format — the one-word wordmark, the tagline once, tutormint.org,
// the @tutormint.official handle with the platform marks, "X: @TutorMint5", and
// a QR of the tutor's public profile. Only its PLACEMENT adapts (a bottom strip
// on square/wide, a lower block on story); its content is identical.
//
// Templates stay visually distinct (spotlight light, bold dark, success green
// panel, announcement navy); the band is the constant. All colours are hex
// literals from lib/brand.ts (satori resolves neither Tailwind nor CSS vars),
// and renders are pixel-stable (no clock/random) so a re-download is identical.
// Every text string comes from lib/social/copy.ts — the same module the caption
// box and the tests read — so the creative cannot word anything on its own.

export const FORMATS: Record<SocialFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  wide: { width: 1200, height: 630 },
}

const RED = BRAND.red
const NAVY = BRAND.navy
const SLATE = NEUTRAL.slate700
const GREEN = BRAND.greenDeep
const GOLD = BRAND.gold
const GOLD_INK = BRAND.goldInk

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
  avatar_url: string | null
  experience_years?: number | null
  teaching_mode?: string | null
}

type BannerParams = {
  tutor: BannerTutor
  badges: BadgeName[]
  subjects: string[]
  format: SocialFormat
  template: SocialTemplate
  qrDataUri: string
  profileUrl: string
  /** success/announcement: the editable occasion / headline line. */
  headline?: string
  /** announcement only: a detail line and a date chip. */
  subhead?: string
  dateLabel?: string
  /** success only. */
  successKind?: 'verified' | 'hired'
}

function scaleFor(format: SocialFormat): number {
  return format === 'wide' ? 0.62 : format === 'story' ? 1.05 : 1
}

/** Turn render params into the pure SocialData the copy helpers read. */
function toData(p: BannerParams): SocialData {
  return {
    slug: p.tutor.slug,
    name: p.tutor.full_name,
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
  }
}

/** The caption for the admin box — same data, so what's pasted matches the art. */
export function socialCaption(p: BannerParams): string {
  return buildCaption(p.template, toData(p))
}

// --- shared pieces ---------------------------------------------------------

// "TutorMint" is one word rendered as two coloured runs; satori inserts a
// word-space (~0.273em for this face) that a negative right margin pulls back.
function Wordmark({ size, dark }: { size: number; dark: boolean }) {
  const fg = dark ? BRAND.white : BRAND.black
  const accent = dark ? BRAND.mint : RED
  return (
    <div style={{ display: 'flex', alignItems: 'baseline' }}>
      <div style={{ fontSize: size, fontWeight: 900, color: fg, marginRight: -Math.round(size * 0.273) }}>
        Tutor
      </div>
      <div style={{ fontSize: size, fontWeight: 900, color: accent }}>Mint</div>
    </div>
  )
}

function StarRating({ rating, count, scale, ink }: { rating: number; count: number; scale: number; ink: string }) {
  if (count <= 0) return null
  const label = ratingText(rating, count)
  if (!label) return null
  const s = Math.round(26 * scale)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ink, fontWeight: 800, fontSize: s }}>
      <svg width={s} height={s} viewBox="0 0 24 24" fill={GOLD}>
        <path d="M12 2.6l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.4l-5.8 3.06 1.11-6.46-4.7-4.58 6.49-.94z" />
      </svg>
      <div style={{ display: 'flex' }}>{label}</div>
    </div>
  )
}

function Portrait({ tutor, size, radius }: { tutor: BannerTutor; size: number; radius: number }) {
  const tint = avatarTint(tutor.id || tutor.full_name || '?')
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: tutor.avatar_url ? NEUTRAL.slate100 : tint.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.36),
        fontWeight: 900,
        color: tint.fg,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {tutor.avatar_url ? (
        <img src={tutor.avatar_url} alt="" width={size} height={size} style={{ objectFit: 'cover', width: size, height: size }} />
      ) : (
        initialsOf(tutor.full_name)
      )}
    </div>
  )
}

function BadgePills({ badges, dark, scale }: { badges: BadgeName[]; dark: boolean; scale: number }) {
  if (badges.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {badges.map((b) => {
        const inverted = dark && b === 'Premium' // navy pill on navy → invert to navy-on-white
        return (
          <div
            key={b}
            style={{
              display: 'flex',
              padding: `${Math.round(8 * scale)}px ${Math.round(18 * scale)}px`,
              borderRadius: 999,
              fontSize: Math.round(22 * scale),
              fontWeight: 800,
              color: inverted ? BRAND.navy : b === 'Featured' ? BRAND.black : BRAND.white,
              background: inverted ? BRAND.white : b === 'Verified' ? GREEN : b === 'Premium' ? BRAND.navy : GOLD,
            }}
          >
            {b}
          </div>
        )
      })}
    </div>
  )
}

/** A soft pill (subject / teaching-mode chip). */
function Chip({ label, scale, fg, bg }: { label: string; scale: number; fg: string; bg: string }) {
  return (
    <div
      style={{
        display: 'flex',
        padding: `${Math.round(8 * scale)}px ${Math.round(18 * scale)}px`,
        borderRadius: 999,
        fontSize: Math.round(22 * scale),
        fontWeight: 700,
        color: fg,
        background: bg,
      }}
    >
      {label}
    </div>
  )
}

function Fact({ icon, label, scale }: { icon: 'book' | 'pin' | 'clock' | 'monitor'; label: string; scale: number }) {
  const s = Math.round(26 * scale)
  const paths: Record<typeof icon, string> = {
    book: 'M4 4h11a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z M17 6h3v14h-3',
    pin: 'M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12z M12 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
    monitor: 'M3 4h18v12H3z M8 20h8 M12 16v4',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(12 * scale), fontSize: Math.round(26 * scale), color: SLATE, fontWeight: 700 }}>
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d={paths[icon]} />
      </svg>
      <div style={{ display: 'flex' }}>{label}</div>
    </div>
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

/** The fixed brand band — identical content on every template and format. */
function BrandBand({ format, dark, qrDataUri, scale }: { format: SocialFormat; dark: boolean; qrDataUri: string; scale: number }) {
  const isStory = format === 'story'
  const accent = dark ? BRAND.mint : NAVY
  const taglineColor = dark ? BRAND.mint : NAVY
  const muted = dark ? NEUTRAL.slate300 : SLATE
  const iconSize = Math.round(30 * scale)
  const qr = Math.round((isStory ? 150 : 132) * scale)

  const text = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(8 * scale) }}>
      <Wordmark size={Math.round(36 * scale)} dark={dark} />
      <div style={{ display: 'flex', fontSize: Math.round(23 * scale), fontWeight: 800, color: taglineColor }}>
        {TAGLINE}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(12 * scale), fontSize: Math.round(19 * scale), fontWeight: 700, color: muted }}>
        <div style={{ display: 'flex' }}>{SITE}</div>
        <div style={{ display: 'flex' }}>·</div>
        <div style={{ display: 'flex' }}>{HANDLE}</div>
        <Marks size={iconSize} gap={Math.round(10 * scale)} />
        <div style={{ display: 'flex' }}>{X_HANDLE}</div>
      </div>
    </div>
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isStory ? 'column' : 'row',
        alignItems: isStory ? 'flex-start' : 'flex-end',
        justifyContent: 'space-between',
        gap: Math.round(20 * scale),
        borderTop: `3px solid ${accent}`,
        paddingTop: Math.round(24 * scale),
      }}
    >
      {text}
      <img src={qrDataUri} width={qr} height={qr} alt="" style={{ borderRadius: Math.round(10 * scale) }} />
    </div>
  )
}

function Cta({ label, scale, fg }: { label: string; scale: number; fg: string }) {
  return (
    <div style={{ display: 'flex', fontSize: Math.round(32 * scale), fontWeight: 800, color: fg }}>{label}</div>
  )
}

// --- templates -------------------------------------------------------------

function profileBanner(p: BannerParams) {
  const { format, template } = p
  const dark = template === 'bold'
  const scale = scaleFor(format)
  const isWide = format === 'wide'
  const data = toData(p)

  const bg = dark ? NAVY : BRAND.white
  const fg = dark ? BRAND.white : NAVY
  const muted = dark ? NEUTRAL.slate300 : SLATE
  const ratingInk = dark ? GOLD : GOLD_INK
  const avatarSize = Math.round((isWide ? 200 : 320) * (format === 'story' ? 1.05 : 1))
  const subjects = subjectLabels(data.subjects)
  const chip = teachingChip(data.teachingMode)
  const place = placeText(data.area, data.city)

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: bg, padding: Math.round(64 * scale), fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', fontSize: Math.round(24 * scale), fontWeight: 900, letterSpacing: 2, color: dark ? BRAND.mint : GREEN }}>
        VERIFIED TUTOR
      </div>

      <div style={{ display: 'flex', flexDirection: isWide ? 'row' : 'column', alignItems: isWide ? 'center' : 'flex-start', gap: Math.round(40 * scale) }}>
        <Portrait tutor={p.tutor} size={avatarSize} radius={avatarSize} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(18 * scale) }}>
          <div style={{ display: 'flex', fontSize: Math.round(64 * scale), fontWeight: 900, color: fg }}>{data.name}</div>
          <BadgePills badges={p.badges} dark={dark} scale={scale} />
          {subjects.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: Math.round(12 * scale) }}>
              {subjects.map((sub) => (
                <Chip key={sub} label={sub} scale={scale} fg={fg} bg={dark ? NEUTRAL.slate800 : BRAND.tintNavy} />
              ))}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(24 * scale), fontSize: Math.round(26 * scale), color: muted, fontWeight: 700 }}>
            {place ? <div style={{ display: 'flex' }}>{place}</div> : null}
            <StarRating rating={data.ratingAvg ?? 0} count={data.ratingCount ?? 0} scale={scale} ink={ratingInk} />
          </div>
          {chip ? (
            <div style={{ display: 'flex' }}>
              <Chip label={chip} scale={scale} fg={dark ? NAVY : BRAND.white} bg={dark ? BRAND.mint : GREEN} />
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(24 * scale) }}>
        <Cta label={ctaText(template, data)} scale={scale} fg={fg} />
        <BrandBand format={format} dark={dark} qrDataUri={p.qrDataUri} scale={scale} />
      </div>
    </div>
  )
}

function successBanner(p: BannerParams) {
  const { format } = p
  const scale = scaleFor(format)
  const isWide = format === 'wide'
  const data = toData(p)
  const occasion = (p.headline ?? '').trim() || "You're Verified!"
  const subjects = subjectLabels(data.subjects)
  const place = placeText(data.area, data.city)
  const exp = experienceText(data.experienceYears)
  const chip = teachingChip(data.teachingMode)
  const portrait = Math.round((isWide ? 150 : 210) * 1)

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: BRAND.white, padding: Math.round(64 * scale), fontFamily: 'sans-serif' }}>
      {/* No eyebrow here: the green panel's "Congratulations" already leads, and
          on the square format the eyebrow crowded the panel. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(24 * scale) }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(20 * scale), background: BRAND.tintGreen, borderRadius: Math.round(36 * scale), padding: Math.round(48 * scale) }}>
          <div style={{ display: 'flex', fontSize: Math.round(40 * scale), fontStyle: 'italic', fontWeight: 600, color: GREEN }}>
            Congratulations
          </div>
          <div style={{ display: 'flex', fontSize: Math.round(72 * scale), fontWeight: 900, color: NAVY }}>{occasion}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(28 * scale) }}>
            <Portrait tutor={p.tutor} size={portrait} radius={Math.round(portrait * 0.22)} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(14 * scale) }}>
              <div style={{ display: 'flex', fontSize: Math.round(46 * scale), fontWeight: 900, color: NAVY }}>{data.name}</div>
              <BadgePills badges={p.badges} dark={false} scale={scale} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(16 * scale), border: `2px solid ${NEUTRAL.slate200}`, borderRadius: Math.round(24 * scale), padding: Math.round(36 * scale) }}>
          {subjects.length > 0 ? <Fact icon="book" label={subjects.join(', ')} scale={scale} /> : null}
          {place ? <Fact icon="pin" label={place} scale={scale} /> : null}
          {exp ? <Fact icon="clock" label={exp} scale={scale} /> : null}
          {chip ? <Fact icon="monitor" label={chip} scale={scale} /> : null}
        </div>

        <Cta label={ctaText('success', data)} scale={scale} fg={NAVY} />
      </div>

      <BrandBand format={format} dark={false} qrDataUri={p.qrDataUri} scale={scale} />
    </div>
  )
}

function announcementBanner(p: BannerParams) {
  const { format } = p
  const scale = scaleFor(format)
  const isWide = format === 'wide'
  const data = toData(p)
  const title = ctaText('announcement', data)
  const role = [subjectLabels(data.subjects)[0], data.city].filter(Boolean).join(' · ') || 'Verified tutor'
  const portrait = Math.round((isWide ? 150 : 220) * 1)

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: NAVY, padding: Math.round(64 * scale), fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', fontSize: Math.round(24 * scale), fontWeight: 900, letterSpacing: 2, color: BRAND.mint }}>
          ANNOUNCEMENT
        </div>
        {p.dateLabel ? (
          <div style={{ display: 'flex', padding: `${Math.round(10 * scale)}px ${Math.round(24 * scale)}px`, borderRadius: Math.round(14 * scale), background: GOLD, color: BRAND.black, fontWeight: 900, fontSize: Math.round(24 * scale) }}>
            {p.dateLabel}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(36 * scale) }}>
        <div style={{ display: 'flex', fontSize: Math.round((isWide ? 72 : 88) * scale), fontWeight: 900, color: BRAND.white }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(28 * scale) }}>
          <Portrait tutor={p.tutor} size={portrait} radius={portrait} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(12 * scale) }}>
            <div style={{ display: 'flex', fontSize: Math.round(48 * scale), fontWeight: 900, color: BRAND.white }}>{data.name}</div>
            <div style={{ display: 'flex', fontSize: Math.round(26 * scale), color: NEUTRAL.slate300, fontWeight: 700 }}>{role}</div>
            <StarRating rating={data.ratingAvg ?? 0} count={data.ratingCount ?? 0} scale={scale} ink={GOLD} />
          </div>
        </div>
        {p.subhead ? (
          <div style={{ display: 'flex', fontSize: Math.round(28 * scale), color: BRAND.mint, fontWeight: 700 }}>{p.subhead}</div>
        ) : null}
      </div>

      <BrandBand format={format} dark qrDataUri={p.qrDataUri} scale={scale} />
    </div>
  )
}

export function renderSocialBanner(params: BannerParams): Response {
  const { width, height } = FORMATS[params.format]
  const node =
    params.template === 'success'
      ? successBanner(params)
      : params.template === 'announcement'
        ? announcementBanner(params)
        : profileBanner(params)
  return new ImageResponse(node, { width, height })
}

// Re-exported so callers keep one import surface.
export { bandTextLines, WORDMARK }
