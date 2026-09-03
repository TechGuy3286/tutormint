import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recomputeCompletion } from '@/lib/completion'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z } from '@/lib/validate'
import { ensureTutorSlug } from '@/lib/tutorSlug'

// Per-step save for the profile forms. Writes only the fields the step owns,
// then recomputes profiles.profile_completion so the stored percentage can
// never drift from the checklist.
//
// Scoped to the signed-in user throughout: nothing here takes a user id from
// the request body.

type Body = {
  step?: string
  profile?: Record<string, unknown>
  tutorProfile?: Record<string, unknown>
  /** taxonomy_master ids, replacing the tutor's current subject set. */
  subjectMasterIds?: number[]
}

// Only these columns may be written from the client, per table.
const PROFILE_FIELDS = new Set(['full_name', 'city', 'province', 'address', 'cnic_number', 'whatsapp'])
const TUTOR_FIELDS = new Set([
  'gender', 'area', 'avatar_url', 'headline', 'bio',
  'experience_years', 'hourly_rate_pkr', 'teaching_mode', 'online_platforms', 'degrees',
])

function pick(src: Record<string, unknown> | undefined, allowed: Set<string>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(src ?? {})) if (allowed.has(k)) out[k] = v
  return out
}

const ProfileBody = z.object({
  profile: z.record(z.string(), z.unknown()).optional(),
  tutorProfile: z.record(z.string(), z.unknown()).optional(),
  subjectMasterIds: z.array(z.number().int().positive()).max(60).optional(),
  step: z.string().max(64).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  // The allowlists below decide which COLUMNS may be written; this decides the
  // shape. Both are needed: a schema alone would let a renamed field through,
  // and an allowlist alone would let `city` arrive as an object.
  const parsed = await parseBody(request, ProfileBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data as Body

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const role = me?.role

  const profilePatch = pick(body.profile, PROFILE_FIELDS)
  if (Object.keys(profilePatch).length > 0) {
    const { error } = await supabase.from('profiles').update(profilePatch).eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  if (role === 'tutor') {
    const tutorPatch = pick(body.tutorProfile, TUTOR_FIELDS)

    if (Object.keys(tutorPatch).length > 0) {
      const { error } = await supabase.from('tutor_profiles').update(tutorPatch).eq('id', user.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (Array.isArray(body.subjectMasterIds)) {
      const ids = body.subjectMasterIds.filter((n) => Number.isInteger(n))
      // Replace the set: delete then insert, so deselecting actually removes.
      const del = await supabase.from('tutor_subjects').delete().eq('tutor_id', user.id)
      if (del.error) return NextResponse.json({ error: del.error.message }, { status: 400 })

      if (ids.length > 0) {
        const { error } = await supabase
          .from('tutor_subjects')
          .insert(ids.map((master_id) => ({ tutor_id: user.id, master_id })))
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }
  }

  // A tutor's public address, assigned or improved here.
  //
  // handle_new_user() creates the tutor_profiles row and never sets a slug, so
  // before this every tutor who registered normally had a public profile with
  // no URL at all -- seven of the seventeen that existed. ensureTutorSlug is a
  // no-op once the tutor is listed: at that point somebody may hold the link,
  // and an address stops following the data.
  if (role === 'tutor') await ensureTutorSlug(user.id)

  const completion = await recomputeCompletion(user.id)

  const changed = [...Object.keys(profilePatch)]
  if (Array.isArray(body.subjectMasterIds)) {
    await logActivity({
      userId: user.id, event: 'subjects_changed', targetType: 'tutor_profile', targetId: user.id,
      meta: { count: body.subjectMasterIds.length },
    })
  }
  if (changed.length > 0 || body.tutorProfile) {
    await logActivity({
      userId: user.id, event: 'profile_updated', targetType: 'profile', targetId: user.id,
      meta: { step: body.step ?? null, fields: changed },
    })
  }

  return NextResponse.json({
    success: true,
    completion: completion?.percent ?? null,
    missing: completion?.missing.map((m) => ({ key: m.key, label: m.label, step: m.step })) ?? [],
  })
}
