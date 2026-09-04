import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { badgesForPlan } from '@/lib/planBadges'

import { FORMATS, renderSocialBanner, type BannerTutor } from '@/app/api/admin/social/image/render'

// The tutor's own "You're Verified" success card, rendered on demand for the
// authenticated tutor from their OWN listed profile.
//
// This is the tutor-facing counterpart to the admin social generator: the
// dashboard shows this image with share buttons the moment a tutor becomes
// LISTED (verified, 100%, not suspended, claimed). It reads tutor_directory
// keyed on the caller's own id, so a tutor can only ever render their own card,
// and only when they are actually listed — which is the same condition under
// which their badge appears. Photo-use consent came with the signup terms (or
// the claim flow for an imported profile); with no photo the initials disc
// renders instead.
//
// Rendered on demand rather than stored — pixel-stable, same as every other
// next/og surface — so there is no PNG to keep in sync with the profile.

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('Sign in.', { status: 401 })

  const url = new URL(request.url)
  const format = url.searchParams.get('format') ?? 'square'
  const headline = (url.searchParams.get('headline') ?? "You're Verified!").slice(0, 90)
  if (!FORMATS[format]) return new Response('Unknown format.', { status: 400 })

  const admin = createAdminClient()
  if (!admin) return new Response('Server not configured.', { status: 503 })

  // tutor_directory holds only LISTED tutors, so a row here IS the check that
  // this tutor may be promoted at all — no separate listing test needed.
  const { data: tutor } = await admin
    .from('tutor_directory')
    .select('id, slug, full_name, headline, city, area, subjects, rating_avg, rating_count, avatar_url, experience_years')
    .eq('id', user.id)
    .maybeSingle()

  if (!tutor) return new Response('Not listed yet.', { status: 404 })

  const { data: sub } = await admin
    .from('subscriptions')
    .select('plan_code')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()

  return renderSocialBanner({
    tutor: tutor as unknown as BannerTutor,
    badges: badgesForPlan((sub?.plan_code as string) ?? null, true),
    format,
    template: 'success',
    headline,
  })
}
