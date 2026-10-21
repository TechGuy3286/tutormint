import { createAdminClient } from '@/lib/supabase/admin'
import { brandMonogramDataUri } from '@/lib/covers/assets'
import { cvQrDataUri } from '@/lib/cv/assets'
import { loadPostTutor } from '@/lib/social/postTutor'
import { PROFILE_CTA, SITE } from '@/lib/social/copy'
import { renderSocialBanner } from '@/app/api/admin/social/image/render'

// The link-preview image of a tutor profile (og:image / twitter:image) — owner,
// 21 Oct 2026, PR C3. 1200 × 630, the C2 Wide design with the tutor's photo, or
// the grey silhouette when they hid it (the real photo is then never read).
//
//   - A VERIFIED tutor (the Social posts rule — fee paid, CNIC, photo and selfie
//     approved) gets the "I'm a Verified Tutor" look.
//   - Anyone else gets the neutral "Tutor on TutorMint" look, which never says
//     Verified and has no ✓ badge.
//   - A profile that may not be shown in a preview (under review, an unclaimed
//     import, or not public at all) gets 404 — its page uses the site default.
//
// Not under /api (robots.txt disallows that, and link-preview crawlers honour
// it). Cached for a day at the edge and served stale for a week; the page puts a
// version of the drawn facts in the URL (lib/seo/tutorOg.ts), so a new photo,
// name or verification is a new URL and is fetched fresh.

export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const admin = createAdminClient()
  if (!admin) return new Response('Server not configured.', { status: 503 })

  const { data: visible } = await admin.from('tutor_visible_profiles').select('id').eq('slug', slug).maybeSingle()
  if (!visible) return new Response('Not found.', { status: 404 })
  const { data: flags } = await admin.from('tutor_profiles').select('under_review, imported, claimed_at').eq('id', visible.id as string).maybeSingle()
  if (flags?.under_review || (flags?.imported && !flags?.claimed_at)) return new Response('Not found.', { status: 404 })

  const post = await loadPostTutor(admin, slug)
  if (!post || post.isFixture) return new Response('Not found.', { status: 404 })

  const [qrDataUri, logoDataUri] = await Promise.all([cvQrDataUri(post.profileUrl), brandMonogramDataUri()])
  const verified = post.eligible
  const res = renderSocialBanner({
    tutor: post.tutor,
    badges: verified ? post.badges : [],
    subjects: post.subjects,
    subjectParts: post.subjectParts,
    format: 'wide',
    template: verified ? 'verified' : 'profile',
    qrDataUri,
    profileUrl: post.profileUrl,
    // The line under "I'm a Verified Tutor" is the tutor's own headline.
    headline: verified ? (post.tutor.headline ?? '') : '',
    logoDataUri,
    verified,
    cta: { label: PROFILE_CTA, site: SITE },
  })
  const body = await res.arrayBuffer()
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
}
