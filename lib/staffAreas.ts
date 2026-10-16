import 'server-only'

// lib/staffAreas.ts
//
// Staff add a new area while posting a tuition (owner, 13 Oct 2026), and an
// admin can later say that area is the same as an existing one. Rules:
// lib/staffAreaCore. Every write is audited; nothing is deleted — a merged area
// is retired (removed_at) and its name becomes a spelling of the area it was
// merged into, so tuitions that carry it keep working unchanged.
//
// SEO: nothing here calls the Indexing API. A new area's hub is indexable only
// with 3+ live tuitions, and is found through the sitemap like any other hub.

import { revalidateTag } from 'next/cache'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminRole } from '@/lib/adminAuth'
import { AREA_ALIAS_TAG } from '@/lib/areaAliases'
import { revalidateLanding } from '@/lib/landingRevalidate'
import { cleanAreaName } from '@/lib/locationCleanCore'
import { splitAreaLandmark } from '@/lib/staffAreaCore'
import { formatName } from '@/lib/formatName'

export type Actor = { id: string; adminRole: AdminRole; email?: string | null }

const low = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const NOT_NOW = 'This is not working right now. Please try again in a few minutes.'

export type AddAreaResult =
  | { ok: true; area: string; city: string; existed: boolean }
  | { ok: false; status: 400 | 503; error: string }

/** Save a typed area to the curated list of its city. The city must be in the list. */
export async function addStaffArea(input: { city: string; name: string }, actor: Actor): Promise<AddAreaResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const cityName = (input.city ?? '').trim()
  if (!cityName) return { ok: false, status: 400, error: 'Choose the city first, then add the area.' }
  const { data: city } = await admin.from('location_cities').select('id, name').ilike('name', cityName).limit(1).maybeSingle()
  if (!city) return { ok: false, status: 400, error: `“${cityName}” is not a city in the list, so an area cannot be saved under it.` }

  const name = cleanAreaName(input.name).slice(0, 80)
  if (name.length < 2) return { ok: false, status: 400, error: 'Enter the area name.' }

  const { data: rows } = await admin.from('location_areas').select('id, name, removed_at').eq('city_id', city.id)
  const same = (rows ?? []).find((r) => low(r.name as string) === low(name))
  if (same && !same.removed_at) return { ok: true, area: same.name as string, city: city.name as string, existed: true }

  const { data: who } = await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle()
  const staffName = formatName((who?.full_name as string | null) ?? '') || null
  const now = new Date().toISOString()

  let id: number | null = null
  let saved = name
  if (same) {
    // A retired area of the same name is brought back rather than duplicated.
    const { error } = await admin
      .from('location_areas')
      .update({ removed_at: null, removed_by: null, created_by: actor.id, created_by_name: staffName, created_at: now })
      .eq('id', same.id)
    if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
    id = same.id as number
    saved = same.name as string
  } else {
    const { data, error } = await admin
      .from('location_areas')
      .insert({ city_id: city.id, name, created_by: actor.id, created_by_name: staffName, created_at: now })
      .select('id, name')
      .maybeSingle()
    if (error || !data) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
    id = data.id as number
    saved = data.name as string
  }

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'location.area_add',
    targetType: 'location',
    targetId: String(id),
    detail: { city: city.name, before: null, after: saved, typed: input.name.slice(0, 120), from: 'post_a_tuition' },
  })
  revalidateTag(AREA_ALIAS_TAG, 'max')
  revalidateLanding()
  return { ok: true, area: saved, city: city.name as string, existed: false }
}

export type StaffAddedArea = { id: number; name: string; city: string; cityId: number; addedBy: string | null; addedAt: string | null }

/** Areas added by staff while posting, newest first — for Admin → Locations. */
export async function loadStaffAddedAreas(): Promise<StaffAddedArea[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin
    .from('location_areas')
    .select('id, name, city_id, created_by, created_by_name, created_at, location_cities(name)')
    .not('created_by', 'is', null)
    .is('removed_at', null)
    .order('created_at', { ascending: false })
    .limit(500)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const c = Array.isArray(r.location_cities) ? r.location_cities[0] : r.location_cities
    return {
      id: r.id as number,
      name: r.name as string,
      city: ((c as { name?: string } | null)?.name ?? '') as string,
      cityId: r.city_id as number,
      addedBy: (r.created_by_name as string | null) ?? null,
      addedAt: (r.created_at as string | null) ?? null,
    }
  })
}

/**
 * "Same as existing area" for an area staff added: the added name becomes a
 * spelling of the chosen area (the same alias table the review list writes),
 * spellings that pointed at it now point at the chosen area, and the added area
 * is retired — never deleted. Tuitions keep the text they were saved with.
 */
