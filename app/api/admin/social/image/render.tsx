import { ImageResponse } from 'next/og'

import { BRAND, NEUTRAL, avatarTint, initialsOf } from '@/lib/brand'
import type { BadgeName } from '@/lib/planBadges'

// The banner itself, split out from the route.
//
// The route's job is deciding WHO may generate a post and looking the tutor up;
// this file's job is what the picture looks like.
//
// PIXEL-STABLE. The same input must produce identical bytes on every run, so
// nothing here reads a clock, a random number or anything else that varies
// between calls. That is what makes a regenerated post safe to re-download.
//
// FOUR templates now, two shapes:
//   spotlight / bold — the profile card (light / dark), unchanged.
//   success          — a "Congratulations" card: script line, bold occasion,
//                      the portrait in a rounded frame on a tinted panel, three
//                      facts in a soft card, badges where earned. Used for
//                      "You're Verified" and "Hired".
//   announcement     — navy ground, oversized headline, circular portrait with
//                      name + role, a gold date block, a detail strip. Used for
//                      roundups and events.
//
// The wordmark is ONE word — "TutorMint" — and satori inserts a word-space
// between adjacent text runs (~0.27em for this face), so the two halves are
// pulled back together with a negative margin scaled to the type. If the font
// changes, re-measure; the constant is that font's space advance.

export const FORMATS: Record<string, { width: number; height: number }> = {
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

export type BannerTutor = {
  id: string
  slug: string
  full_name: string
  headline: string | null
  city: string | null
  area: string | null
  subjects: string[] | null
  rating_avg: number | null
  rating_count: number | null
  avatar_url: string | null
  experience_years?: number | null
}

type BannerParams = {
  tutor: BannerTutor
  badges: BadgeName[]
  format: string
  template: string
  /** The one editable line. Occasion for success/announcement; headline for the profile card. */
  headline: string
  /** Announcement only: the venue or detail strip. */
  subhead?: string
  /** Announcement only: the date block. A caller-supplied string, not a clock read. */
  dateLabel?: string
}

export function renderSocialBanner(params: BannerParams): Response {
  const size = FORMATS[params.format]
  if (!size) return new Response('Unknown format.', { status: 400 })

  const node =
    params.template === 'success'
      ? successBanner(params)
      : params.template === 'announcement'
        ? announcementBanner(params)
        : profileBanner(params)

  return new ImageResponse(node, { width: size.width, height: size.height })
}

// --------------------------------------------------------------- helpers ----

function scaleFor(format: string): number {
  return format === 'wide' ? 0.62 : format === 'story' ? 1.05 : 1
}

/** The one-word wordmark, styled per surface. */
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

/** The star rating, as an inline SVG path (the ★ glyph is not in the sans face). */
function StarRating({ rating, count, scale, ink }: { rating: number; count: number; scale: number; ink: string }) {
  if (count <= 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ink, fontWeight: 800, fontSize: Math.round(26 * scale) }}>
      <svg width={Math.round(26 * scale)} height={Math.round(26 * scale)} viewBox="0 0 24 24" fill={GOLD}>
        <path d="M12 2.6l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.4l-5.8 3.06 1.11-6.46-4.7-4.58 6.49-.94z" />
      </svg>
      <div style={{ display: 'flex' }}>
        {rating.toFixed(1)} ({count})
      </div>
    </div>
  )
}

/** Avatar, or the same initials disc as components/Avatar.tsx. radius 999 = circle. */
function Portrait({ tutor, size, radius }: { tutor: BannerTutor; size: number; radius: number }) {
  const tint = avatarTint((tutor.id as string) || (tutor.full_name as string) || '?')
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
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tutor.avatar_url as string} alt="" width={size} height={size} style={{ objectFit: 'cover', width: size, height: size }} />
      ) : (
        initialsOf(tutor.full_name as string)
      )}
    </div>
  )
}

