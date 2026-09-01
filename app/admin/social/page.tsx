import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
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
    .select('slug, full_name, headline, city, area, subjects, rating_avg, rating_count')
    .order('full_name')
    .limit(200)

  const rows: PickerTutor[] = (tutors ?? []).map((t) => ({
    slug: t.slug as string,
    name: t.full_name as string,
    headline: (t.headline as string) ?? null,
    city: (t.city as string) ?? null,
    area: (t.area as string) ?? null,
    subjects: ((t.subjects as string[]) ?? []).slice(0, 6),
    rating: Number(t.rating_avg ?? 0),
    ratingCount: Number(t.rating_count ?? 0),
  }))

  return <SocialClient tutors={rows} />
}
