import { ImageResponse } from 'next/og'

import { BRAND, NEUTRAL } from '@/lib/brand'

// The generated blog cover, split from its routes.
//
// The routes decide WHO may render one and where it goes; this file decides
// what the picture looks like. Same split, and same reason, as the social
// banner (app/api/admin/social/image/render.tsx): a layout you can only see by
// signing in as an admin and pointing at a live post is a layout nobody looks
// at, and a cover nobody looks at is how a wordmark ends up wrong on every post.
//
// PIXEL-STABLE. The same (title, cluster, size) must produce identical bytes on
// every run -- nothing here reads a clock or a random number. The template is
// chosen by a hash of the cluster slug, so a cluster always gets the same one.
//
// BRAND TOKENS ONLY, as literals: satori resolves neither Tailwind classes nor
// var(), so every colour is a value from lib/brand.ts -- the same discipline as
// the badges and the social banner.

export const COVER_SIZES: Record<string, { width: number; height: number }> = {
  wide: { width: 1200, height: 630 }, // the post + OG card
  square: { width: 1080, height: 1080 }, // social
}

// Four templates, chosen by cluster so the /blog index is not uniform. Each is
// a tinted ground with navy title text -- gold and mint are fills, never text,
// so a title never sits in either. The accent is a fill behind a simple glyph.
const TEMPLATES = [
  { ground: BRAND.tintNavy, accent: BRAND.navy, glyph: 'book' },
  { ground: BRAND.tintGreen, accent: BRAND.greenDeep, glyph: 'cap' },
  { ground: BRAND.tintGold, accent: BRAND.goldInk, glyph: 'star' },
  { ground: BRAND.tintRed, accent: BRAND.red, glyph: 'chat' },
] as const

// Each cluster maps to a fixed template, so a "Boards & exams" cover always
// looks the way "Boards & exams" covers look. Unknown clusters hash in.
const CLUSTER_TEMPLATE: Record<string, number> = {
  'cost-hiring': 0,
  'boards-exams': 1,
  'subject-guides': 2,
  'city-guides': 0,
  'tutor-career': 1,
  'safety-trust': 3,
  urdu: 2,
}

function hashIndex(s: string, n: number): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % n
}

function Glyph({ kind, color, size }: { kind: string; color: string; size: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.6 }
  if (kind === 'cap') {
    return (
      <svg {...common}>
        <path d="M22 10L12 5 2 10l10 5 10-5z" strokeLinejoin="round" />
        <path d="M6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5" strokeLinejoin="round" />
      </svg>
    )
  }
  if (kind === 'star') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12 2.6l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.4l-5.8 3.06 1.11-6.46-4.7-4.58 6.49-.94z" />
      </svg>
    )
  }
  if (kind === 'chat') {
    return (
      <svg {...common}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinejoin="round" />
      </svg>
    )
  }
  // book
  return (
    <svg {...common}>
      <path d="M4 5c0-1 1-2 3-2s5 1 5 2v16c0-1-2-2-5-2s-3 1-3 1zM20 5c0-1-1-2-3-2s-5 1-5 2v16c0-1 2-2 5-2s3 1 3 1z" strokeLinejoin="round" />
    </svg>
  )
}

export function renderCover({
  title,
  clusterLabel,
  size,
}: {
  title: string
  clusterLabel: string
  size: 'wide' | 'square'
}): Response {
  const dim = COVER_SIZES[size]
  const isSquare = size === 'square'
  const t = TEMPLATES[CLUSTER_TEMPLATE[clusterLabelToSlug(clusterLabel)] ?? hashIndex(clusterLabel, TEMPLATES.length)]

  const pad = isSquare ? 88 : 72
  const titleSize = isSquare ? 76 : 66
  const wordmarkSize = isSquare ? 40 : 36

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: t.ground,
          padding: pad,
          fontFamily: 'sans-serif',
        }}
      >
        {/* Cluster chip + glyph */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div
            style={{
              display: 'flex',
              padding: '10px 22px',
              borderRadius: 999,
              background: BRAND.white,
              color: t.accent,
              fontSize: isSquare ? 26 : 24,
              fontWeight: 800,
            }}
          >
            {clusterLabel}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: isSquare ? 96 : 84,
              height: isSquare ? 96 : 84,
              borderRadius: 24,
              background: BRAND.white,
            }}
          >
            <Glyph kind={t.glyph} color={t.accent} size={isSquare ? 52 : 46} />
          </div>
        </div>

        {/* Title — navy on the tinted ground, always readable. */}
        <div
          style={{
            display: 'flex',
            fontSize: titleSize,
            fontWeight: 900,
            color: BRAND.navy,
            lineHeight: 1.08,
            // Trim a runaway title so the layout never overflows.
            ...(title.length > 120 ? { fontSize: titleSize - 18 } : {}),
          }}
        >
          {title.slice(0, 140)}
        </div>

        {/* Wordmark — TutorMint, one word. Tutor in tm-black, Mint in tm-red,
            the same light-surface pairing the site uses; the negative margin
            defeats satori's word-space between the two runs, measured against
            this face exactly as the social banner documents. */}
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <div
            style={{
              fontSize: wordmarkSize,
              fontWeight: 900,
              color: BRAND.black,
              marginRight: -Math.round(wordmarkSize * 0.273),
            }}
          >
            Tutor
          </div>
          <div style={{ fontSize: wordmarkSize, fontWeight: 900, color: BRAND.red }}>Mint</div>
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              fontSize: isSquare ? 24 : 22,
              fontWeight: 700,
              color: NEUTRAL.slate700,
            }}
          >
            tutormint.org
          </div>
        </div>
      </div>
    ),
    { width: dim.width, height: dim.height },
  )
}

// The route passes the cluster's display label; map it back to its slug for the
// fixed-template lookup. A label that is not one of ours hashes instead.
function clusterLabelToSlug(label: string): string {
  const map: Record<string, string> = {
    'Cost & hiring': 'cost-hiring',
    'Boards & exams': 'boards-exams',
    'Subject guides': 'subject-guides',
    'City guides': 'city-guides',
    'Tutor career': 'tutor-career',
    'Safety & trust': 'safety-trust',
    Urdu: 'urdu',
  }
  return map[label] ?? label
}
