import { createAdminClient } from '@/lib/supabase/admin'
import { brandMonogramDataUri } from '@/lib/covers/assets'
import { NOT_VERIFIED_MESSAGE } from '@/lib/social/eligibilityCore'
import { parseCropAdjust } from '@/lib/social/cropCore'
import { getAdminActor, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { cvQrDataUri } from '@/lib/cv/assets'
import { DEFAULT_SOCIAL_TEMPLATE, isSocialFormat, isSocialTemplate, NO_HEADLINE_MESSAGE, ownWords, cityTutorsUrl } from '@/lib/social/copy'
import { clampVariant, GROUP_MAX, GROUP_MIN } from '@/lib/social/templates'
import { loadPostTutor } from '@/lib/social/postTutor'

import { renderSocialBanner } from './render'

// Who may generate a promotional PNG, and which tutor (or tutors) it is about.
//
// Everything except one headline line comes from the live profile, on purpose:
// the point of generating these is that what we publish about a tutor matches
// what the site says about them.
//
// It renders ONLY verified tutors (owner, 21 Oct 2026 — lib/social/eligibility-
// Core.ts, the rule the picker reads too); signed out → 401, a staff role
// without the screen → 403. Seed and team accounts are never promoted.
//
// PR C3 (owner, 21 Oct 2026): twelve templates, two colour looks for the new
// ones (?v=), "Tutor's own words" refused for a tutor with no profile headline,
// and the group post — ?slugs=a,b,c,d (4–6) from one ?city=, every tutor
// verified. The tutor data is lib/social/postTutor.ts, shared with the profile
// link-preview image. Never read or drawn: CNIC, date of birth, phone, email.

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
  const variant = clampVariant(template, url.searchParams.get('v'))

  const admin = createAdminClient()
  if (!admin) return new Response('Server not configured.', { status: 503 })

  const logoDataUri = await brandMonogramDataUri()

  // ---- the group post: 4–6 verified tutors from one city ----------------------
  if (template === 'group') {
    const city = (url.searchParams.get('city') ?? '').trim()
    const slugs = [...new Set((url.searchParams.get('slugs') ?? '').split(',').map((x) => x.trim()).filter(Boolean))]
    if (!city) return new Response('Pick a city.', { status: 400 })
    if (slugs.length < GROUP_MIN || slugs.length > GROUP_MAX) {
      return new Response(`Pick ${GROUP_MIN} to ${GROUP_MAX} tutors.`, { status: 400 })
    }
    const tutors = await Promise.all(slugs.map((s) => loadPostTutor(admin, s)))
    if (tutors.some((t) => !t)) return new Response('Tutor not found.', { status: 404 })
    if (tutors.some((t) => !t!.eligible)) return new Response(NOT_VERIFIED_MESSAGE, { status: 403 })
    if (tutors.some((t) => (t!.tutor.city ?? '').trim().toLowerCase() !== city.toLowerCase())) {
      return new Response(`Every tutor must be in ${city}.`, { status: 400 })
    }
    const first = tutors[0]!
    const qrDataUri = await cvQrDataUri(cityTutorsUrl(city))
    return renderSocialBanner({
      tutor: { ...first.tutor, city },
      badges: ['Verified'],
      subjects: [],
      format,
      template,
      variant,
      qrDataUri,
      profileUrl: cityTutorsUrl(city),
      logoDataUri,
      verified: true,
      group: {
        city,
        tutors: tutors.map((t) => ({ slug: t!.tutor.slug, name: t!.tutor.full_name, subject: t!.subjects[0] ?? null, avatar_url: t!.tutor.avatar_url ?? '', gender: t!.tutor.gender })),
      },
    })
  }

  // ---- one tutor ----------------------------------------------------------------
  const post = await loadPostTutor(admin, slug, crop)
  if (!post) return new Response('Tutor not found.', { status: 404 })
  // Fixtures are NEVER promoted — no override (is_seed and the team account).
  if (post.isFixture) return new Response('Fixture accounts are never promoted.', { status: 403 })
  // Only verified tutors are ever posted (owner, 21 Oct 2026).
  if (!post.eligible) return new Response(NOT_VERIFIED_MESSAGE, { status: 403 })
  // "Tutor's own words" quotes the tutor's own headline — none, no post.
  if (template === 'quote' && !ownWords({ tutorHeadline: post.tutor.headline })) {
    return new Response(NO_HEADLINE_MESSAGE, { status: 409 })
  }

  const qrDataUri = await cvQrDataUri(post.profileUrl)
  return renderSocialBanner({
    tutor: post.tutor,
    badges: post.badges,
    subjects: post.subjects,
    subjectParts: post.subjectParts,
    format,
    template,
    variant,
    qrDataUri,
    profileUrl: post.profileUrl,
    headline,
    subhead,
    dateLabel,
    successKind,
    logoDataUri,
    // Every tutor here passed the verified-only rule above.
    verified: true,
  })
}
