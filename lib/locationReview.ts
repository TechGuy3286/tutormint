import 'server-only'

// lib/locationReview.ts
//
// Admin → Locations: the areas members typed that are not in the curated list,
// each with a SUGGESTED action, and the three actions staff can take (owner,
// 13 Oct 2026):
//
//   add      "Add as new area"        → a row in location_areas
//   same     "Same as existing area"  → a row in location_area_aliases
//   not_area "Not an area"            → a row in location_ignored (hidden)
//
// The text on tuitions and profiles is never rewritten; only what it MEANS
// changes. Nothing is deleted. Every action is in the Audit log. Approving an
// area or an alias re-evaluates its hub at once and tells Google about the hub
// when it has 3 or more open tuitions.
//
// The loader only reads and suggests — it writes nothing. Suggestions are never
// saved until staff approve them here.

import { revalidateTag } from 'next/cache'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { logAdminAction } from '@/lib/auditLog'
import { enqueueIndexing } from '@/lib/googleIndexing'
import { revalidateLanding } from '@/lib/landingRevalidate'
import { AREA_ALIAS_TAG } from '@/lib/areaAliases'
import { areaHubSlug, areaKey, resolveAreaHub } from '@/lib/areaHubCore'
import { cleanAreaName, suggestFor, type NotAreaReason, type Suggestion } from '@/lib/locationCleanCore'
import { citySegment } from '@/lib/slugs'
import { SITE_URL } from '@/lib/siteUrl'
import type { AdminRole } from '@/lib/adminAccessCore'

export type ReviewRow = {
  /** `${city}|${value}` lower-case — the row's identity on the screen. */
  key: string
  value: string
  /** The city it was typed under ('' when none). */
  city: string
  /** How many tuitions and profiles carry this value. */
  count: number
  /** Open tuitions carrying it — what a hub would count. */
  openTuitions: number
  /** True when the city is in the curated list (an area can only be added or
   *  matched under a curated city). */
  cityListed: boolean
  suggestion: Suggestion
}

export type ReviewBoard = {
  rows: ReviewRow[]
  /** Curated areas by city, for the "Same as existing area" picker. */
  areasByCity: Record<string, { id: number; name: string }[]>
  counts: { same: number; notArea: number; add: number; aliases: number; ignored: number }
}

type Actor = { id: string; adminRole: AdminRole; email: string | null }
type Admin = NonNullable<ReturnType<typeof createAdminClient>>

const low = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
export const rowKey = (city: string | null | undefined, value: string | null | undefined) => `${low(city)}|${low(value)}`

async function curated(admin: Admin) {
  const [{ data: cities }, areas] = await Promise.all([
    admin.from('location_cities').select('id, name'),
    pageAll((from, to) => admin.from('location_areas').select('id, name, city_id').is('removed_at', null).order('id').range(from, to)) as Promise<
      { id: number; name: string; city_id: number }[]
    >,
  ])
  const cityById = new Map((cities ?? []).map((c) => [c.id as number, c.name as string]))
  const cityByName = new Map((cities ?? []).map((c) => [low(c.name as string), { id: c.id as number, name: c.name as string }]))
  const areasByCity: Record<string, { id: number; name: string }[]> = {}
  for (const a of areas) {
    const city = cityById.get(a.city_id)
    if (!city) continue
    ;(areasByCity[low(city)] ??= []).push({ id: a.id, name: a.name })
  }
  for (const list of Object.values(areasByCity)) list.sort((a, b) => a.name.localeCompare(b.name))
  return { cityByName, areasByCity }
}

