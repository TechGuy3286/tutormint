import { ImageResponse } from 'next/og'
import { BRAND } from '@/lib/brand'
import { brandMonogramDataUri } from '@/lib/covers/assets'
import { POST_TUITION_HEADING, POST_TUITION_STEPS } from '@/lib/postTuitionPage'

// The link preview of /post-tuition (owner, 28 Oct 2026): 1200×630, brand
// colours, the heading and the three steps. No price, no claim. Not under /api
// (robots.txt disallows it, and link-preview crawlers honour that).

export const runtime = 'nodejs'

export async function GET() {
  const logo = await brandMonogramDataUri().catch(() => null)
  const res = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: BRAND.bg,
          padding: '64px 72px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {logo ? <img src={logo} width={72} height={67} alt="" /> : null}
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 800, color: BRAND.navy }}>
            Tutor
            <span style={{ color: BRAND.red, marginLeft: -11 }}>Mint</span>
          </div>
        </div>
        <div style={{ display: 'flex', marginTop: 48, fontSize: 72, fontWeight: 800, color: BRAND.navy, lineHeight: 1.1 }}>
          {POST_TUITION_HEADING}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 36, gap: 18 }}>
          {POST_TUITION_STEPS.map((step, i) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  background: BRAND.tintGreen,
                  color: BRAND.greenDeep,
                  fontSize: 26,
                  fontWeight: 800,
                }}
              >
                {String(i + 1)}
              </div>
              <div style={{ display: 'flex', fontSize: 34, color: BRAND.black }}>{step}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', marginTop: 'auto', fontSize: 26, fontWeight: 700, color: BRAND.greenDeep }}>
          tutormint.org/post-tuition
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
  const body = await res.arrayBuffer()
  return new Response(body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
}
