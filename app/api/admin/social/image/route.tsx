import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { badgesForPlan } from '@/lib/planBadges'
import { absoluteUrl } from '@/lib/siteUrl'
import { cvQrDataUri } from '@/lib/cv/assets'
import { resolveSubjectLabels } from '@/lib/social/data'
import { isSocialFormat, isSocialTemplate } from '@/lib/social/copy'

import { renderSocialBanner, type BannerTutor } from './render'

// Who may generate a promotional PNG, and which tutor it is about.
//
// Everything except one headline line comes from the live profile, on purpose:
// the point of generating these is that what we publish about a tutor matches
// what the site says about them. The picker reads tutor_directory, which
// already excludes suspended tutors and unclaimed imports.
//
// The picture itself is ./render.tsx; the QR (same qrcode helper the CV uses)
// and the resolved subjects are built here and handed in.

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
  const successKind = url.searchParams.get('kind') === 'hired' ? 'hired' : 'verified'

  if (!isSocialFormat(format)) return new Response('Unknown format.', { status: 400 })
  if (!isSocialTemplate(template)) return new Response('Unknown template.', { status: 400 })

  const admin = createAdminClient()
  if (!admin) return new Response('Server not configured.', { status: 503 })

  const { data: tutor } = await admin
    .from('tutor_directory')
    .select('id, slug, full_name, headline, city, area, rating_avg, rating_count, avatar_url, experience_years, teaching_mode')
    .eq('slug', slug)
    .maybeSingle()

  if (!tutor) return new Response('Tutor not found or not listed.', { status: 404 })

  const [{ data: sub }, subjects] = await Promise.all([
    admin
      .from('subscriptions')
      .select('plan_code')
      .eq('user_id', tutor.id as string)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle(),
    resolveSubjectLabels(admin, tutor.id as string, 3),
  ])

  const profileUrl = absoluteUrl(`/tutor/${tutor.slug as string}`)
  const qrDataUri = await cvQrDataUri(profileUrl)

  return renderSocialBanner({
    tutor: tutor as unknown as BannerTutor,
    badges: badgesForPlan((sub?.plan_code as string) ?? null, true),
    subjects,
    format,
    template,
    qrDataUri,
    profileUrl,
    headline,
    subhead,
    dateLabel,
    successKind,
  })
}
