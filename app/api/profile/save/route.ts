import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { flagIfAbusive } from '@/lib/abuse/flag'
import { detectAbuse } from '@/lib/abuse/filter'
import { WITHHELD_CONTENT_LINE } from '@/lib/abuse/warnings'
import { recomputeCompletion } from '@/lib/completion'
import { logActivity } from '@/lib/activityLog'
import { BAD_AVATAR_MESSAGE, isOurStorageUrl } from '@/lib/avatarUrl'
import { parseBody, z } from '@/lib/validate'
import { RELOAD_AND_RETRY, subjectIdsSchema } from '@/lib/tutorSubjectCap'
import { serverError } from '@/lib/errorResponse'
import { ensureTutorSlug } from '@/lib/tutorSlug'
import { recordFieldChanges, type FieldChange } from '@/lib/fieldHistory'
import { normalisePkMobile } from '@/lib/phone'
import { labelsForMasterIdsServer } from '@/lib/taxonomyServer'
import { createAdminClient } from '@/lib/supabase/admin'
import { alertIfReupload } from '@/lib/docReupload'
import { formatName } from '@/lib/formatName'

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
const TOO_MANY_AREAS =
  'You picked a lot of areas. Please keep only the ones you teach in.\nآپ نے بہت زیادہ علاقے چنے ہیں۔ صرف وہ رکھیں جہاں آپ پڑھاتے ہیں۔'
const AREA_TOO_LONG = 'That area name is too long. Please shorten it.\nعلاقے کا نام بہت لمبا ہے۔ اسے مختصر کریں۔'

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

// Every member-facing message here is plain English + Urdu (hotfix, 7 Oct
// 2026) — never Zod's "<Field name> is too long." built from the key.
const AREA = z.string({ message: RELOAD_AND_RETRY }).max(120, { message: AREA_TOO_LONG })
const ProfileBody = z.object({
  profile: z.record(z.string(), z.unknown(), { message: RELOAD_AND_RETRY }).optional(),
  tutorProfile: z.record(z.string(), z.unknown(), { message: RELOAD_AND_RETRY }).optional(),
  // Duplicates are removed BEFORE the cap is checked, so a repeated id never
  // counts twice; the cap is the one shared with Settings and admin
  // (lib/tutorSubjectCap — 400, sized from the live taxonomy).
  subjectMasterIds: subjectIdsSchema.optional(),
  /** PR68: a tutor's areas (all in their MAIN city). Replaces the tutor_areas set. */
  areas: z.array(AREA, { message: RELOAD_AND_RETRY }).max(40, { message: TOO_MANY_AREAS }).optional(),
  /** PR85 (Part A): up to 2 cities, each with its own areas. When present it
   *  supersedes `areas`, and the FIRST key must be the main city (profile.city). */
  areasByCity: z
    .record(z.string().max(120, { message: AREA_TOO_LONG }), z.array(AREA, { message: RELOAD_AND_RETRY }).max(40, { message: TOO_MANY_AREAS }), { message: RELOAD_AND_RETRY })
    .optional(),
  step: z.string({ message: RELOAD_AND_RETRY }).max(64, { message: RELOAD_AND_RETRY }).optional(),
}, { message: RELOAD_AND_RETRY })

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.\nپہلے سائن ان کریں، پھر دوبارہ کوشش کریں۔' }, { status: 401 })

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
  // #46 — names are stored capitalised-per-word from now on (one shared rule).
  if (typeof profilePatch.full_name === 'string') profilePatch.full_name = formatName(profilePatch.full_name)
  if (role !== 'tutor' && cityWrite !== undefined) profilePatch.city = cityWrite
  // PR86: the WhatsApp number is required and validated like the mobile. When a
  // save carries `whatsapp`, it must be a valid Pakistani mobile — stored
  // normalised. (Other steps do not send whatsapp, so they are unaffected.)
  if (Object.prototype.hasOwnProperty.call(profilePatch, 'whatsapp')) {
    const wa = normalisePkMobile(profilePatch.whatsapp as string | null)
    if (!wa) return NextResponse.json({ error: 'Add a valid WhatsApp number.', fields: { whatsapp: 'Enter a valid Pakistani mobile number.' } }, { status: 400 })
    profilePatch.whatsapp = wa
  }
  if (Object.keys(profilePatch).length > 0) {
    const { error } = await supabase.from('profiles').update(profilePatch).eq('id', user.id)
    if (error) return serverError(error, 'profile.save:profiles.update')
  }

  // Old subject ids, captured before the subjects are rewritten below, so the
  // subjects_changed event can name what was added/removed (PR100 §3). Outer
  // scope because the logActivity call is outside the tutor block.
  let oldSubjectIds: number[] = []

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
        oldSubjectIds = (data ?? []).map((r) => r.master_id as number)
        histOld.subjects = oldSubjectIds.slice().sort((a, b) => a - b).join(',')
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

    // PR106-H4 §2.7: a REJECTED profile photo that is re-uploaded is re-queued
    // (status back to 'pending') but the rejection REASON is kept, so the badge
    // stays paused and activity blocked until staff approve. No member path sets
    // profile_pic_status otherwise, so without this a rejected photo could never
    // return to the Approval-needed queue. profile_pic_status is a locked column
    // → service role. Staff approval clears the reason and restores the badge.
    if (avatarProvided) {
      const admin = createAdminClient()
      if (admin) {
        const { data: cur } = await admin.from('profiles').select('profile_pic_status').eq('id', user.id).maybeSingle()
        if (cur?.profile_pic_status === 'rejected') {
          await admin.from('profiles').update({ profile_pic_status: 'pending' }).eq('id', user.id)
          await alertIfReupload(user.id, 'photo')
        }
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
    // Record WHAT changed, not just a count (PR100 §3): the subject names added
    // and removed, plus the total after. histOld.subjects holds the old ids.
    const newIds = body.subjectMasterIds.filter((n) => Number.isInteger(n))
    const oldIds = oldSubjectIds
    const addedIds = newIds.filter((id: number) => !oldIds.includes(id))
    const removedIds = oldIds.filter((id: number) => !newIds.includes(id))
    const names = (labels: string[]) =>
      [...new Set(labels.map((l) => (l.split(' — ').pop() ?? l).trim()).filter(Boolean))]
    // The subjects are ALREADY saved by this point, so the change log must never
    // fail the save (hotfix, 7 Oct 2026): a lookup error is logged and the
    // member still gets success.
    try {
      const [addedLabels, removedLabels] = await Promise.all([
        addedIds.length ? labelsForMasterIdsServer(addedIds) : Promise.resolve([] as string[]),
        removedIds.length ? labelsForMasterIdsServer(removedIds) : Promise.resolve([] as string[]),
      ])
      await logActivity({
        userId: user.id, event: 'subjects_changed', targetType: 'tutor_profile', targetId: user.id,
        meta: { added: names(addedLabels), removed: names(removedLabels), total: newIds.length },
      })
    } catch (e) {
      console.error('[profile.save] subjects change-log failed (save kept):', e instanceof Error ? e.message : e)
    }
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
