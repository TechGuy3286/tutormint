import { ImageResponse } from 'next/og'

import { BRAND, NEUTRAL } from '@/lib/brand'
import type { CoverSelection } from './select'

// The composed blog cover render — 1200x630, satori.
//
// This file imports next/og and the brand LITERALS and NOTHING server-only, so
// it renders under the test runner too (scripts/test-covers.ts decodes one PNG
// per background). Asset loading (fs / CDN -> data URI) lives in
// lib/covers/assets.ts, which IS server-only; the caller loads the URIs and
// passes them in here. Same reason the social copy is split from the social
// render.
//
// PIXEL-STABLE and BRAND TOKENS ONLY (as hex literals — satori resolves neither
// Tailwind nor var()). Nothing here reads a clock or a random number; the same
// (post, seed) always paints the same picture.

export const COVER_W = 1200
export const COVER_H = 630

export type ComposeAssets = {
  /** City silhouette / map data URI, or null (layer omitted). */
  city: string | null
  /** Person data URI, or null. */
  person: string | null
  /** Up to two motif data URIs (nulls dropped). */
  motifs: (string | null)[]
}

const BG: Record<CoverSelection['background'], string> = {
  white: BRAND.white,
  mint: BRAND.tintGreen,
  navy: BRAND.navy,
}

function titleSize(t: string): number {
  const n = t.length
  if (n <= 34) return 66
  if (n <= 60) return 54
  if (n <= 95) return 46
  return 40
}

/** A motif in a soft rounded card, so a coloured illustration is legible on any
 *  ground (a white card vanishes on white, so light grounds use a tinted card). */
function MotifCard({ uri, background, size }: { uri: string; background: CoverSelection['background']; size: number }) {
  const card = background === 'white' ? BRAND.tintNavy : BRAND.white
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 26,
        background: card,
        padding: Math.round(size * 0.16),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={uri} width={Math.round(size * 0.68)} height={Math.round(size * 0.68)} style={{ objectFit: 'contain' }} alt="" />
    </div>
  )
}

export function renderCoverPng({
  title,
  selection,
  assets,
}: {
  title: string
  selection: CoverSelection
  assets: ComposeAssets
}): Response {
  const isNavy = selection.background === 'navy'
  const ink = selection.titleColor === 'white' ? BRAND.white : BRAND.navy
  const bg = BG[selection.background]
  const arr = selection.arrangement
  const cleanTitle = (title || 'TutorMint').slice(0, 130)
  const tSize = titleSize(cleanTitle)
  const motifs = assets.motifs.filter((m): m is string => !!m).slice(0, 2)

  // Fixed, non-overlapping zones — a top band for the site line + wordmark, the
  // title upper-left, motifs below it, the city silhouette across the bottom
  // and the person bottom-right. The three arrangements differ by background and
  // by where the title and motifs sit; nothing lands on the person or on text.
  const cityHeight = 174
  // A navy skyline is invisible on navy, so seed 2 lays a light "stage" band
  // across the bottom for the silhouette (and the lower half of the person) to
  // read against.
  const stageHeight = cityHeight + 82

  const titleTop = arr === 1 ? 150 : 120
  const motifTop = arr === 1 ? 332 : 300

  return new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          display: 'flex',
          width: '100%',
          height: '100%',
          background: bg,
          fontFamily: 'sans-serif',
          overflow: 'hidden',
        }}
      >
        {isNavy && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: stageHeight,
              display: 'flex',
              background: BRAND.tintGreen,
              borderTopLeftRadius: 44,
              borderTopRightRadius: 44,
            }}
          />
        )}

        {/* City silhouette / map — bottom-left. */}
        {assets.city && (
          <img
            // eslint-disable-next-line @next/next/no-img-element
            src={assets.city}
            alt=""
            height={cityHeight}
            style={{ position: 'absolute', left: 44, bottom: 18, objectFit: 'contain', opacity: 0.95 }}
          />
        )}

        {/* Person — bottom-right, clear of all text. */}
        {assets.person && (
          <img
            // eslint-disable-next-line @next/next/no-img-element
            src={assets.person}
            alt=""
            height={470}
            style={{ position: 'absolute', right: 36, bottom: 0, objectFit: 'contain' }}
          />
        )}

        {/* Motifs — below the title, on the left. */}
        {motifs.length > 0 && (
          <div style={{ position: 'absolute', top: motifTop, left: 64, display: 'flex', gap: 16 }}>
            {motifs.map((m, i) => (
              <MotifCard key={i} uri={m} background={selection.background} size={108} />
            ))}
          </div>
        )}

        {/* Site line — top-left, recessive. */}
        <div
          style={{
            position: 'absolute',
            top: 34,
            left: 64,
            display: 'flex',
            fontSize: 20,
            fontWeight: 700,
            color: isNavy ? BRAND.mint : NEUTRAL.slate700,
          }}
        >
          tutormint.org
        </div>

        {/* Wordmark — top-right, always above the person. One word: the negative
            margin defeats satori's word-space between the two colour runs. On
            navy the readable pairing is white + mint (as the footer uses); on
            light grounds it is black + red. */}
        <div style={{ position: 'absolute', top: 28, right: 56, display: 'flex', alignItems: 'baseline' }}>
          <div
            style={{
              fontSize: 30,
              fontWeight: 900,
              color: isNavy ? BRAND.white : BRAND.black,
              marginRight: -Math.round(30 * 0.273),
            }}
          >
            Tutor
          </div>
          <div style={{ fontSize: 30, fontWeight: 900, color: isNavy ? BRAND.mint : BRAND.red }}>Mint</div>
        </div>

        {/* Title. Capped at three lines with an ellipsis (the webkit line-clamp
            trio, which satori honours) so a long title never spills, and narrow
            enough to never reach the person. */}
        <div
          style={{
            position: 'absolute',
            top: titleTop,
            left: 64,
            width: 560,
            fontSize: tSize,
            fontWeight: 800,
            color: ink,
            lineHeight: 1.1,
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 3,
            overflow: 'hidden',
          }}
        >
          {cleanTitle}
        </div>
      </div>
    ),
    { width: COVER_W, height: COVER_H },
  )
}
