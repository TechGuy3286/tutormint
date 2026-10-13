/* eslint-disable @next/next/no-img-element -- satori draws these; next/image does not apply */
import type { ReactElement } from 'react'
import { ImageResponse } from 'next/og'

import { BRAND, NEUTRAL } from '@/lib/brand'
import { BRAND_LINE_GROWING, coverTextProblem } from '@/lib/brandClaims'
import { SITE_TAGLINE } from '@/lib/siteIdentity'
import type { CoverSelection } from './select'

// The composed blog cover render — 1200x630, satori.
//
// ONE FIXED BRAND LAYOUT for every cover (owner, 14 Oct 2026), in two layers:
//
//   sceneLayer()    the PICTURE: the right-hand panel with the city, the person
//                   and the motifs. It contains NO text of any kind.
//   overlayLayer()  everything that is read: the TutorMint logo (top-left, the
//                   clean lockup), the title (navy on white, at most three
//                   lines, auto-sized, inside safe margins), the brand line,
//                   the tagline and the site address. All of it is typed by
//                   code, so the spelling is always right.
//
// The three options of a request differ in the SCENE (its ground, the person,
// the motifs); the overlay never moves.
//
// This file imports next/og and the brand LITERALS and NOTHING server-only, so
// it renders under the test runner too (scripts/test-covers.ts decodes one PNG
// per scene ground). Asset loading (fs / CDN -> data URI) lives in
// lib/covers/assets.ts, which IS server-only; the caller loads the URIs and
// passes them in here.
//
// PIXEL-STABLE and BRAND TOKENS ONLY (as hex literals — satori resolves neither
// Tailwind nor var()). Nothing here reads a clock or a random number; the same
// (post, seed) always paints the same picture.

export const COVER_W = 1200
export const COVER_H = 630

/** The fixed layout: a white text column, then the scene panel. */
export const COVER_LAYOUT = {
  margin: 56,
  textWidth: 620,
  sceneLeft: 728,
  sceneWidth: COVER_W - 728,
  logoHeight: 76,
  titleTop: 168,
  titleMaxLines: 3,
} as const

export type ComposeAssets = {
  /** City silhouette / map data URI, or null (layer omitted). */
  city: string | null
  /** Person data URI, or null. */
  person: string | null
  /** Up to two motif data URIs (nulls dropped). */
  motifs: (string | null)[]
  /** The clean TutorMint logo lockup (public/brand), or null — then the
   *  wordmark is typed instead. */
  logo?: string | null
}

// The scene panel's ground. The text column is always white.
const SCENE_BG: Record<CoverSelection['background'], string> = {
  white: BRAND.tintNavy,
  mint: BRAND.tintGreen,
  navy: BRAND.navy,
}

/** Title size from its length, so up to three lines fit the text column. */
export function titleSize(t: string): number {
  const n = t.length
  if (n <= 30) return 62
  if (n <= 55) return 52
  if (n <= 85) return 44
  return 38
}

/**
 * Thrown when a cover would carry a banned claim ("largest", "best", "No.1",
 * "#1", "most trusted" — lib/brandClaims). The routes turn it into a 400 with
 * the words; a cover with such text is never rendered.
 */
export class CoverTextError extends Error {}

/**
 * The PICTURE. Images and plain shapes only — no text node anywhere
 * (scripts/test-covers.ts walks this tree and fails on any string).
 */
export function sceneLayer(selection: CoverSelection, assets: ComposeAssets): ReactElement {
  const L = COVER_LAYOUT
  const isNavy = selection.background === 'navy'
  const motifs = assets.motifs.filter((m): m is string => !!m).slice(0, 2)
  const card = isNavy ? BRAND.tintGreen : BRAND.white
  const cardSize = 112
  return (
    <div
      style={{
        position: 'absolute',
        left: L.sceneLeft,
        top: 0,
        width: L.sceneWidth,
        height: COVER_H,
        display: 'flex',
        background: SCENE_BG[selection.background],
        borderTopLeftRadius: 56,
        borderBottomLeftRadius: 56,
        overflow: 'hidden',
      }}
    >
      {/* A navy skyline is invisible on navy, so the navy scene lays a light
          stage across the bottom for the silhouette and the person's feet. */}
      {isNavy && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 210, display: 'flex', background: BRAND.tintGreen }} />
      )}

      {/* City silhouette / map — along the bottom, behind the person. */}
      {assets.city && (
        <img
          src={assets.city}
          alt=""
          height={150}
          style={{ position: 'absolute', left: 20, bottom: 14, objectFit: 'contain', opacity: 0.9 }}
        />
      )}

      {/* Motifs — top of the scene, in soft cards so they read on any ground. */}
      {motifs.map((m, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: 44 + (selection.variant === 1 ? i * 18 : 0),
            left: 36 + i * (cardSize + 16),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: cardSize,
            height: cardSize,
            borderRadius: 26,
            background: card,
          }}
        >
          <img src={m} width={76} height={76} style={{ objectFit: 'contain' }} alt="" />
        </div>
      ))}

      {/* Person — bottom-right of the scene. */}
      {assets.person && (
        <img
          src={assets.person}
          alt=""
          height={410}
          style={{ position: 'absolute', right: 24, bottom: 0, objectFit: 'contain' }}
        />
      )}
    </div>
  )
}

