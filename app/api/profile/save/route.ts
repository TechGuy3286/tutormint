import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { flagIfAbusive } from '@/lib/abuse/flag'
import { detectAbuse } from '@/lib/abuse/filter'
import { WITHHELD_CONTENT_LINE } from '@/lib/abuse/warnings'
import { recomputeCompletion } from '@/lib/completion'
import { logActivity } from '@/lib/activityLog'
import { BAD_AVATAR_MESSAGE, isOurStorageUrl } from '@/lib/avatarUrl'
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
  /** PR68: a tutor's areas (all in their city), replacing the tutor_areas set. */
  areas?: string[]
}

// Only these columns may be written from the client, per table.
//
// `city` is NOT in this set on purpose: for a TUTOR the single city field is
// tutor_profiles.city (the field the listing rule reads), mirrored into
// profiles.city in the same save; for a PARENT it stays profiles.city. Both are
// handled below by role, so a blanket profiles.city write here would send the
// tutor's city to the wrong column — the exact split PR 3b closes.
const PROFILE_FIELDS = new Set(['full_name', 'province', 'address', 'cnic_number', 'whatsapp'])
const TUTOR_FIELDS = new Set([
  'gender', 'area', 'avatar_url', 'headline', 'bio',
  'experience_years', 'hourly_rate_pkr', 'fee_min_pkr', 'fee_max_pkr', 'teaching_mode', 'job_types', 'online_platforms', 'degrees',
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
  /** PR68: a tutor's areas (all in their city). Replaces the tutor_areas set. */
  areas: z.array(z.string().max(120)).max(40).optional(),
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

  // PR41 §2 — check the PUBLIC text fields BEFORE writing, and do NOT publish
  // anything abusive: a banned display name, headline or bio is withheld (not
  // saved), a flag is raised for staff (counting toward the third-strike
  // suspension), and the member sees one plain line. The rest of the save is
  // rejected with it — nothing here is published if any field breaks the rules.
  const nameIn = typeof body.profile?.full_name === 'string' ? body.profile.full_name : null
  const headlineIn = typeof body.tutorProfile?.headline === 'string' ? body.tutorProfile.headline : null
  const bioIn = typeof body.tutorProfile?.bio === 'string' ? body.tutorProfile.bio : null
  const nameAbusive = !!nameIn && detectAbuse(nameIn).length > 0
  const headlineAbusive = !!headlineIn && detectAbuse(headlineIn).length > 0
  const bioAbusive = !!bioIn && detectAbuse(bioIn).length > 0
  if (nameAbusive || headlineAbusive || bioAbusive) {
    try {
      if (nameAbusive) {
        await flagIfAbusive({
          source: 'display_name', subjectId: user.id, content: nameIn!,
          context: { field: 'full_name' }, withheld: true,
        })
      }
      const profileText = [headlineAbusive ? headlineIn : null, bioAbusive ? bioIn : null]
        .filter(Boolean)
        .join('\n\n')
      if (profileText) {
        await flagIfAbusive({
          source: 'profile', subjectId: user.id, content: profileText,
          context: { field: 'headline/bio' }, withheld: true,
        })
      }
    } catch {
      /* a flag failure must not change the outcome — the content stays unpublished */
    }
    return NextResponse.json({ error: WITHHELD_CONTENT_LINE }, { status: 400 })
  }

  // ONE CITY FIELD FOR TUTORS (PR 3b §0). `city` arrives under `profile.city`
  // from every form. A blank string clears it (null); an absent key leaves it
  // untouched. For a tutor it is written to tutor_profiles.city (what the
  // directory keys on) and mirrored into profiles.city; for a parent it stays
  // on profiles.city.
  const cityProvided =
    !!body.profile && Object.prototype.hasOwnProperty.call(body.profile, 'city')
  const cityWrite: string | null | undefined = cityProvided
    ? (typeof body.profile?.city === 'string' ? body.profile.city.trim() : '') || null
    : undefined

  const profilePatch = pick(body.profile, PROFILE_FIELDS)
  if (role !== 'tutor' && cityWrite !== undefined) profilePatch.city = cityWrite
  if (Object.keys(profilePatch).length > 0) {
    const { error } = await supabase.from('profiles').update(profilePatch).eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  if (role === 'tutor') {
    const tutorPatch = pick(body.tutorProfile, TUTOR_FIELDS)
    // The tutor's canonical city lives on tutor_profiles.
    if (cityWrite !== undefined) tutorPatch.city = cityWrite

    // Multiple areas (PR68). The caller sends `areas: string[]`; we set the single
    // tutor_profiles.area to the first (so it works pre-migration and satisfies the
    // listing rule) AND replace the tutor_areas list. The list write is fail-open:
    // if the table is not there yet, the single area is the fallback.
    let areasList: string[] | null = null
    if (Array.isArray(body.areas)) {
      areasList = Array.from(
        new Set(
          body.areas
            .filter((a): a is string => typeof a === 'string' && a.trim() !== '')
            .map((a) => a.trim()),
        ),
      )
      tutorPatch.area = areasList[0] ?? null
    }

    // Fee range (PR67): whole rupees, non-negative, min ≤ max. A friendly error,
    // never a raw DB message. The trigger keeps hourly_rate_pkr = fee_min_pkr.
    const feeMin = tutorPatch.fee_min_pkr
    const feeMax = tutorPatch.fee_max_pkr
    const badFee = (n: unknown) => n != null && (!Number.isInteger(n) || (n as number) < 0)
    if (badFee(feeMin) || badFee(feeMax)) {
      return NextResponse.json({ error: 'Enter your fee in whole rupees.' }, { status: 400 })
    }
    if (typeof feeMin === 'number' && typeof feeMax === 'number' && feeMin > feeMax) {
      return NextResponse.json({ error: 'The minimum fee can’t be higher than the maximum.' }, { status: 400 })
    }

    // The picture must be a file in one of our buckets. This route had no
    // check on avatar_url at all, which is how a 4MB base64 string ended up in
    // a column that is read on every request and inlined into every page that
    // renders the tutor. See lib/avatarUrl.ts; /api/parent/profile has always
    // done the equivalent.
    const avatar = tutorPatch.avatar_url
    if (typeof avatar === 'string' && avatar !== '' && !isOurStorageUrl(avatar)) {
      return NextResponse.json({ error: BAD_AVATAR_MESSAGE }, { status: 400 })
    }

    if (Object.keys(tutorPatch).length > 0) {
      const { error } = await supabase.from('tutor_profiles').update(tutorPatch).eq('id', user.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Mirror the tutor's city into profiles.city in the SAME save (PR 3b §0.2),
    // so the completion checklist and search (which read profiles.city) stay in
    // step with the listing rule (which reads tutor_profiles.city).
    if (cityWrite !== undefined) {
      const { error } = await supabase.from('profiles').update({ city: cityWrite }).eq('id', user.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // ONE NAME (PR66 §5). profiles.full_name is canonical (what the dashboard
    // shows); mirror it into tutor_profiles.full_name in the SAME save so admin,
    // the public profile and the CV read the same name. Applies to every caller
    // that sets a tutor's name here (onboarding, Settings).
    if (Object.prototype.hasOwnProperty.call(profilePatch, 'full_name')) {
      const { error } = await supabase
        .from('tutor_profiles')
        .update({ full_name: profilePatch.full_name })
        .eq('id', user.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Replace the tutor_areas set (PR68). The city for each area is the one being
    // saved, or the tutor's current city. Fail-open: a missing table (pre-migration,
    // 42P01) is ignored — tutor_profiles.area (set above) is the fallback.
    if (areasList) {
      let areaCity: string | null | undefined = cityWrite
      if (areaCity === undefined) {
        const { data: cur } = await supabase.from('tutor_profiles').select('city').eq('id', user.id).maybeSingle()
        areaCity = (cur?.city as string | null) ?? null
      }
      const del = await supabase.from('tutor_areas').delete().eq('tutor_id', user.id)
      if (del.error && del.error.code !== '42P01') {
        return NextResponse.json({ error: del.error.message }, { status: 400 })
      }
      if (!del.error && areasList.length > 0) {
        const { error } = await supabase
          .from('tutor_areas')
          .insert(areasList.map((area) => ({ tutor_id: user.id, city: areaCity, area })))
        if (error && error.code !== '42P01') {
          return NextResponse.json({ error: error.message }, { status: 400 })
        }
      }
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
  if (cityProvided) changed.push('city')
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

  // Abusive display name / profile text was already withheld and flagged before
  // any write above (PR41 §2), so a saved profile here contains no flagged text.

  return NextResponse.json({
    success: true,
    completion: completion?.percent ?? null,
    missing: completion?.missing.map((m) => ({ key: m.key, label: m.label, step: m.step })) ?? [],
  })
}