export async function mergeStaffArea(input: { areaId: number; intoAreaId: number }, actor: Actor): Promise<{ ok: true; from: string; into: string } | { ok: false; status: 400 | 503; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  if (input.areaId === input.intoAreaId) return { ok: false, status: 400, error: 'Choose a different area.' }
  const { data: rows } = await admin.from('location_areas').select('id, name, city_id, created_by, removed_at').in('id', [input.areaId, input.intoAreaId])
  const from = (rows ?? []).find((r) => r.id === input.areaId)
  const into = (rows ?? []).find((r) => r.id === input.intoAreaId)
  if (!from || !into || from.removed_at || into.removed_at) return { ok: false, status: 400, error: 'That area was not found. Reload the page and try again.' }
  if (!from.created_by) return { ok: false, status: 400, error: 'Only an area added by staff while posting can be merged here.' }
  if (from.city_id !== into.city_id) return { ok: false, status: 400, error: 'Choose an area of the same city.' }

  const { error: aliasError } = await admin
    .from('location_area_aliases')
    .insert({ city_id: from.city_id, raw: from.name, area_id: into.id, created_by: actor.id, created_by_email: actor.email ?? null })
  if (aliasError && aliasError.code !== '23505') return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  // Spellings that counted as the retired area now count as the one it joined.
  await admin.from('location_area_aliases').update({ area_id: into.id }).eq('area_id', from.id).is('removed_at', null)
  const { error } = await admin.from('location_areas').update({ removed_at: new Date().toISOString(), removed_by: actor.id }).eq('id', from.id)
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'location.alias',
    targetType: 'location',
    targetId: String(into.id),
    detail: { value: from.name, before: `Area added by staff (${from.name})`, after: into.name, from: 'staff_added_area', retiredAreaId: from.id },
  })
  revalidateTag(AREA_ALIAS_TAG, 'max')
  revalidateLanding()
  return { ok: true, from: from.name as string, into: into.name as string }
}

// ---------------------------------------------------------------------------
// Suggestions for staff-added areas (owner, 16 Oct 2026).
//
// Many areas staff added while posting are a curated area with a block or
// landmark around it ("Clifton Block 1"). For each, Admin → Locations suggests
// "Same as <area>" and the landmark ("Block 1"); the Owner approves with one
// click, or approves all. Approving = the existing merge (the added name
// becomes a spelling of the area, the added row is retired, never deleted)
// PLUS jobs.area_landmark on the tuitions saved with that name in that city.
// Tuitions keep their URLs and their saved area text; only the area link (via
// the spelling) and the landmark change.

export type AreaSuggestion = { areaId: number; name: string; city: string; intoAreaId: number; intoName: string; landmark: string }

/** The suggestion for each staff-added area that names a curated (owner-list) area. */
export async function staffAreaSuggestions(): Promise<AreaSuggestion[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const added = await loadStaffAddedAreas()
  if (added.length === 0) return []
  const cityIds = [...new Set(added.map((a) => a.cityId))]
  const { data: curated } = await admin
    .from('location_areas')
    .select('id, name, city_id, created_by')
    .in('city_id', cityIds)
    .is('removed_at', null)
    .is('created_by', null)
  const byCity = new Map<number, { id: number; name: string }[]>()
  for (const c of curated ?? []) {
    const list = byCity.get(c.city_id as number) ?? []
    list.push({ id: c.id as number, name: c.name as string })
    byCity.set(c.city_id as number, list)
  }
  const out: AreaSuggestion[] = []
  for (const a of added) {
    const list = byCity.get(a.cityId) ?? []
    const split = splitAreaLandmark(a.city, a.name, list.map((l) => l.name))
    if (!split) continue
    const into = list.find((l) => l.name === split.area)
    if (!into) continue
    out.push({ areaId: a.id, name: a.name, city: a.city, intoAreaId: into.id, intoName: into.name, landmark: split.landmark })
  }
  return out
}

/** Approve one suggestion: merge, then the landmark on that city's tuitions saved
 *  with the added name. Audited (location.alias by the merge, location.landmark here). */
export async function approveAreaSuggestion(areaId: number, actor: Actor): Promise<{ ok: true; from: string; into: string; landmark: string; tuitions: number } | { ok: false; status: 400 | 503; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const s = (await staffAreaSuggestions()).find((x) => x.areaId === areaId)
  if (!s) return { ok: false, status: 400, error: 'There is no suggestion for that area any more. Reload the page.' }
  const merged = await mergeStaffArea({ areaId: s.areaId, intoAreaId: s.intoAreaId }, actor)
  if (!merged.ok) return merged
  // The tuitions saved with exactly this text in this city (case ignored) that
  // have no landmark yet. jobs.area itself is not rewritten.
  const { data: jobs } = await admin.from('jobs').select('id, area, area_landmark').ilike('city', s.city).ilike('area', s.name.replace(/[%_\\]/g, '\\$&'))
  const ids = (jobs ?? []).filter((j) => !((j.area_landmark as string | null) ?? '').trim()).map((j) => j.id as string)
  if (ids.length > 0) await admin.from('jobs').update({ area_landmark: s.landmark }).in('id', ids)
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'location.landmark',
    targetType: 'location',
    targetId: String(s.intoAreaId),
    detail: { value: s.name, area: s.intoName, landmark: s.landmark, city: s.city, tuitions: ids.length, jobIds: ids.slice(0, 200) },
  })
  return { ok: true, from: merged.from, into: merged.into, landmark: s.landmark, tuitions: ids.length }
}
