import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveSubjectLabelsBatch } from '@/lib/social/data'
import { badgesForPlan, type BadgeName } from '@/lib/planBadges'
import SocialClient, { type PickerTutor } from './SocialClient'

// The social post generator. owner / admin / operations.
//
// It lists every REAL tutor — is_seed and is_fixture are excluded ALWAYS, with
// no override (owner, 14 Sep 2026). The old version read tutor_directory, whose
// only members were fixtures carrying Verified/Premium/Featured badges they
// never earned — and these cards are published to Facebook and Instagram. A
// fixture must never be promoted as a real verified tutor.
//
// For each tutor the picker shows whether they are LISTED and, when not, which
// card fields are missing (what will render blank). Badges are the REAL earned
// set: an unlisted tutor gets none, and Verified needs a real reviewed degree.

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

  // Real tutors only. Seed/fixture excluded here, in the query, so nothing
  // downstream can re-include them.
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, city, is_seed, is_fixture')
    .eq('role', 'tutor')
    .eq('is_seed', false)
    .eq('is_fixture', false)
    .order('full_name')
    .limit(300)

  const ids = (profiles ?? []).map((p) => p.id as string)
  const none = ['00000000-0000-0000-0000-000000000000']

  const [{ data: tps }, { data: listedRows }, { data: subs }, { data: subjectLinks }, subjectsByTutor] =
    await Promise.all([
      admin
        .from('tutor_profiles')
        .select('id, slug, headline, area, avatar_url, experience_years, teaching_mode, rating_avg, rating_count, degrees')
        .in('id', ids.length ? ids : none),
      admin.from('tutor_directory').select('id').in('id', ids.length ? ids : none),
      admin
        .from('subscriptions')
        .select('user_id, plan_code')
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .in('user_id', ids.length ? ids : none),
      admin.from('tutor_subjects').select('tutor_id').in('tutor_id', ids.length ? ids : none),
      resolveSubjectLabelsBatch(admin, ids, 3),
    ])

  const tpById = new Map((tps ?? []).map((t) => [t.id as string, t]))
  const listedSet = new Set((listedRows ?? []).map((r) => r.id as string))
  const planByUser = new Map((subs ?? []).map((s) => [s.user_id as string, s.plan_code as string]))
  const subjectCount = new Map<string, number>()
  for (const l of subjectLinks ?? []) {
    const k = l.tutor_id as string
    subjectCount.set(k, (subjectCount.get(k) ?? 0) + 1)
  }

  const rows: PickerTutor[] = []
  for (const p of profiles ?? []) {
    const id = p.id as string
    const t = tpById.get(id)
    if (!t?.slug) continue // no public slug yet — cannot render a card at all
    const listed = listedSet.has(id)
    const hasDegree = Array.isArray(t.degrees) && (t.degrees as unknown[]).length > 0
    const nSubjects = subjectCount.get(id) ?? 0

    // The card fields that would render blank, named so the poster knows.
    const missing: string[] = []
    if (!t.avatar_url) missing.push('photo')
    if (!t.headline) missing.push('headline')
    if (nSubjects === 0) missing.push('subjects')
    if (!(p.city as string)?.trim()) missing.push('city')
    if (!(t.area as string)?.trim()) missing.push('area')
    if (t.experience_years == null) missing.push('experience')

    rows.push({
      slug: t.slug as string,
      name: (p.full_name as string) ?? 'Tutor',
      headline: (t.headline as string) ?? null,
      city: (p.city as string) ?? null,
      area: (t.area as string) ?? null,
      subjects: subjectsByTutor.get(id) ?? [],
      rating: Number(t.rating_avg ?? 0),
      ratingCount: Number(t.rating_count ?? 0),
      experienceYears: (t.experience_years as number | null) ?? null,
      teachingMode: (t.teaching_mode as string | null) ?? null,
      listed,
      missing,
      // Real earned badges: gate = listed, degree = real.
      badges: badgesForPlan(planByUser.get(id) ?? null, listed, hasDegree) as BadgeName[],
    })
  }

  return <SocialClient tutors={rows} />
}