/** The review list. Reads only. */
export async function loadLocationReview(): Promise<ReviewBoard> {
  const empty: ReviewBoard = { rows: [], areasByCity: {}, counts: { same: 0, notArea: 0, add: 0, aliases: 0, ignored: 0 } }
  const admin = createAdminClient()
  if (!admin) return empty

  const { cityByName, areasByCity } = await curated(admin)
  const [jobs, tutors, profs, tutorAreas, aliasRows, ignoredRows] = await Promise.all([
    pageAll((from, to) => admin.from('jobs').select('id, city, area, status').order('id').range(from, to)),
    pageAll((from, to) => admin.from('tutor_profiles').select('id, city, area').order('id').range(from, to)),
    pageAll((from, to) => admin.from('profiles').select('id, city, area').order('id').range(from, to)),
    pageAll((from, to) => admin.from('tutor_areas').select('id, city, area').order('id').range(from, to)).catch(() => []),
    pageAll((from, to) => admin.from('location_area_aliases').select('id, raw, city_id, location_cities(name)').is('removed_at', null).order('id').range(from, to)).catch(() => []),
    pageAll((from, to) => admin.from('location_ignored').select('id, city, raw').is('removed_at', null).order('id').range(from, to)).catch(() => []),
  ])

  const one = (v: unknown): string => {
    const x = Array.isArray(v) ? v[0] : v
    return ((x as { name?: string } | null)?.name ?? '') as string
  }
  const aliased = new Set((aliasRows as { raw: string; location_cities: unknown }[]).map((a) => rowKey(one(a.location_cities), a.raw)))
  const ignored = new Set((ignoredRows as { city: string; raw: string }[]).map((i) => rowKey(i.city, i.raw)))

  const found = new Map<string, { value: string; city: string; count: number; open: number }>()
  const take = (city: string | null, area: string | null, open: boolean) => {
    const a = (area ?? '').trim()
    if (!a) return
    const c = (city ?? '').trim()
    const list = areasByCity[low(c)] ?? []
    if (list.some((x) => low(x.name) === low(a))) return
    const key = rowKey(c, a)
    if (aliased.has(key) || ignored.has(key)) return
    const cur = found.get(key) ?? { value: a, city: c, count: 0, open: 0 }
    cur.count++
    if (open) cur.open++
    found.set(key, cur)
  }
  for (const j of jobs as { city: string | null; area: string | null; status: string | null }[]) take(j.city, j.area, j.status === 'open')
  for (const r of [...tutors, ...profs, ...tutorAreas] as { city: string | null; area: string | null }[]) take(r.city, r.area, false)

  const cityNames = [...cityByName.values()].map((c) => c.name)
  const rows: ReviewRow[] = [...found.entries()].map(([key, f]) => {
    const list = (areasByCity[low(f.city)] ?? []).map((a) => a.name)
    return {
      key,
      value: f.value,
      city: f.city,
      count: f.count,
      openTuitions: f.open,
      cityListed: cityByName.has(low(f.city)),
      suggestion: suggestFor(f.value, f.city, list, cityNames),
    }
  })
  rows.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))

  return {
    rows,
    areasByCity,
    counts: {
      same: rows.filter((r) => r.suggestion.action === 'same').length,
      notArea: rows.filter((r) => r.suggestion.action === 'not_area').length,
      add: rows.filter((r) => r.suggestion.action === 'add').length,
      aliases: aliased.size,
      ignored: ignored.size,
    },
  }
}

export type ReviewAction =
  | { action: 'add'; value: string; city: string; name: string }
  | { action: 'same'; value: string; city: string; areaId: number }
  | { action: 'not_area'; value: string; city: string; reason: NotAreaReason }

export type ActionResult = { value: string; city: string; ok: boolean; message: string; hub?: string | null }

/** How many OPEN tuitions the area's hub would hold now, every spelling counted. */
async function hubCount(admin: Admin, city: string, area: string, curatedNames: string[]): Promise<number> {
  const [open, aliasRows] = await Promise.all([
    pageAll((from, to) => admin.from('jobs').select('id, area').eq('status', 'open').ilike('city', city).not('area', 'is', null).order('id').range(from, to)),
    pageAll((from, to) =>
      admin.from('location_area_aliases').select('id, raw, location_cities!inner(name), location_areas(name)').is('removed_at', null).order('id').range(from, to),
    ).catch(() => []),
  ])
  const aliases: Record<string, string> = {}
  for (const r of aliasRows as { raw: string; location_cities: unknown; location_areas: unknown }[]) {
    const c = Array.isArray(r.location_cities) ? r.location_cities[0] : r.location_cities
    const a = Array.isArray(r.location_areas) ? r.location_areas[0] : r.location_areas
    if (low((c as { name?: string } | null)?.name) !== low(city)) continue
    const k = areaKey(r.raw, city)
    if (k && (a as { name?: string } | null)?.name) aliases[k] = (a as { name: string }).name
  }
  const slug = areaHubSlug(area, city)
  return (open as { area: string | null }[]).filter((j) => {
    const hit = resolveAreaHub(city, j.area, curatedNames, aliases)
    return hit ? areaHubSlug(hit.area, city) === slug : false
  }).length
}

/**
 * Apply the approved actions, one by one (a refused row never stops the rest).
 * Each writes its own Audit log row with before → after.
 */
