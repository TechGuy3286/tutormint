import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { flagIfAbusive } from '@/lib/abuse/flag'
import { detectAbuse } from '@/lib/abuse/filter'
import { WITHHELD_CONTENT_LINE } from '@/lib/abuse/warnings'
import { recomputeCompletion } from '@/lib/completion'
import { logActivity } from '@/lib/activityLog'
import { BAD_AVATAR_MESSAGE, isOurStorageUrl } from '@/lib/avatarUrl'
import { parseBody, z } from '@/lib/validate'
import { serverError } from '@/lib/errorResponse'
import { ensureTutorSlug } from '@/lib/tutorSlug'
import { recordFieldChanges, type FieldChange } from '@/lib/fieldHistory'

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
  /** PR85: up to 2 cities, each with its areas — supersedes `areas`. */
  areasByCity?: Record<string, string[]>
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
  /** PR68: a tutor's areas (all in their MAIN city). Replaces the tutor_areas set. */
  areas: z.array(z.string().max(120)).max(40).optional(),
  /** PR85 (Part A): up to 2 cities, each with its own areas. When present it
   *  supersedes `areas`, and the FIRST key must be the main city (profile.city). */
  areasByCity: z.record(z.string().max(120), z.array(z.string().max(120)).max(40)).optional(),
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

  const { data: me } = await supabase.from('profiles').select('role, email').eq('id', user.id).maybeSingle()
  const role = me?.role
  const myEmail = (me?.email as string | null) ?? null

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
    if (error) return serverError(error, 'profile.save:profiles.update')
  }

  if (role === 'tutor') {
    const tutorPatch = pick(body.tutorProfile, TUTOR_FIELDS)
    // The tutor's canonical city lives on tutor_profiles.
    if (cityWrite !== undefined) tutorPatch.city = cityWrite

    // PR83 (Part C): capture OLD values for the change history, before the writes
    // below. Best-effort — a failed read just leaves an old value null and never
    // affects the save.
    const avatarProvided = typeof body.tutorProfile?.avatar_url === 'string'
    const histOld: { city?: string | null; avatar?: string | null; subjects?: string; areas?: string } = {}
    try {
      if (cityWrite !== undefined || avatarProvided) {
        const { data } = await supabase.from('tutor_profiles').select('city, avatar_url').eq('id', user.id).maybeSingle()
        histOld.city = (data?.city as string | null) ?? null
        histOld.avatar = (data?.avatar_url as string | null) ?? null
      }
      if (Array.isArray(body.subjectMasterIds)) {
        const { data } = await supabase.from('tutor_subjects').select('master_id').eq('tutor_id', user.id)
        histOld.subjects = (data ?? []).map((r) => r.master_id as number).sort((a, b) => a - b).join(',')
      }
      if (Array.isArray(body.areas) || body.areasByCity) {
        const { data } = await supabase.from('tutor_areas').select('city, area').eq('tutor_id', user.id)
        histOld.areas = (data ?? [])
          .map((r) => (body.areasByCity ? `${(r.city as string) ?? ''}: ${r.area as string}` : (r.area as string)))
          .sort()
          .join(', ')
      }
    } catch {
      /* best-effort */
    }

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

    // PR85 (Part A): up to 2 cities, each with its areas — supersedes `areas`.
    let cityAreaRows: { city: string; area: string }[] | null = null
    if (body.areasByCity && typeof body.areasByCity === 'object') {
      cityAreaRows = []
      const seen = new Set<string>()
      const entries = Object.entries(body.areasByCity).slice(0, 2) // at most 2 cities
      for (const [rawCity, rawAreas] of entries) {
        const c = (rawCity ?? '').trim()
        if (!c || !Array.isArray(rawAreas)) continue
        for (const a of rawAreas) {
          const area = (typeof a === 'string' ? a : '').trim()
          if (!area) continue
          const key = `${c.toLowerCase()}|${area.toLowerCase()}`
          if (seen.has(key)) continue
          seen.add(key)
          cityAreaRows.push({ city: c, area })
        }
      }
      // tutor_profiles.area follows the MAIN city's first area (main = profile.city).
      const mainCity = ((typeof cityWrite === 'string' ? cityWrite : '') || entries[0]?.[0] || '').trim().toLowerCase()
      const mainFirst = cityAreaRows.find((r) => r.city.toLowerCase() === mainCity)?.area
      tutorPatch.area = (mainFirst ?? cityAreaRows[0]?.area) ?? null
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
      if (error) return serverError(error, 'profile.save:tutor_profiles.update')
    }

    // Mirror the tutor's city into profiles.city in the SAME save (PR 3b §0.2),
    // so the completion checklist and search (which read profiles.city) stay in
    // step with the listing rule (which reads tutor_profiles.city).
    if (cityWrite !== undefined) {
      const { error } = await supabase.from('profiles').update({ city: cityWrite }).eq('id', user.id)
      if (error) return serverError(error, 'profile.save:profiles.city')
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
      if (error) return serverError(error, 'profile.save:tutor_profiles.full_name')
    }

    // Replace the tutor_areas set (PR68). The city for each area is the one being
    // saved, or the tutor's current city. Fail-open: a missing table (pre-migration,
    // 42P01) is ignored — tutor_profiles.area (set above) is the fallback.
    if (cityAreaRows) {
      // PR85: the full per-city set replaces tutor_areas verbatim.
      const del = await supabase.from('tutor_areas').delete().eq('tutor_id', user.id)
      if (del.error && del.error.code !== '42P01') {
        return serverError(del.error, 'profile.save:tutor_areas.delete')
      }
      if (!del.error && cityAreaRows.length > 0) {
        const { error } = await supabase
          .from('tutor_areas')
          .insert(cityAreaRows.map((r) => ({ tutor_id: user.id, city: r.city, area: r.area })))
        if (error && error.code !== '42P01') {
          return serverError(error, 'profile.save:tutor_areas.insert')
        }
      }
    } else if (areasList) {
      let areaCity: string | null | undefined = cityWrite
      if (areaCity === undefined) {
        const { data: cur } = await supabase.from('tutor_profiles').select('city').eq('id', user.id).maybeSingle()
        areaCity = (cur?.city as string | null) ?? null
      }
      const del = await supabase.from('tutor_areas').delete().eq('tutor_id', user.id)
      if (del.error && del.error.code !== '42P01') {
        return serverError(del.error, 'profile.save:tutor_areas.delete')
      }
      if (!del.error && areasList.length > 0) {
        const { error } = await supabase
          .from('tutor_areas')
          .insert(areasList.map((area) => ({ tutor_id: user.id, city: areaCity, area })))
        if (error && error.code !== '42P01') {
          return serverError(error, 'profile.save:tutor_areas.insert')
        }
      }
    }

    if (Array.isArray(body.subjectMasterIds)) {
      const ids = body.subjectMasterIds.filter((n) => Number.isInteger(n))
      // Replace the set: delete then insert, so deselecting actually removes.
      const del = await supabase.from('tutor_subjects').delete().eq('tutor_id', user.id)
      if (del.error) return serverError(del.error, 'profile.save:tutor_subjects.delete')

      if (ids.length > 0) {
        const { error } = await supabase
          .from('tutor_subjects')
          .insert(ids.map((master_id) => ({ tutor_id: user.id, master_id })))
        if (error) return serverError(error, 'profile.save:tutor_subjects.insert')
      }
    }

    // PR83 (Part C): record the tutor's own step-1 changes (best-effort; no
    // reason for a self-change). recordFieldChanges drops no-ops, so a save that
    // did not touch a field records nothing for it.
    const hist: FieldChange[] = []
    const base = { tutorId: user.id, changedBy: user.id, changedByRole: 'tutor' as const, changedByEmail: myEmail, reason: null }
    if (cityWrite !== undefined) hist.push({ ...base, field: 'city', oldValue: histOld.city ?? null, newValue: cityWrite })
    if (avatarProvided) hist.push({ ...base, field: 'profile_picture', oldValue: histOld.avatar ?? null, newValue: (tutorPatch.avatar_url as string) ?? null })
    if (Array.isArray(body.subjectMasterIds)) {
      const newIds = body.subjectMasterIds.filter((n) => Number.isInteger(n)).slice().sort((a, b) => a - b).join(',')
      hist.push({ ...base, field: 'subjects', oldValue: histOld.subjects ?? '', newValue: newIds })
    }
    if (cityAreaRows) {
      hist.push({ ...base, field: 'areas', oldValue: histOld.areas ?? '', newValue: cityAreaRows.map((r) => `${r.city}: ${r.area}`).sort().join(', ') })
    } else if (areasList) {
      hist.push({ ...base, field: 'areas', oldValue: histOld.areas ?? '', newValue: areasList.slice().sort().join(', ') })
    }
    await recordFieldChanges(hist)
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
