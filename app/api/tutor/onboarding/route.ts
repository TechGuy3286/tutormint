import { NextResponse } from 'next/server'
import { serverError } from '@/lib/errorResponse'

import { createClient } from '@/lib/supabase/server'
import { recomputeCompletion } from '@/lib/completion'
import { ensureTutorSlug } from '@/lib/tutorSlug'
import { logActivity } from '@/lib/activityLog'
import { labelsForMasterIdsServer } from '@/lib/taxonomyServer'
import { subjectLimitRefusal } from '@/lib/subjectLimit'
import { markOnboardedIfComplete } from '@/lib/onboardingDone'

// The tutor onboarding submit. Writes everything the tap-only flow collected —
// city, area, gender, experience band, fee band, subjects, and the composed
// headline/bio — then lands the tutor on the tuition list matching their
// answers. Photo and selfie are uploaded during their own steps (avatar to the
// avatars bucket, selfie via /api/documents/upload); this handles the rest.
//
// Subjects: the flow picks flat subject slugs and flat level slugs. They resolve
// to taxonomy_master ids as the CROSS of (chosen subjects) × (chosen levels) —
// the combos the tutor teaches. If no level was chosen (it is skippable), or the
// chosen levels do not intersect a subject, we fall back to the subject at every
// level so the subjects the tutor tapped are never silently lost.

export const dynamic = 'force-dynamic'

const MAX_MASTERS = 500