export async function applyLocationActions(actions: ReviewAction[], actor: Actor): Promise<{ ok: boolean; results: ActionResult[]; hubsQueued: string[] }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, results: [], hubsQueued: [] }
  const { cityByName, areasByCity } = await curated(admin)
  const results: ActionResult[] = []
  const hubs = new Map<string, { city: string; area: string }>()
  const who = { actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email }

  for (const a of actions) {
    const value = (a.value ?? '').trim()
    const city = (a.city ?? '').trim()
    const done = (ok: boolean, message: string) => results.push({ value, city, ok, message })
    if (!value) {
      done(false, 'Nothing to save.')
      continue
    }
    const cityRow = cityByName.get(low(city))

    if (a.action === 'not_area') {
      const { error } = await admin.from('location_ignored').insert({ city, raw: value, reason: a.reason, created_by: actor.id, created_by_email: actor.email })
      // 23505 = already hidden: the same answer.
      if (error && error.code !== '23505') {
        done(false, 'That did not save. Please try again.')
        continue
      }
      await logAdminAction({ ...who, action: 'location.not_area', targetType: 'location', targetId: rowKey(city, value), detail: { value, city: city || null, before: 'Free text', after: `Not an area (${a.reason})` } })
      done(true, 'Hidden from this list.')
      continue
    }

    if (!cityRow) {
      done(false, `“${city || 'No city'}” is not a city in the list, so an area cannot be saved under it.`)
      continue
    }
    const list = areasByCity[low(city)] ?? (areasByCity[low(city)] = [])

    if (a.action === 'add') {
      const name = cleanAreaName(a.name).slice(0, 80)
      if (name.length < 2) {
        done(false, 'Enter the area name.')
        continue
      }
      let area = list.find((x) => low(x.name) === low(name))
      const existed = !!area
      if (!area) {
        const { data, error } = await admin.from('location_areas').insert({ city_id: cityRow.id, name }).select('id, name').maybeSingle()
        if (error || !data) {
          done(false, 'That did not save. Please try again.')
          continue
        }
        area = { id: data.id as number, name: data.name as string }
        list.push(area)
        await logAdminAction({ ...who, action: 'location.area_add', targetType: 'location', targetId: String(area.id), detail: { city: cityRow.name, before: null, after: area.name, from: value } })
      }
      // The typed spelling counts as the new area from now on (unless it IS the name).
      if (low(value) !== low(area.name)) {
        const { error } = await admin.from('location_area_aliases').insert({ city_id: cityRow.id, raw: value, area_id: area.id, created_by: actor.id, created_by_email: actor.email })
        if (!error) await logAdminAction({ ...who, action: 'location.alias', targetType: 'location', targetId: String(area.id), detail: { city: cityRow.name, value, before: 'Free text', after: area.name } })
      }
      hubs.set(`${low(city)}|${low(area.name)}`, { city: cityRow.name, area: area.name })
      done(true, existed ? `${area.name} was already in the list; “${value}” now counts as it.` : `${area.name} added to ${cityRow.name}.`)
      continue
    }

    // same
    const area = list.find((x) => x.id === a.areaId)
    if (!area) {
      done(false, 'Choose an area of the same city.')
      continue
    }
    const { error } = await admin.from('location_area_aliases').insert({ city_id: cityRow.id, raw: value, area_id: area.id, created_by: actor.id, created_by_email: actor.email })
    if (error && error.code !== '23505') {
      done(false, 'That did not save. Please try again.')
      continue
    }
    if (!error) await logAdminAction({ ...who, action: 'location.alias', targetType: 'location', targetId: String(area.id), detail: { city: cityRow.name, value, before: 'Free text', after: area.name } })
    hubs.set(`${low(city)}|${low(area.name)}`, { city: cityRow.name, area: area.name })
    done(true, `“${value}” now counts as ${area.name}.`)
  }

  // The hubs and labels read the new mapping at once.
  revalidateTag(AREA_ALIAS_TAG, 'max')
  revalidateLanding()

  // Re-evaluate each touched hub: with 3+ open tuitions it is indexable, so
  // Google is told about it (through the queue, within 200 a day).
  const hubsQueued: string[] = []
  for (const h of hubs.values()) {
    try {
      const names = (areasByCity[low(h.city)] ?? []).map((x) => x.name)
      const n = await hubCount(admin, h.city, h.area, names)
      if (n < 3) continue
      const url = `${SITE_URL}/tuition-jobs/${citySegment(h.city)}/${areaHubSlug(h.area, h.city)}`
      await enqueueIndexing([url], 'URL_UPDATED')
      hubsQueued.push(url)
      for (const r of results) if (low(r.city) === low(h.city) && r.ok && r.hub === undefined && r.message.includes(h.area)) r.hub = url
    } catch {
      /* the hub still re-evaluates on its next request */
    }
  }

  return { ok: results.some((r) => r.ok), results, hubsQueued }
}
