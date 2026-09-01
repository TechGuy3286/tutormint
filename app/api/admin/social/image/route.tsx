import { ImageResponse } from 'next/og'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { badgesForPlan } from '@/lib/planBadges'

// Render a promotional PNG from a tutor's live profile.
//
// Everything except one headline line comes from the profile, on purpose: the
// point of generating these is that what we publish about a tutor matches what
// the site says about them. A free-text poster would drift from the profile
// within a week and there would be no way to tell which was true.
//
// PIXEL-STABLE. The same tutor, template and format must produce identical
// bytes on every run, so nothing here reads a clock, a random number or
// anything else that varies between calls. That is what makes a regenerated
// post safe to re-download rather than subtly different.
//
// Photo-use consent is granted in the tutor signup terms and, for imported
// profiles, in the claim flow.

export const runtime = 'nodejs'

const FORMATS: Record<string, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  wide: { width: 1200, height: 630 },
}

const RED = '#d60008'
const NAVY = '#0F172A'
const SLATE = '#334155'
const GREEN = '#059669'
const GOLD = '#F59E0B'

export async function GET(request: Request) {
  // Not checkAdminRole: this returns an image, and an HTML error page in an
  // <img> is worse than a plain status.
  const actor = await getAdminActor()
  if (!actor || !roleSatisfies(actor.adminRole, SCREEN_ACCESS.social)) {
    return new Response('Not allowed.', { status: 403 })
  }

  const url = new URL(request.url)
  const slug = url.searchParams.get('slug') ?? ''
  const format = url.searchParams.get('format') ?? 'square'
  const template = url.searchParams.get('template') ?? 'spotlight'
  const headline = (url.searchParams.get('headline') ?? '').slice(0, 90)

  const size = FORMATS[format]
  if (!size) return new Response('Unknown format.', { status: 400 })

  const admin = createAdminClient()
  if (!admin) return new Response('Server not configured.', { status: 503 })

  const { data: tutor } = await admin
    .from('tutor_directory')
    .select('id, slug, full_name, headline, city, area, subjects, rating_avg, rating_count, avatar_url')
    .eq('slug', slug)
    .maybeSingle()

  if (!tutor) return new Response('Tutor not found or not listed.', { status: 404 })

  const { data: sub } = await admin
    .from('subscriptions')
    .select('plan_code')
    .eq('user_id', tutor.id as string)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()

  const badges = badgesForPlan((sub?.plan_code as string) ?? null, true)
  const subjects = ((tutor.subjects as string[]) ?? []).slice(0, 4)
  const rating = Number(tutor.rating_avg ?? 0)
  const ratingCount = Number(tutor.rating_count ?? 0)
  const place = [tutor.area, tutor.city].filter(Boolean).join(', ')
  const line = headline || (tutor.headline as string) || 'Verified tutor on TutorMint'

  const isStory = format === 'story'
  const isWide = format === 'wide'
  const scale = isWide ? 0.62 : isStory ? 1.05 : 1

  const dark = template === 'bold'
  const bg = dark ? NAVY : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : NAVY
  const muted = dark ? '#CBD5E1' : SLATE

  const avatarSize = Math.round((isWide ? 180 : 300) * (isStory ? 1.1 : 1))

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
        {/* Brand bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: Math.round(44 * scale), fontWeight: 900, color: fg }}>Tutor</div>
          <div style={{ fontSize: Math.round(44 * scale), fontWeight: 900, color: RED }}>Mint</div>
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
          <div
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarSize,
              background: dark ? '#1E293B' : '#F1F5F9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: Math.round(avatarSize * 0.4),
              fontWeight: 900,
              color: RED,
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
              (tutor.full_name as string).slice(0, 1).toUpperCase()
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(14 * scale) }}>
            <div style={{ fontSize: Math.round(64 * scale), fontWeight: 900, color: fg, lineHeight: 1.05 }}>
              {tutor.full_name as string}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              {badges.map((b) => (
                <div
                  key={b}
                  style={{
                    display: 'flex',
                    padding: `${Math.round(8 * scale)}px ${Math.round(18 * scale)}px`,
                    borderRadius: 999,
                    fontSize: Math.round(22 * scale),
                    fontWeight: 800,
                    color: '#FFFFFF',
                    background: b === 'Verified' ? GREEN : b === 'Premium' ? '#1E293B' : GOLD,
                  }}
                >
                  {b}
                </div>
              ))}
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
                      background: dark ? '#1E293B' : '#F1F5F9',
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
                <div style={{ display: 'flex', color: GOLD, fontWeight: 800 }}>
                  {rating.toFixed(1)} ★ ({ratingCount})
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
            borderTop: `2px solid ${dark ? '#1E293B' : '#E2E8F0'}`,
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
              color: '#FFFFFF',
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
