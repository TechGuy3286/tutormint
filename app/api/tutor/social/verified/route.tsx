import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { badgesForPlan } from '@/lib/planBadges'
import { absoluteUrl } from '@/lib/siteUrl'
import { cvQrDataUri } from '@/lib/cv/assets'
import { resolveSubjectLabels } from '@/lib/social/data'
import { isSocialFormat } from '@/lib/social/copy'

import { renderSocialBanner, type BannerTutor } from '@/app/api/admin/social/image/render'

// The tutor's own "You're Verified" success card, rendered on demand for the
// authenticated tutor from their OWN listed profile.
//
// tutor_directory holds only LISTED tutors, so a row here IS the check that this
// tutor may be promoted at all. It carries the same fixed brand band as every
// other social creative (wordmark, tagline once, site, handles, QR of their own
// profile) — see ./render.tsx.

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
  if (!isSocialFormat(format)) return new Response('Unknown format.', { status: 400 })

  const admin = createAdminClient()
  if (!admin) return new Response('Server not configured.', { status: 503 })

  const { data: tutor } = await admin
    .from('tutor_directory')
    .select('id, slug, full_name, headline, city, area, rating_avg, rating_count, avatar_url, experience_years, teaching_mode')
    .eq('id', user.id)
    .maybeSingle()

  if (!tutor) return new Response('Not listed yet.', { status: 404 })

  const [{ data: sub }, subjects] = await Promise.all([
    admin
      .from('subscriptions')
      .select('plan_code')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle(),
    resolveSubjectLabels(admin, user.id, 3),
  ])

  const profileUrl = absoluteUrl(`/tutor/${tutor.slug as string}`)
  const qrDataUri = await cvQrDataUri(profileUrl)

  return renderSocialBanner({
    tutor: tutor as unknown as BannerTutor,
    badges: badgesForPlan((sub?.plan_code as string) ?? null, true),
    subjects,
    format,
    template: 'success',
    qrDataUri,
    profileUrl,
    headline,
    successKind: 'verified',
  })
}
