import { createAdminClient } from '@/lib/supabase/admin'
import { avatarShown } from '@/lib/showAvatar'
import { brandMonogramDataUri } from '@/lib/covers/assets'
import { loadSocialTutorFacts } from '@/lib/social/eligibility'
import { NOT_VERIFIED_MESSAGE, socialEligible } from '@/lib/social/eligibilityCore'
import { socialPortraitSrc } from '@/lib/social/avatars'
import { croppedPortrait } from '@/lib/social/crop'
import { parseCropAdjust } from '@/lib/social/cropCore'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { badgesForPlan } from '@/lib/planBadges'
import { verifiedBadgeOkOne } from '@/lib/badgeFacts'
import { absoluteUrl } from '@/lib/siteUrl'
import { cvQrDataUri } from '@/lib/cv/assets'
import { resolveSubjectLabels } from '@/lib/social/data'
import { DEFAULT_SOCIAL_TEMPLATE, isSocialFormat, isSocialTemplate } from '@/lib/social/copy'

import { renderSocialBanner, type BannerTutor } from './render'

// Who may generate a promotional PNG, and which tutor it is about.
//
// Everything except one headline line comes from the live profile, on purpose:
// the point of generating these is that what we publish about a tutor matches
// what the site says about them.
//
// It renders ONLY a verified tutor (owner, 21 Oct 2026 — see the check below);
// signed out → 401, a staff role without the screen → 403.
//
// Earlier rule, still applied first: is_seed and is_fixture are refused ALWAYS, with no
// override, because a fixture carries badges it never earned and these images go
// to Facebook and Instagram (owner, 14 Sep 2026). An unlisted real tutor still
// renders (so the team can preview), but with NO badges — an unlisted tutor has
// earned none — and Verified is shown only with a real reviewed degree. Missing
// fields render blank; the picker names them so nobody is surprised.
//
// The picture itself is ./render.tsx; the QR (same qrcode helper the CV uses)
// and the resolved subjects are built here and handed in.

export const runtime = 'nodejs'

export async function GET(request: Request) {
  // Not checkAdminRole: this returns an image, and an HTML error page in an
  // <img> is worse than a plain status.
  const actor = await getAdminActor()
  if (!actor) return new Response('Sign in.', { status: 401 })
  if (!roleSatisfies(actor.adminRole, SCREEN_ACCESS.social)) {
    return new Response('Not allowed.', { status: 403 })
  }

  const url = new URL(request.url)
  const slug = url.searchParams.get('slug') ?? ''
  const format = url.searchParams.get('format') ?? 'square'
  const template = url.searchParams.get('template') ?? DEFAULT_SOCIAL_TEMPLATE
  const headline = (url.searchParams.get('headline') ?? '').slice(0, 90)
  const subhead = (url.searchParams.get('subhead') ?? '').slice(0, 90)
  const dateLabel = (url.searchParams.get('date') ?? '').slice(0, 40)
  const successKind = url.searchParams.get('kind') === 'hired' ? 'hired' : 'verified'
  // Zoom / move for THIS post only — read from the URL, never saved anywhere.
  const crop = parseCropAdjust(url.searchParams)

  if (!isSocialFormat(format)) return new Response('Unknown format.', { status: 400 })
  if (!isSocialTemplate(template)) return new Response('Unknown template.', { status: 400 })

  const admin = createAdminClient()
  if (!admin) return new Response('Server not configured.', { status: 503 })

  // The real profile — works for a listed OR an unlisted tutor.
  const { data: tp } = await admin
    .from('tutor_profiles')
    .select('id, slug, full_name, headline, city, area, rating_avg, rating_count, avatar_url, experience_years, teaching_mode, degrees')
    .eq('slug', slug)
    .maybeSingle()

  if (!tp) return new Response('Tutor not found.', { status: 404 })

  // Fixtures are NEVER promoted — no override. (PR106-B §10: profiles has no
  // is_fixture column; the real fixture signals are is_seed and the one team
  // account. Selecting a non-existent column errored and left p null, so the
  // guard silently passed — seed/team slugs could be rendered.)
  const { data: p } = await admin
    .from('profiles')
    .select('full_name, is_seed, is_team_account')
    .eq('id', tp.id as string)
    .maybeSingle()
  if (p?.is_seed || p?.is_team_account) {
    return new Response('Fixture accounts are never promoted.', { status: 403 })
  }

  // Only verified tutors are ever posted (owner, 21 Oct 2026): fee paid, CNIC,
  // photo and selfie approved, not suspended / banned / paused, not a test
  // account. lib/social/eligibilityCore.ts is the one rule the picker reads too.
  const facts = await loadSocialTutorFacts(admin, tp.id as string)
  if (!facts || !socialEligible(facts)) return new Response(NOT_VERIFIED_MESSAGE, { status: 403 })

  // Listed decides whether ANY badge shows (an unlisted tutor has earned none);
  // Verified additionally needs a real reviewed degree. Both are real facts, not
  // a hardcoded true.
  const [{ data: listedRow }, { data: sub }, subjects] = await Promise.all([
    admin.from('tutor_directory').select('id').eq('slug', slug).maybeSingle(),
    admin
      .from('subscriptions')
      .select('plan_code')
      .eq('user_id', tp.id as string)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle(),
    resolveSubjectLabels(admin, tp.id as string, 3),
  ])

  const listed = !!listedRow
  // PR105-B §1 — the Verified badge needs staff-approved CNIC+photo+selfie.
  const verifiedOk = await verifiedBadgeOkOne(tp.id as string)

  // The banner is public marketing, so it honours the tutor's "show my picture
  // to parents" toggle (PR70) — hidden → initials, like the public profile.
  // "Hide my photo from parents" (show_avatar=false) or a rejected photo → null,
  // so the render draws the grey silhouette for the profile gender; the real
  // photo URL never reaches the picture.
  const showPhoto = !facts.photoHidden && (await avatarShown(admin, tp.id as string))

  const tutor = {
    id: tp.id,
    slug: tp.slug,
    full_name: (tp.full_name as string) || (p?.full_name as string) || 'Tutor',
    headline: tp.headline,
    city: tp.city,
    area: tp.area,
    rating_avg: tp.rating_avg,
    rating_count: tp.rating_count,
    // Cropped on the face and shoulders (plus the admin's zoom / move); a hidden
    // photo is the silhouette, which passes through untouched.
    avatar_url: await croppedPortrait(socialPortraitSrc(tp.avatar_url as string | null, !showPhoto, facts.gender), crop),
    experience_years: tp.experience_years,
    teaching_mode: tp.teaching_mode,
    gender: facts.gender,
  }

  const profileUrl = absoluteUrl(`/tutor/${tp.slug as string}`)
  const [qrDataUri, logoDataUri] = await Promise.all([cvQrDataUri(profileUrl), brandMonogramDataUri()])

  return renderSocialBanner({
    tutor: tutor as unknown as BannerTutor,
    // Real badges only: gate = listed, Verified = staff-approved docs. An
    // unlisted tutor gets [].
    badges: badgesForPlan((sub?.plan_code as string) ?? null, listed, verifiedOk),
    subjects,
    format,
    template,
    qrDataUri,
    profileUrl,
    headline,
    subhead,
    dateLabel,
    successKind,
    logoDataUri,
    // Every tutor here passed the verified-only rule above.
    verified: true,
  })
}