/** Badge pills, in the Verified → Premium → Featured order the caller provides. */
function BadgePills({ badges, dark, scale }: { badges: BadgeName[]; dark: boolean; scale: number }) {
  if (badges.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {badges.map((b) => {
        // Premium is navy; on a navy ground it inverts to navy-on-white so it
        // reads as a badge, not bare text.
        const inverted = dark && b === 'Premium'
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

/** One labelled fact with a small icon, for the success card's soft card. */
function Fact({ icon, label, scale }: { icon: 'book' | 'pin' | 'clock'; label: string; scale: number }) {
  const s = Math.round(26 * scale)
  const paths: Record<typeof icon, string> = {
    book: 'M4 4h11a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z M17 6h3v14h-3',
    pin: 'M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12z M12 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
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

function CtaStrip({ slug, scale, fg, borderColor }: { slug: string; scale: number; fg: string; borderColor: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        borderTop: `2px solid ${borderColor}`,
        paddingTop: Math.round(28 * scale),
      }}
    >
      <div style={{ fontSize: Math.round(30 * scale), fontWeight: 800, color: fg, display: 'flex' }}>
        Hire verified tutors on tutormint.org
      </div>
      <div
        style={{
          display: 'flex',
          padding: `${Math.round(14 * scale)}px ${Math.round(30 * scale)}px`,
          borderRadius: 16,
          background: RED,
          color: BRAND.white,
          fontSize: Math.round(26 * scale),
          fontWeight: 900,
        }}
      >
        /tutor/{slug}
      </div>
    </div>
  )
}

// -------------------------------------------------------- profile banner ----
// The original spotlight / bold card, unchanged in look.

function profileBanner({ tutor, badges, format, template, headline }: BannerParams) {
  const scale = scaleFor(format)
  const isStory = format === 'story'
  const isWide = format === 'wide'
  const subjects = ((tutor.subjects as string[]) ?? []).slice(0, 4)
  const rating = Number(tutor.rating_avg ?? 0)
  const ratingCount = Number(tutor.rating_count ?? 0)
  const place = [tutor.area, tutor.city].filter(Boolean).join(', ')
  const line = headline || (tutor.headline as string) || 'Verified tutor on TutorMint'

  const dark = template === 'bold'
  const bg = dark ? NAVY : BRAND.white
  const fg = dark ? BRAND.white : NAVY
  const muted = dark ? NEUTRAL.slate300 : SLATE
  const ratingInk = dark ? GOLD : GOLD_INK
  const avatarSize = Math.round((isWide ? 180 : 300) * (isStory ? 1.1 : 1))

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: bg, padding: Math.round(64 * scale), fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Wordmark size={Math.round(44 * scale)} dark={dark} />
        <div style={{ marginLeft: 'auto', fontSize: Math.round(20 * scale), fontWeight: 700, letterSpacing: 2, color: muted, textTransform: 'uppercase' }}>
          Verified tutors
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: isWide ? 'row' : 'column', alignItems: isWide ? 'center' : 'flex-start', gap: Math.round(36 * scale) }}>
        <Portrait tutor={tutor} size={avatarSize} radius={avatarSize} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(14 * scale) }}>
          <div style={{ fontSize: Math.round(64 * scale), fontWeight: 900, color: fg, lineHeight: 1.05 }}>{tutor.full_name as string}</div>
          <BadgePills badges={badges} dark={dark} scale={scale} />
          <div style={{ fontSize: Math.round(30 * scale), color: muted, lineHeight: 1.3, display: 'flex' }}>{line}</div>
          {subjects.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {subjects.map((s) => (
                <div key={s} style={{ display: 'flex', padding: `${Math.round(8 * scale)}px ${Math.round(18 * scale)}px`, borderRadius: 12, fontSize: Math.round(22 * scale), fontWeight: 700, color: fg, background: dark ? NEUTRAL.slate800 : NEUTRAL.slate100 }}>
                  {s}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: Math.round(28 * scale), fontSize: Math.round(26 * scale), color: muted, alignItems: 'center' }}>
            {place && <div style={{ display: 'flex' }}>{place}</div>}
            <StarRating rating={rating} count={ratingCount} scale={scale} ink={ratingInk} />
          </div>
        </div>
      </div>

      <CtaStrip slug={tutor.slug as string} scale={scale} fg={fg} borderColor={dark ? NEUTRAL.slate800 : NEUTRAL.slate200} />
    </div>
  )
}

// -------------------------------------------------------- success banner ----
// "Congratulations" over a bold occasion. Light ground, tinted panel.

function successBanner({ tutor, badges, format, headline }: BannerParams) {
  const scale = scaleFor(format)
  const isWide = format === 'wide'
  const subjects = ((tutor.subjects as string[]) ?? []).slice(0, 3).join(', ')
  const place = [tutor.area, tutor.city].filter(Boolean).join(', ')
  const years = Number(tutor.experience_years ?? 0)
  const occasion = headline || "You're Verified!"

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: BRAND.white, padding: Math.round(64 * scale), fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Wordmark size={Math.round(40 * scale)} dark={false} />
        <div style={{ marginLeft: 'auto', fontSize: Math.round(20 * scale), fontWeight: 700, letterSpacing: 2, color: SLATE, textTransform: 'uppercase' }}>
          Verified tutors
        </div>
      </div>

      {/* The tinted panel: greeting, occasion, portrait + identity. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(24 * scale), background: BRAND.tintGreen, borderRadius: Math.round(36 * scale), padding: Math.round(48 * scale) }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(6 * scale) }}>
          {/* "script-style": italic, in the success green. satori has only a
              sans face, so the script cue is weight + italic, not a font. */}
          <div style={{ fontSize: Math.round(40 * scale), fontStyle: 'italic', fontWeight: 600, color: GREEN, display: 'flex' }}>
            Congratulations
          </div>
          <div style={{ fontSize: Math.round(72 * scale), fontWeight: 900, color: NAVY, lineHeight: 1.02, display: 'flex' }}>
            {occasion}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: isWide ? 'row' : 'row', alignItems: 'center', gap: Math.round(28 * scale) }}>
          <Portrait tutor={tutor} size={Math.round((isWide ? 150 : 200) * 1)} radius={Math.round((isWide ? 150 : 200) * 0.22)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(12 * scale) }}>
            <div style={{ fontSize: Math.round(46 * scale), fontWeight: 900, color: NAVY, lineHeight: 1.05, display: 'flex' }}>
              {tutor.full_name as string}
            </div>
            <BadgePills badges={badges} dark={false} scale={scale} />
          </div>
        </div>
      </div>

      {/* Three facts in a soft white card. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: Math.round(32 * scale), background: BRAND.white, border: `2px solid ${NEUTRAL.slate200}`, borderRadius: Math.round(24 * scale), padding: Math.round(28 * scale) }}>
        {subjects && <Fact icon="book" label={subjects} scale={scale} />}
        {place && <Fact icon="pin" label={place} scale={scale} />}
        {years > 0 && <Fact icon="clock" label={`${years}+ years experience`} scale={scale} />}
      </div>

      <CtaStrip slug={tutor.slug as string} scale={scale} fg={NAVY} borderColor={NEUTRAL.slate200} />
    </div>
  )
}

// --------------------------------------------------- announcement banner ----
// Navy ground, oversized headline, circular portrait, gold date block.

function announcementBanner({ tutor, format, headline, subhead, dateLabel }: BannerParams) {
  const scale = scaleFor(format)
  const isWide = format === 'wide'
  const rating = Number(tutor.rating_avg ?? 0)
  const ratingCount = Number(tutor.rating_count ?? 0)
  const role = [((tutor.subjects as string[]) ?? [])[0], tutor.city].filter(Boolean).join(' · ') || 'Verified tutor'
  const title = headline || 'Announcement'

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: NAVY, padding: Math.round(64 * scale), fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Wordmark size={Math.round(40 * scale)} dark />
        {dateLabel && (
          <div style={{ marginLeft: 'auto', display: 'flex', background: GOLD, color: BRAND.black, fontWeight: 900, fontSize: Math.round(24 * scale), padding: `${Math.round(10 * scale)}px ${Math.round(22 * scale)}px`, borderRadius: 14 }}>
            {dateLabel}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(28 * scale) }}>
        <div style={{ fontSize: Math.round((isWide ? 72 : 88) * scale), fontWeight: 900, color: BRAND.white, lineHeight: 1.02, display: 'flex' }}>
          {title}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(28 * scale) }}>
          <Portrait tutor={tutor} size={Math.round((isWide ? 150 : 220) * 1)} radius={Math.round((isWide ? 150 : 220) * 1)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(10 * scale) }}>
            <div style={{ fontSize: Math.round(48 * scale), fontWeight: 900, color: BRAND.white, lineHeight: 1.05, display: 'flex' }}>
              {tutor.full_name as string}
            </div>
            <div style={{ fontSize: Math.round(28 * scale), color: NEUTRAL.slate300, display: 'flex' }}>{role}</div>
            <StarRating rating={rating} count={ratingCount} scale={scale} ink={GOLD} />
          </div>
        </div>
      </div>

      {/* Venue / detail strip. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, borderTop: `2px solid ${NEUTRAL.slate800}`, paddingTop: Math.round(28 * scale) }}>
        <div style={{ fontSize: Math.round(30 * scale), fontWeight: 800, color: BRAND.mint, display: 'flex' }}>
          {subhead || 'tutormint.org'}
        </div>
      </div>
    </div>
  )
}
