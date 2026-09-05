import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveSubjectLabelsBatch } from '@/lib/social/data'
import SocialClient, { type PickerTutor } from './SocialClient'

// The social post generator. owner / manager.
//
// The picker reads tutor_directory, which already excludes suspended tutors,
// unclaimed imports and incomplete profiles. That is not a convenience — it is
// the rule: we do not publish posts about people the site itself will not show,
// and getting the exclusion from the same view browse uses means it cannot
// drift from what a parent would find.
//
// v1 is generate, download, copy the caption. Posting is manual; direct
// Meta/TikTok publishing needs app review and is explicitly backlog.

export const dynamic = 'force-dynamic'

export default async function AdminSocialPage() {
  await requireAdminRole(...SCREEN_ACCESS.social)

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  const { data: tutors } = await admin
    .from('tutor_directory')
    .select('id, slug, full_name, headline, city, area, rating_avg, rating_count, experience_years, teaching_mode')
    .order('full_name')
    .limit(200)

  // Subjects are not stored on the view — resolve them (with singular level
  // labels) so the caption carries real subjects and hashtags, in one batched
  // set of queries rather than one per tutor.
  const subjectsByTutor = await resolveSubjectLabelsBatch(
    admin,
    (tutors ?? []).map((t) => t.id as string),
    3,
  )

  const rows: PickerTutor[] = (tutors ?? []).map((t) => ({
    slug: t.slug as string,
    name: t.full_name as string,
    headline: (t.headline as string) ?? null,
    city: (t.city as string) ?? null,
    area: (t.area as string) ?? null,
    subjects: subjectsByTutor.get(t.id as string) ?? [],
    rating: Number(t.rating_avg ?? 0),
    ratingCount: Number(t.rating_count ?? 0),
    experienceYears: (t.experience_years as number | null) ?? null,
    teachingMode: (t.teaching_mode as string | null) ?? null,
  }))

  return <SocialClient tutors={rows} />
}
