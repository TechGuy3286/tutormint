import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { badgesForPlan } from '@/lib/planBadges'

import { FORMATS, renderSocialBanner, type BannerTutor } from './render'

// Who may generate a promotional PNG, and which tutor it is about.
//
// Everything except one headline line comes from the live profile, on purpose:
// the point of generating these is that what we publish about a tutor matches
// what the site says about them. A free-text poster would drift from the
// profile within a week and there would be no way to tell which was true.
//
// The picture itself is ./render.tsx.
//
// The picker reads tutor_directory, which already excludes suspended tutors and
// unclaimed imports -- we do not publish posts about people the site itself
// will not show. Photo-use consent is granted in the tutor signup terms and,
// for imported profiles, in the claim flow.

export const runtime = 'nodejs'

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
  const subhead = (url.searchParams.get('subhead') ?? '').slice(0, 90)
  const dateLabel = (url.searchParams.get('date') ?? '').slice(0, 40)

  if (!FORMATS[format]) return new Response('Unknown format.', { status: 400 })

  const admin = createAdminClient()
  if (!admin) return new Response('Server not configured.', { status: 503 })

  const { data: tutor } = await admin
    .from('tutor_directory')
    .select('id, slug, full_name, headline, city, area, subjects, rating_avg, rating_count, avatar_url, experience_years')
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

  return renderSocialBanner({
    tutor: tutor as unknown as BannerTutor,
    badges: badgesForPlan((sub?.plan_code as string) ?? null, true),
    format,
    template,
    headline,
    subhead,
    dateLabel,
  })
}
