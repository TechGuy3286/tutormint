import { ImageResponse } from 'next/og'

import { BRAND, NEUTRAL, avatarTint, initialsOf } from '@/lib/brand'
import type { BadgeName } from '@/lib/planBadges'

// The banner itself, split out from the route.
//
// The route's job is deciding WHO may generate a post and looking the tutor up;
// this file's job is what the picture looks like. They were one function, which
// meant the only way to see a change to the layout was to sign in as an admin
// and have a live, listed tutor to point at -- so in practice nobody looked at
// the three formats together, and a 12px gap sat in the wordmark publishing the
// legal name on every post we made.
//
// PIXEL-STABLE. The same input must produce identical bytes on every run, so
// nothing here reads a clock, a random number or anything else that varies
// between calls. That is what makes a regenerated post safe to re-download
// rather than subtly different.

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
}

export function renderSocialBanner({
  tutor,
  badges,
  format,
  template,
  headline,
}: {
  tutor: BannerTutor
  badges: BadgeName[]
  format: string
  template: string
  headline: string
}): Response {
  const size = FORMATS[format]
  if (!size) return new Response('Unknown format.', { status: 400 })
  const subjects = ((tutor.subjects as string[]) ?? []).slice(0, 4)
  const rating = Number(tutor.rating_avg ?? 0)
  const ratingCount = Number(tutor.rating_count ?? 0)
  const place = [tutor.area, tutor.city].filter(Boolean).join(', ')
  const line = headline || (tutor.headline as string) || 'Verified tutor on TutorMint'

  const isStory = format === 'story'
  const isWide = format === 'wide'
  const scale = isWide ? 0.62 : isStory ? 1.05 : 1

  const dark = template === 'bold'
  const bg = dark ? NAVY : BRAND.white
  const fg = dark ? BRAND.white : NAVY
  const muted = dark ? NEUTRAL.slate300 : SLATE

  // The wordmark, styled as the site styles it: Tutor in tm-black, Mint in
  // tm-red. That pairing is a light-surface one. On the navy 'bold' template
  // tm-black is invisible and tm-red is 2.2:1 against it, so the dark template
  // uses the pairing the footer and the admin header already use on dark --
  // white with tm-mint. Same brand, same rule as the rest of the site.
  const wordmarkSize = Math.round(44 * scale)
  const wordmarkFg = dark ? BRAND.white : BRAND.black
  const wordmarkAccent = dark ? BRAND.mint : RED

  // tm-gold is a fill, never text: it is 2.05:1 on white. The readable member
  // of the family is tm-gold-ink -- which is in turn far too dark on the navy
  // template, where the plain gold clears AA comfortably. The star itself is
  // filled gold on both.
  const ratingInk = dark ? GOLD : GOLD_INK

  const avatarSize = Math.round((isWide ? 180 : 300) * (isStory ? 1.1 : 1))
  const tint = avatarTint((tutor.id as string) || (tutor.full_name as string) || '?')

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: bg,
          padding: Math.round(64 * scale),
          fontFamily: 'sans-serif',
        }}
      >
        {/* Brand bar.
            TutorMint is ONE word, and getting satori to render it as one took
            more than removing the gap: 12 that used to sit on this row.
            Satori inserts a word-space between ADJACENT TEXT RUNS -- measured
            at 12px for this 44px face, about 0.27em -- so "Tutor" and "Mint"
            came out as "Tutor Mint", the two-word form reserved for the legal
            name, on every post we generated. Nesting them in their own row did
            not help; nor did display:flex on each half, nor <span>. A single
            text node renders correctly but cannot carry two colours.
            
            So the join is a negative margin of one space, scaled with the type
            rather than hardcoded, verified against a single-run control at all
            three formats. If the font ever changes, re-measure: the constant
            is that font's space advance, not a magic number. */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <div
              style={{
                fontSize: wordmarkSize,
                fontWeight: 900,
                color: wordmarkFg,
                marginRight: -Math.round(wordmarkSize * 0.273),
              }}
            >
              Tutor
            </div>
            <div style={{ fontSize: wordmarkSize, fontWeight: 900, color: wordmarkAccent }}>
              Mint
            </div>
          </div>
          <div
            style={{
              marginLeft: 'auto',
              fontSize: Math.round(20 * scale),
              fontWeight: 700,
              letterSpacing: 2,
              color: muted,
              textTransform: 'uppercase',
            }}
          >
            Verified tutors
          </div>
        </div>

        {/* The tutor */}
        <div
          style={{
            display: 'flex',
            flexDirection: isWide ? 'row' : 'column',
            alignItems: isWide ? 'center' : 'flex-start',
            gap: Math.round(36 * scale),
          }}
        >
          {/* The same initials disc as components/Avatar.tsx, through the
              shared palette in lib/brand.ts -- so a tutor with no photo is the
              same colour with the same letters here as on their own card. It
              used to be a grey disc with a single red letter, which matched
              nothing on the site. */}
          <div
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarSize,
              background: tutor.avatar_url ? NEUTRAL.slate100 : tint.bg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: Math.round(avatarSize * 0.36),
              fontWeight: 900,
              color: tint.fg,
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {tutor.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tutor.avatar_url as string}
                alt=""
                width={avatarSize}
                height={avatarSize}
                style={{ objectFit: 'cover', width: avatarSize, height: avatarSize }}
              />
            ) : (
              initialsOf(tutor.full_name as string)
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(14 * scale) }}>
            <div style={{ fontSize: Math.round(64 * scale), fontWeight: 900, color: fg, lineHeight: 1.05 }}>
              {tutor.full_name as string}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              {badges.map((b) => {
                // The Premium badge is navy on navy on the 'bold' template --
                // it rendered as bare white text with no pill at all, which
                // reads as a missing badge rather than a styled one. On a navy
                // ground it inverts: navy ink on white, keeping navy as the
                // colour that identifies Premium either way. Verified and
                // Featured carry their own fills on both grounds.
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
                      background: inverted
                        ? BRAND.white
                        : b === 'Verified'
                          ? GREEN
                          : b === 'Premium'
                            ? BRAND.navy
                            : GOLD,
                    }}
                  >
                    {b}
                  </div>
                )
              })}
            </div>

            <div style={{ fontSize: Math.round(30 * scale), color: muted, lineHeight: 1.3, display: 'flex' }}>
              {line}
            </div>

            {subjects.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {subjects.map((s) => (
                  <div
                    key={s}
                    style={{
                      display: 'flex',
                      padding: `${Math.round(8 * scale)}px ${Math.round(18 * scale)}px`,
                      borderRadius: 12,
                      fontSize: Math.round(22 * scale),
                      fontWeight: 700,
                      color: fg,
                      background: dark ? NEUTRAL.slate800 : NEUTRAL.slate100,
                    }}
                  >
                    {s}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: Math.round(28 * scale), fontSize: Math.round(26 * scale), color: muted }}>
              {place && <div style={{ display: 'flex' }}>{place}</div>}
              {ratingCount > 0 && (
                /* An inline SVG, not the ★ glyph. satori renders text with the
                   fonts it is given, and U+2605 is not in a plain sans-serif
                   face -- it came out as a blank box or vanished, depending on
                   the host. A path always draws. */
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ratingInk, fontWeight: 800 }}>
                  <svg
                    width={Math.round(26 * scale)}
                    height={Math.round(26 * scale)}
                    viewBox="0 0 24 24"
                    fill={GOLD}
                  >
                    <path d="M12 2.6l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.4l-5.8 3.06 1.11-6.46-4.7-4.58 6.49-.94z" />
                  </svg>
                  <div style={{ display: 'flex' }}>
                    {rating.toFixed(1)} ({ratingCount})
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            borderTop: `2px solid ${dark ? NEUTRAL.slate800 : NEUTRAL.slate200}`,
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
            /tutor/{tutor.slug as string}
          </div>
        </div>
      </div>
    ),
    { width: size.width, height: size.height },
  )
}