type Body = {
  city?: string | null
  area?: string | null
  gender?: string | null
  experienceYears?: number | null
  feeRep?: number | null
  subjectSlugs?: string[]
  levelSlugs?: string[]
  headline?: string | null
  bio?: string | null
  avatarUrl?: string | null
  /** The tutor chose "I'll do this later" / left from the last screen. */
  dismiss?: boolean
  /** The flow reached its fee step or last screen: stamp "onboarding done" if
   *  every required step is answered (owner, 15 Oct 2026). */
  complete?: boolean
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.\nپہلے سائن ان کریں، پھر دوبارہ کوشش کریں۔' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'tutor') {
    return NextResponse.json({ error: 'Only tutors have this flow.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as Body

  // Complete / dismiss (owner, 15 Oct 2026): "onboarding done" is stamped ONLY
  // when every required step is answered (lib/onboardingDone) — leaving early
  // no longer marks a tutor done. The sign-in gate does not loop without it: it
  // sends a tutor back only when city or subjects are missing (needsOnboarding).
  if (body.complete || body.dismiss) {
    const r = await markOnboardedIfComplete(user.id, body.complete ? 'flow' : 'leave')
    return NextResponse.json({ ok: true, done: r.done, next: '/tutor/dashboard' })
  }

  const subjectSlugs = (body.subjectSlugs ?? []).filter((s) => typeof s === 'string').slice(0, 50)
  const levelSlugs = (body.levelSlugs ?? []).filter((s) => typeof s === 'string').slice(0, 50)
  const gender = body.gender === 'male' || body.gender === 'female' ? body.gender : null

  if (subjectSlugs.length === 0) {
    return NextResponse.json({ error: 'Choose at least one subject.' }, { status: 400 })
  }

  // ---- resolve subjects × levels to taxonomy_master ids ----
  // If Level was SKIPPED, write NOTHING (owner, 14 Sep 2026). Subjects are
  // stored as (subject × level) master ids, so with no level there is no honest
  // row to write — the old "subject at every level" fallback made the platform
  // claim a tutor teaches pre-primary to university, and surfaced them in
  // level-filtered searches they cannot serve. They are prompted for a level
  // later rather than guessed on their behalf. When levels ARE chosen, the
  // subjects × levels cross-product stands as-is.
  let masterIds: number[] = []
  if (levelSlugs.length > 0) {
    const { data: masterRows } = await supabase
      .from('taxonomy_master')
      .select('id')
      .in('subject_slug', subjectSlugs)
      .in('level_slug', levelSlugs)
    masterIds = Array.from(new Set((masterRows ?? []).map((m) => m.id as number))).slice(0, MAX_MASTERS)
  }

  // At most 15 distinct subjects (owner, 21 Oct 2026) — checked before anything
  // is written; a tutor already over keeps their set but cannot add to it.
  if (masterIds.length > 0) {
    const { data: savedRows } = await supabase.from('tutor_subjects').select('master_id').eq('tutor_id', user.id)
    const limit = await subjectLimitRefusal(supabase, masterIds, (savedRows ?? []).map((r) => r.master_id as number))
    if (limit) return NextResponse.json({ error: limit }, { status: 400 })
  }

  // ---- city: one field for tutors (PR 3b §0) ----
  // The tutor's canonical city is tutor_profiles.city (what the directory reads);
  // profiles.city is mirrored in the same write so the completion checklist and
  // search stay in step. Both are set on the tutor_profiles / profiles updates
  // below.
  const cityWrite: string | null | undefined =
    typeof body.city === 'string' ? body.city.trim() || null : undefined
  if (cityWrite !== undefined) {
    await supabase.from('profiles').update({ city: cityWrite }).eq('id', user.id)
  }

  // ---- write tutor_profiles ----
  const tutorPatch: Record<string, unknown> = {}
  if (cityWrite !== undefined) tutorPatch.city = cityWrite
  if (typeof body.area === 'string') tutorPatch.area = body.area.trim() || null
  if (gender) tutorPatch.gender = gender
  if (typeof body.experienceYears === 'number') tutorPatch.experience_years = body.experienceYears
  if (typeof body.feeRep === 'number') tutorPatch.hourly_rate_pkr = body.feeRep
  if (typeof body.headline === 'string' && body.headline.trim()) tutorPatch.headline = body.headline.trim().slice(0, 120)
  if (typeof body.bio === 'string' && body.bio.trim()) tutorPatch.bio = body.bio.trim().slice(0, 600)
  // avatar_url only if it is one of our own storage URLs (never a foreign host).
  if (typeof body.avatarUrl === 'string' && /\/storage\/v1\/object\/public\/(avatars|tutor-media)\//.test(body.avatarUrl)) {
    tutorPatch.avatar_url = body.avatarUrl
  }
  if (Object.keys(tutorPatch).length > 0) {
    const { error } = await supabase.from('tutor_profiles').update(tutorPatch).eq('id', user.id)
    if (error) return serverError(error, 'tutor/onboarding')
  }

  // ---- write tutor_subjects (delete then insert the whole set) ----
  if (masterIds.length > 0) {
    await supabase.from('tutor_subjects').delete().eq('tutor_id', user.id)
    const { error } = await supabase
      .from('tutor_subjects')
      .insert(masterIds.map((master_id) => ({ tutor_id: user.id, master_id })))
    if (error) return serverError(error, 'tutor/onboarding')
    // First subject set at onboarding: everything is "added" (PR100 §3). The
    // subjects are already saved, so the change log never fails the request.
    try {
      const labels = await labelsForMasterIdsServer(masterIds)
      const added = [...new Set(labels.map((l) => (l.split(' — ').pop() ?? l).trim()).filter(Boolean))]
      await logActivity({
        userId: user.id,
        event: 'subjects_changed',
        targetType: 'tutor',
        targetId: user.id,
        meta: { added, removed: [], total: masterIds.length, via: 'onboarding' },
      })
    } catch (e) {
      console.error('[tutor/onboarding] subjects change-log failed (save kept):', e instanceof Error ? e.message : e)
    }
  }

  await ensureTutorSlug(user.id)
  await recomputeCompletion(user.id)
  // "Onboarding done" only when every required step is answered.
  await markOnboardedIfComplete(user.id, 'onboarding_submit')

  await logActivity({
    userId: user.id,
    event: 'profile_updated',
    targetType: 'tutor',
    targetId: user.id,
    meta: { via: 'onboarding' },
  })

  // Land on the tuition list matching the answers: their city, and (when there
  // is one) their busiest subject, so the first thing they see is real work.
  const params = new URLSearchParams()
  if (typeof body.city === 'string' && body.city.trim()) params.set('city', body.city.trim())
  if (masterIds.length > 0) params.set('subject', String(masterIds[0]))
  const qs = params.toString()
  return NextResponse.json({ ok: true, next: `/browse/tuitions${qs ? `?${qs}` : ''}` })
}
