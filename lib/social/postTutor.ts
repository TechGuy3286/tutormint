import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { avatarShown } from '@/lib/showAvatar'
import { loadSocialTutorFacts } from '@/lib/social/eligibility'
import { socialEligible, type SocialTutorFacts } from '@/lib/social/eligibilityCore'
import { socialPortraitSrc } from '@/lib/social/avatars'
import { croppedPortrait } from '@/lib/social/crop'
import { NO_ADJUST, type CropAdjust } from '@/lib/social/cropCore'
import { resolveSubjectParts, type SubjectPart } from '@/lib/social/data'
import { badgesForPlan, type BadgeName } from '@/lib/planBadges'
import { verifiedBadgeOkOne } from '@/lib/badgeFacts'
import { absoluteUrl } from '@/lib/siteUrl'
import { formatName } from '@/lib/formatName'
import type { BannerTutor } from '@/app/api/admin/social/image/pieces'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

// Everything a social post (or a tutor's link-preview image) draws about ONE
// tutor, read from the live profile (owner, 21 Oct 2026 — PR C3). Shared by the
// admin render route (one tutor, or the 4–6 of a group post) and the profile
// share image, so the three cannot disagree.
//
// The photo: "Hide my photo from parents", a rejected or missing photo → the
// grey gender silhouette; the real photo URL is then never read, so it cannot
// reach the PNG. Otherwise it is cropped on the face (lib/social/crop.ts).
//
// Never read here: CNIC, date of birth, phone, WhatsApp, email.

export type PostTutor = {
  tutor: BannerTutor
  facts: SocialTutorFacts | null
  /** The verified-only rule of Social posts (lib/social/eligibilityCore.ts). */
  eligible: boolean
  isFixture: boolean
  subjects: string[]
  subjectParts: SubjectPart[]
  badges: BadgeName[]
  profileUrl: string
  /** The profile facts the picture is drawn from (the share image's version). */
  photoShown: boolean
}

export async function loadPostTutor(admin: Admin, slug: string, crop: CropAdjust = NO_ADJUST): Promise<PostTutor | null> {
  const { data: tp } = await admin
    .from('tutor_profiles')
    .select('id, slug, full_name, headline, city, area, rating_avg, rating_count, avatar_url, experience_years, teaching_mode')
    .eq('slug', slug)
    .maybeSingle()
  if (!tp) return null
  const id = tp.id as string

  const [{ data: p }, facts, { data: listedRow }, { data: sub }, parts] = await Promise.all([
    admin.from('profiles').select('full_name, city, is_seed, is_team_account').eq('id', id).maybeSingle(),
    loadSocialTutorFacts(admin, id),
    admin.from('tutor_directory').select('id').eq('id', id).maybeSingle(),
    admin
      .from('subscriptions')
      .select('plan_code')
      .eq('user_id', id)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle(),
    resolveSubjectParts(admin, id, 3),
  ])
  const isFixture = !!p?.is_seed || !!p?.is_team_account
  const eligible = !isFixture && !!facts && socialEligible(facts)
  const listed = !!listedRow
  const verifiedOk = await verifiedBadgeOkOne(id)
  const photoShown = !!facts && !facts.photoHidden && (await avatarShown(admin, id))

  const tutor: BannerTutor = {
    id,
    slug: tp.slug as string,
    full_name: formatName((tp.full_name as string) || (p?.full_name as string) || '') || 'Tutor',
    headline: (tp.headline as string | null) ?? null,
    city: ((p?.city as string | null) || (tp.city as string | null)) ?? null,
    area: (tp.area as string | null) ?? null,
    rating_avg: (tp.rating_avg as number | null) ?? null,
    rating_count: (tp.rating_count as number | null) ?? null,
    avatar_url: await croppedPortrait(socialPortraitSrc(tp.avatar_url as string | null, !photoShown, facts?.gender ?? null), crop),
    experience_years: (tp.experience_years as number | null) ?? null,
    teaching_mode: (tp.teaching_mode as string | null) ?? null,
    gender: facts?.gender ?? null,
  }
  return {
    tutor,
    facts,
    eligible,
    isFixture,
    subjects: parts.map((x) => x.label),
    subjectParts: parts,
    badges: badgesForPlan((sub?.plan_code as string) ?? null, listed, verifiedOk),
    profileUrl: absoluteUrl(`/tutor/${tp.slug as string}`),
    photoShown,
  }
}
