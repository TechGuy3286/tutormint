import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { recomputeCompletion } from '@/lib/completion'
import { ensureTutorSlug } from '@/lib/tutorSlug'
import { logActivity } from '@/lib/activityLog'

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
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'tutor') {
    return NextResponse.json({ error: 'Only tutors have this flow.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as Body
  const subjectSlugs = (body.subjectSlugs ?? []).filter((s) => typeof s === 'string').slice(0, 50)
  const levelSlugs = (body.levelSlugs ?? []).filter((s) => typeof s === 'string').slice(0, 50)
  const gender = body.gender === 'male' || body.gender === 'female' ? body.gender : null

  if (subjectSlugs.length === 0) {
    return NextResponse.json({ error: 'Choose at least one subject.' }, { status: 400 })
  }

  // ---- resolve subjects × levels to taxonomy_master ids ----
  const { data: masterRows } = await supabase
    .from('taxonomy_master')
    .select('id, level_slug')
    .in('subject_slug', subjectSlugs)
  const all = masterRows ?? []
  let chosen = all
  if (levelSlugs.length > 0) {
    const inLevel = all.filter((m) => levelSlugs.includes(m.level_slug as string))
    // Fall back to subject-at-any-level if the chosen levels do not intersect
    // (a subject the tutor tapped that is not offered at their chosen levels).
    if (inLevel.length > 0) chosen = inLevel
  }
  const masterIds = Array.from(new Set(chosen.map((m) => m.id as number))).slice(0, MAX_MASTERS)

  // ---- write profiles.city ----
  if (typeof body.city === 'string') {
    await supabase.from('profiles').update({ city: body.city.trim() || null }).eq('id', user.id)
  }

  // ---- write tutor_profiles ----
  const tutorPatch: Record<string, unknown> = {}
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
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // ---- write tutor_subjects (delete then insert the whole set) ----
  if (masterIds.length > 0) {
    await supabase.from('tutor_subjects').delete().eq('tutor_id', user.id)
    const { error } = await supabase
      .from('tutor_subjects')
      .insert(masterIds.map((master_id) => ({ tutor_id: user.id, master_id })))
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await logActivity({
      userId: user.id,
      event: 'subjects_changed',
      targetType: 'tutor',
      targetId: user.id,
      meta: { count: masterIds.length, via: 'onboarding' },
    })
  }

  await ensureTutorSlug(user.id)
  await recomputeCompletion(user.id)

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
