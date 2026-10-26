import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveSubjectLabelsBatch } from '@/lib/social/data'
import { badgesForPlan, type BadgeName } from '@/lib/planBadges'
import { loadVerifiedBadgeOk } from '@/lib/badgeFacts'
import SocialClient, { type PickerTutor } from './SocialClient'
import { isSocialTemplate } from '@/lib/social/copy'
import { formatName } from '@/lib/formatName'
import { loadSocialEligibleTutors } from '@/lib/social/eligibility'
import { chunk } from '@/lib/pageAll'
import { loadImageProfileFacts } from '@/lib/social/imageVersion'

// The social post generator. owner / admin / operations.
//
// ONLY VERIFIED TUTORS (owner, 21 Oct 2026): the picker lists exactly the tutors
// lib/social/eligibilityCore.ts allows — Verification Fee paid, CNIC, photo and
// selfie approved, not suspended / banned / paused, not a fixture or test
// account. Read fresh on every request (force-dynamic, no cache), so a tutor
// verified a moment ago appears at once. The render route refuses everyone else.
//
// It lists every REAL tutor — seed AND team accounts are excluded ALWAYS, with
// no override (owner, 14 Sep 2026; PR26 §3). Each tutor's LISTED flag is the
// current visibility rule (directoryBlockers, via tutor_directory), and Verified
// needs a real reviewed degree — so a fixture is never promoted as a real
// verified tutor.
//
// PR26 §3 FIX: this query filtered profiles on `.eq('is_fixture', false)`, but
// `profiles` has NO is_fixture column (it is a tuition-only concept — migration
// 87). PostgREST erred on the unknown column, the query returned nothing, and
// the page showed "No real tutors to post about yet" even though real tutors are
// listed in Browse. Fixed by excluding seed AND the team account through the
// columns that exist (is_seed, is_team_account).
//
// For each tutor the picker shows whether they are LISTED and, when not, which
// card fields are missing (what will render blank). Badges are the REAL earned
// set: an unlisted tutor gets none, and Verified needs a real reviewed degree.

export const dynamic = 'force-dynamic'

export default async function AdminSocialPage({ searchParams }: { searchParams: Promise<{ tutor?: string; template?: string; success?: string }> }) {
  await requireAdminRole(...SCREEN_ACCESS.social)

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server.
      </p>
    )
  }

  // Real tutors only. Seed and team accounts excluded here, in the query, so
  // nothing downstream can re-include them. (`is_fixture` does not exist on
  // profiles — see the header note; the tutor-side fixture signals are is_seed
  // and the one is_team_account.)
  const eligible = await loadSocialEligibleTutors(admin)
  const eligibleIds = [...eligible.keys()]
  const profiles: { id: string; full_name: string | null; city: string | null; cnic_verified_at: string | null }[] = []
  for (const part of chunk(eligibleIds, 100)) {
    const { data } = await admin.from('profiles').select('id, full_name, city, cnic_verified_at').in('id', part)
    for (const r of data ?? []) profiles.push(r as (typeof profiles)[number])
  }
  profiles.sort((a, b) => (formatName(a.full_name) || '').localeCompare(formatName(b.full_name) || ''))

  const ids = profiles.map((p) => p.id)
  const none = ['00000000-0000-0000-0000-000000000000']

  const [{ data: tps }, { data: listedRows }, { data: subs }, { data: subjectLinks }, subjectsByTutor] =
    await Promise.all([
      admin
        .from('tutor_profiles')
        .select('id, slug, headline, area, avatar_url, experience_years, teaching_mode, rating_avg, rating_count, degrees, verified_fee_paid_at')
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
  // PR105-B §1 — the Verified badge needs staff-approved CNIC+photo+selfie.
  const verifiedOkSet = await loadVerifiedBadgeOk(ids)
  // The image version key's profile half, from the same reader the image route checks.
  const imageFacts = await loadImageProfileFacts(admin, ids)
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
    const verifiedOk = verifiedOkSet.has(id)
    const nSubjects = subjectCount.get(id) ?? 0

    // The card fields that would render blank, named so the poster knows.
    const missing: string[] = []
    if (!t.avatar_url && !eligible.get(id)?.photoHidden) missing.push('photo')
    if (!t.headline) missing.push('headline')
    if (nSubjects === 0) missing.push('subjects')
    if (!(p.city as string)?.trim()) missing.push('city')
    if (!(t.area as string)?.trim()) missing.push('area')
    if (t.experience_years == null) missing.push('experience')

    rows.push({
      slug: t.slug as string,
      name: formatName(p.full_name as string | null) || 'Tutor',
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
      photoHidden: eligible.get(id)?.photoHidden ?? false,
      // Real earned badges: gate = listed, Verified = staff-approved docs.
      badges: badgesForPlan(planByUser.get(id) ?? null, listed, verifiedOk) as BadgeName[],
      // When they became verified — the later of the fee and the CNIC approval
      // (the group post defaults to the most recently verified, PR C3).
      verifiedAt: [t.verified_fee_paid_at as string | null, p.cnic_verified_at].filter(Boolean).sort().pop() ?? null,
      imageFacts: imageFacts.get(id) ?? null,
    })
  }

  // ?tutor=<slug>&template=success&success=hired preselects a post (owner, 22 Oct
  // 2026). An unknown slug (not verified) or template is simply ignored.
  const sp = await searchParams
  const initial = {
    slug: sp.tutor ?? null,
    template: sp.template && isSocialTemplate(sp.template) ? sp.template : null,
    success: sp.success === 'hired' || sp.success === 'verified' ? sp.success : null,
  } as const

  return <SocialClient tutors={rows} initial={initial} />
}