/**
 * Everything that is READ. The logo, the title, the brand line, the tagline
 * and the site address — typed by code on the white text column.
 */
export function overlayLayer({
  title,
  brandLine,
  tagline,
  logo,
}: {
  title: string
  brandLine: string
  tagline: string
  logo: string | null
}): ReactElement {
  const L = COVER_LAYOUT
  const cleanTitle = (title || 'TutorMint').slice(0, 130)
  const size = titleSize(cleanTitle)
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: L.sceneLeft, height: COVER_H, display: 'flex' }}>
      {/* Logo — always top-left. The clean lockup when it loaded; the typed
          wordmark (one word: the negative margin defeats satori's word-space
          between the two colour runs) when it did not. */}
      {logo ? (
        <img
          src={logo}
          alt=""
          height={L.logoHeight}
          width={Math.round((L.logoHeight * 2048) / 752)}
          style={{ position: 'absolute', top: 40, left: L.margin - 6, objectFit: 'contain' }}
        />
      ) : (
        <div style={{ position: 'absolute', top: 52, left: L.margin, display: 'flex', alignItems: 'baseline' }}>
          <div style={{ fontSize: 40, fontWeight: 900, color: BRAND.black, marginRight: -Math.round(40 * 0.273) }}>Tutor</div>
          <div style={{ fontSize: 40, fontWeight: 900, color: BRAND.red }}>Mint</div>
        </div>
      )}

      {/* Title. Capped at three lines with an ellipsis (the webkit line-clamp
          trio, which satori honours) so a long title never spills, and held
          inside the text column so it never reaches the scene. */}
      <div
        style={{
          position: 'absolute',
          top: L.titleTop,
          left: L.margin,
          width: L.textWidth,
          fontSize: size,
          fontWeight: 800,
          color: BRAND.navy,
          lineHeight: 1.12,
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: L.titleMaxLines,
          overflow: 'hidden',
        }}
      >
        {cleanTitle}
      </div>

      {/* Brand line — computed, never a superlative. */}
      <div style={{ position: 'absolute', left: L.margin, bottom: 112, display: 'flex', fontSize: 22, fontWeight: 600, color: NEUTRAL.slate700 }}>
        {brandLine}
      </div>

      {/* Tagline — exactly the site's. */}
      <div style={{ position: 'absolute', left: L.margin, bottom: 76, display: 'flex', fontSize: 22, fontWeight: 800, color: BRAND.red }}>
        {tagline}
      </div>

      {/* Site address. */}
      <div style={{ position: 'absolute', left: L.margin, bottom: 40, display: 'flex', fontSize: 19, fontWeight: 700, color: BRAND.navy }}>
        tutormint.org
      </div>
    </div>
  )
}

export function renderCoverPng({
  title,
  selection,
  assets,
  brandLine = BRAND_LINE_GROWING,
  tagline = SITE_TAGLINE,
}: {
  title: string
  selection: CoverSelection
  assets: ComposeAssets
  /** The brand line — lib/brandClaims brandLine(), from the live count of
   *  tutors holding the Verified badge. Never a superlative. */
  brandLine?: string
  tagline?: string
}): Response {
  // THE GUARD (owner, 13 Oct 2026): no text on a cover may make a claim we
  // cannot prove. Checked here, at the one place every cover is painted, on
  // every word the overlay types.
  const problem = coverTextProblem(`${title} ${brandLine} ${tagline}`)
  if (problem) throw new CoverTextError(problem)

  return new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          display: 'flex',
          width: '100%',
          height: '100%',
          background: BRAND.white,
          fontFamily: 'sans-serif',
          overflow: 'hidden',
        }}
      >
        {sceneLayer(selection, assets)}
        {overlayLayer({ title, brandLine, tagline, logo: assets.logo ?? null })}
      </div>
    ),
    { width: COVER_W, height: COVER_H },
  )
}
