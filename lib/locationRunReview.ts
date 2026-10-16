import 'server-only'

// lib/locationRunReview.ts
//
// "Review added areas" (owner, 16 Oct 2026) — the I/O half. The rules are pure
// in lib/locationRunCore.ts. The rows are the ones the 16 Oct "Approve all
// suggestions" run wrote, found by their own creation time inside the run's
// window (and, for areas, by the run's location.area_add Audit rows):
//
//   area     120 rows of location_areas the run added
//   alias    142 rows of location_area_aliases ("same as" an area)
//   ignored  44 rows of location_ignored ("Not an area")
//
// Every action is the Owner's (the route refuses everyone else). Nothing is
// deleted: a merged or "not an area" area is RETIRED (removed_at), a changed
// match retires the old spelling row and saves a new one, a "Not an area" value
// taken back is retired too. jobs.area / profiles.area — the text members
// saved — is never changed. Every change writes admin_audit_log and the
// decision is kept in location_run_reviews.
//
// A merged or retired area can never be a hub or a sitemap entry: every reader
// of location_areas filters removed_at is null (lib/cityJobs, lib/areaHubCore).
// A merged area's old hub address moves on with a 301 — its name is saved as a
// spelling of the area it joined, which proxy.ts → lib/areaHubRedirect reads.

import { revalidateTag } from 'next/cache'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { logAdminAction } from '@/lib/auditLog'
import { revalidateLanding } from '@/lib/landingRevalidate'
import { AREA_ALIAS_TAG } from '@/lib/areaAliases'
import { areaHubSlug, areaKey, resolveAreaHub, type CityAliases } from '@/lib/areaHubCore'
import { cityPages, CITY_PAGE_THRESHOLD } from '@/lib/cityJobs'
import { cleanAreaName } from '@/lib/locationCleanCore'
import { RUN_END, RUN_START, areaWarnings, runActionProblem, type AreaWarning, type RunAction, type RunKind } from '@/lib/locationRunCore'
import type { AdminRole } from '@/lib/adminAccessCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>
type Actor = { id: string; adminRole: AdminRole; email: string | null }

const low = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
/** An exact, case-blind match for ilike: % and _ taken literally. */
const esc = (s: string) => s.replace(/[%_\\]/g, '\\$&')

export type RunDecision = { decision: string; decidedAt: string } | null

export type RunAreaRow = {
  id: number
  name: string
  city: string
  cityId: number
  /** Retired since the run (merged or marked not an area). */
  retired: boolean
  tuitions: number
  openTuitions: number
  profiles: number
  /** The hub address, when this area has a public hub page today. */
  hub: string | null
  warnings: AreaWarning[]
  closeTo: { id: number; name: string } | null
  /** The spellings the run saved as this area. */
  spellings: string[]
  review: RunDecision
}

export type RunAliasRow = {
  id: number
  raw: string
  city: string
  cityId: number
  areaId: number
  areaName: string
  retired: boolean
  uses: number
  review: RunDecision
}

export type RunIgnoredRow = {
  id: number
  raw: string
  city: string
  reason: string
  retired: boolean
  uses: number
  review: RunDecision
}

export type RunBoard = {
  areas: RunAreaRow[]
  aliases: RunAliasRow[]
  ignored: RunIgnoredRow[]
  /** Live curated areas by lower-case city — the "Same as" pickers. */
  areasByCity: Record<string, { id: number; name: string }[]>
  summary: { areas: number; warned: number; withHub: number; aliases: number; ignored: number; reviewed: number }
}

type Named = { name: string } | { name: string }[] | null
const nameOf = (v: Named) => (Array.isArray(v) ? v[0] : v)?.name ?? ''

async function runAreaIds(admin: Admin): Promise<number[]> {
  const { data } = await admin
    .from('admin_audit_log')
    .select('target_id')
    .eq('action', 'location.area_add')
    .gte('created_at', RUN_START)
    .lte('created_at', RUN_END)
    .limit(1000)
  return [...new Set((data ?? []).map((r) => Number(r.target_id)).filter((n) => Number.isFinite(n) && n > 0))]
}

async function reviewsOf(admin: Admin): Promise<Map<string, RunDecision>> {
  const { data } = await admin.from('location_run_reviews').select('kind, ref_id, decision, decided_at')
  return new Map((data ?? []).map((r) => [`${r.kind}:${r.ref_id}`, { decision: r.decision as string, decidedAt: r.decided_at as string }]))
}

/** The whole review board. Reads only. With `search` (owner, 16 Oct 2026):
 *  every LIVE area of any date whose name contains the text, as the same cards
 *  with the same actions — so an area older than the 16 Oct run (Karachi
 *  "Gulshan") can be merged from this screen too. */
export async function loadRunReview(opts: { search?: string } = {}): Promise<RunBoard> {
  const search = (opts.search ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const empty: RunBoard = { areas: [], aliases: [], ignored: [], areasByCity: {}, summary: { areas: 0, warned: 0, withHub: 0, aliases: 0, ignored: 0, reviewed: 0 } }
  const admin = createAdminClient()
  if (!admin) return empty
  const ids = search ? [] : await runAreaIds(admin)
  const [{ data: cities }, curated, runAreas, aliasRows, ignoredRows, allAliases, jobs, tutors, profs, tutorAreas, reviews, pages] = await Promise.all([
    admin.from('location_cities').select('id, name'),
    pageAll((f, t) => admin.from('location_areas').select('id, name, city_id').is('removed_at', null).order('id').range(f, t)) as Promise<
      { id: number; name: string; city_id: number }[]
    >,
    search
      ? admin.from('location_areas').select('id, name, city_id, removed_at').ilike('name', `%${esc(search)}%`).is('removed_at', null).order('name').limit(60)
      : ids.length
        ? admin.from('location_areas').select('id, name, city_id, removed_at').in('id', ids)
        : Promise.resolve({ data: [] }),
    admin
      .from('location_area_aliases')
      .select('id, raw, city_id, area_id, removed_at, location_areas(name)')
      .gte('created_at', RUN_START)
      .lte('created_at', RUN_END)
      .order('id')
      .limit(1000),
    admin.from('location_ignored').select('id, city, raw, reason, removed_at').gte('created_at', RUN_START).lte('created_at', RUN_END).order('id').limit(1000),
    pageAll((f, t) => admin.from('location_area_aliases').select('raw, city_id, area_id').is('removed_at', null).order('id').range(f, t)) as Promise<
      { raw: string; city_id: number; area_id: number }[]
    >,
    pageAll((f, t) => admin.from('jobs').select('id, city, area, status').order('id').range(f, t)),
    pageAll((f, t) => admin.from('tutor_profiles').select('id, city, area').order('id').range(f, t)),
    pageAll((f, t) => admin.from('profiles').select('id, city, area').order('id').range(f, t)),
    pageAll((f, t) => admin.from('tutor_areas').select('id, city, area').order('id').range(f, t)).catch(() => []),
    reviewsOf(admin),
    cityPages(),
  ])
  const cityName = new Map((cities ?? []).map((c) => [c.id as number, c.name as string]))
  const cityNames = [...cityName.values()]
  const areaName = new Map(curated.map((a) => [a.id, a.name]))

  const areasByCity: RunBoard['areasByCity'] = {}
  const curatedByCity = new Map<string, string[]>()
  for (const a of curated) {
    const c = cityName.get(a.city_id)
    if (!c) continue
    ;(areasByCity[low(c)] ??= []).push({ id: a.id, name: a.name })
    ;(curatedByCity.get(low(c)) ?? curatedByCity.set(low(c), []).get(low(c))!).push(a.name)
  }
  for (const l of Object.values(areasByCity)) l.sort((a, b) => a.name.localeCompare(b.name))
  const aliasIndex = new Map<string, CityAliases>()
  for (const a of allAliases) {
    const c = cityName.get(a.city_id)
    const n = areaName.get(a.area_id)
    if (!c || !n) continue
    const m = aliasIndex.get(low(c)) ?? {}
    m[areaKey(a.raw, c)] = n
    aliasIndex.set(low(c), m)
  }

  // Usage: which curated area each saved (city, area) value counts as, and how
  // often each exact value is used.
  const usesByArea = new Map<string, { tuitions: number; open: number; profiles: number }>()
  const usesByValue = new Map<string, number>()
  const resolved = new Map<string, string | null>()
  const take = (city: string | null, area: string | null, isJob: boolean, open: boolean) => {
    const c = (city ?? '').trim()
    const a = (area ?? '').trim()
    if (!c || !a) return
    const vk = `${low(c)}|${low(a)}`
    usesByValue.set(vk, (usesByValue.get(vk) ?? 0) + 1)
    if (!resolved.has(vk)) resolved.set(vk, resolveAreaHub(c, a, curatedByCity.get(low(c)) ?? [], aliasIndex.get(low(c)))?.area ?? null)
    const hit = resolved.get(vk)
    if (!hit) return
    const k = `${low(c)}|${low(hit)}`
    const u = usesByArea.get(k) ?? { tuitions: 0, open: 0, profiles: 0 }
    if (isJob) {
      u.tuitions++
      if (open) u.open++
    } else u.profiles++
    usesByArea.set(k, u)
  }
  for (const j of jobs as { city: string | null; area: string | null; status: string | null }[]) take(j.city, j.area, true, j.status === 'open')
  for (const r of [...tutors, ...profs, ...tutorAreas] as { city: string | null; area: string | null }[]) take(r.city, r.area, false, false)

  // Public hub pages today (3+ open tuitions; curated areas only).
  const hubs = new Set<string>()
  for (const p of pages) for (const v of p.variants) if (v.kind === 'area' && v.count >= CITY_PAGE_THRESHOLD) hubs.add(`${p.citySlug}/${v.slug}`)

  const runRows = (runAreas.data ?? []) as { id: number; name: string; city_id: number; removed_at: string | null }[]
  const runAliasRows = (search ? [] : (aliasRows.data ?? [])) as { id: number; raw: string; city_id: number; area_id: number; removed_at: string | null; location_areas: Named }[]
  const spellings = new Map<number, string[]>()
  // Search: every live spelling of the area; the run board: the run's own.
  for (const a of search ? allAliases : runAliasRows.filter((x) => !x.removed_at)) spellings.set(a.area_id, [...(spellings.get(a.area_id) ?? []), a.raw])

  const areas: RunAreaRow[] = runRows.map((r) => {
    const city = cityName.get(r.city_id) ?? ''
    const others = (areasByCity[low(city)] ?? []).filter((a) => a.id !== r.id)
    const w = areaWarnings(r.name, city, others.map((o) => o.name), cityNames)
    const u = usesByArea.get(`${low(city)}|${low(r.name)}`) ?? { tuitions: 0, open: 0, profiles: 0 }
    const slug = areaHubSlug(r.name, city)
    const citySlug = pages.find((p) => low(p.city) === low(city))?.citySlug ?? null
    // Two list rows with one name share one hub; it belongs to the row the hub
    // rule picks (the shorter name), so a hub is never counted twice.
    const owner = resolveAreaHub(city, r.name, curatedByCity.get(low(city)) ?? [], aliasIndex.get(low(city)))?.area
    const hub = !r.removed_at && owner === r.name && citySlug && hubs.has(`${citySlug}/${slug}`) ? `/tuition-jobs/${citySlug}/${slug}` : null
    return {
      id: r.id,
      name: r.name,
      city,
      cityId: r.city_id,
      retired: !!r.removed_at,
      tuitions: u.tuitions,
      openTuitions: u.open,
      profiles: u.profiles,
      hub,
      warnings: w.warnings,
      closeTo: w.closeTo ? (others.find((o) => o.name === w.closeTo) ?? null) : null,
      spellings: spellings.get(r.id) ?? [],
      review: reviews.get(`area:${r.id}`) ?? null,
    }
  })
  areas.sort((a, b) => b.warnings.length - a.warnings.length || a.city.localeCompare(b.city) || a.name.localeCompare(b.name))

  const aliases: RunAliasRow[] = runAliasRows.map((a) => {
    const city = cityName.get(a.city_id) ?? ''
    return {
      id: a.id,
      raw: a.raw,
      city,
      cityId: a.city_id,
      areaId: a.area_id,
      areaName: nameOf(a.location_areas),
      retired: !!a.removed_at,
      uses: usesByValue.get(`${low(city)}|${low(a.raw)}`) ?? 0,
      review: reviews.get(`alias:${a.id}`) ?? null,
    }
  })
  const ignored: RunIgnoredRow[] = ((search ? [] : (ignoredRows.data ?? [])) as { id: number; city: string; raw: string; reason: string; removed_at: string | null }[]).map((i) => ({
    id: i.id,
    raw: i.raw,
    city: i.city,
    reason: i.reason,
    retired: !!i.removed_at,
    uses: usesByValue.get(`${low(i.city)}|${low(i.raw)}`) ?? 0,
    review: reviews.get(`ignored:${i.id}`) ?? null,
  }))

  return {
    areas,
    aliases,
    ignored,
    areasByCity,
    summary: {
      areas: areas.length,
      warned: areas.filter((a) => a.warnings.length > 0).length,
      withHub: areas.filter((a) => a.hub).length,
      aliases: aliases.length,
      ignored: ignored.length,
      reviewed: reviews.size,
    },
  }
}

// ------------------------------------------------------------- actions

export type RunResult = { kind: RunKind; id: number; ok: boolean; message: string }

export async function mark(admin: Admin, kind: RunKind, id: number, decision: string, actor: Actor, detail: Record<string, unknown>) {
  await admin
    .from('location_run_reviews')
    .upsert({ kind, ref_id: id, decision, detail, decided_by: actor.id, decided_at: new Date().toISOString() }, { onConflict: 'kind,ref_id' })
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'location.run_review',
    targetType: 'location',
    targetId: `${kind}:${id}`,
    detail: { decision, ...detail },
  })
}

async function inWindow(admin: Admin, table: 'location_area_aliases' | 'location_ignored', id: number) {
  const { data } = await admin.from(table).select('*').eq('id', id).gte('created_at', RUN_START).lte('created_at', RUN_END).maybeSingle()
  return data as Record<string, unknown> | null
}

async function liveArea(admin: Admin, id: number) {
  const { data } = await admin.from('location_areas').select('id, name, city_id, removed_at').eq('id', id).maybeSingle()
  return data && !data.removed_at ? (data as { id: number; name: string; city_id: number }) : null
}

/** Merge one run area into another area of the same city: its name becomes a
 *  spelling of that area, its spellings follow, and it is retired. */
export async function mergeArea(
  admin: Admin,
  from: { id: number; name: string; city_id: number },
  into: { id: number; name: string },
  actor: Actor,
  extra: Record<string, unknown> = {},
) {
  const { error } = await admin
    .from('location_area_aliases')
    .insert({ city_id: from.city_id, raw: from.name, area_id: into.id, created_by: actor.id, created_by_email: actor.email })
  if (error && error.code !== '23505') return false
  await admin.from('location_area_aliases').update({ area_id: into.id }).eq('area_id', from.id).is('removed_at', null)
  const { error: e2 } = await admin.from('location_areas').update({ removed_at: new Date().toISOString(), removed_by: actor.id }).eq('id', from.id).is('removed_at', null)
  if (e2) return false
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'location.alias',
    targetType: 'location',
    targetId: String(into.id),
    detail: { value: from.name, before: `Area (${from.name})`, after: into.name, from: 'run_review', retiredAreaId: from.id, ...extra },
  })
  return true
}

async function applyOne(admin: Admin, a: RunAction, actor: Actor): Promise<RunResult> {
  const res = (ok: boolean, message: string): RunResult => ({ kind: a.kind, id: a.id, ok, message })
  const problem = runActionProblem(a)
  if (problem) return res(false, problem)

  if (a.kind === 'area') {
    // Any live area may be decided here (owner, 16 Oct 2026: the search over all
    // areas), not only the ones the 16 Oct run added.
    const area = await liveArea(admin, a.id)
    if (a.decision === 'keep') {
      if (!area) return res(false, 'That area was already merged or marked not an area.')
      await mark(admin, 'area', a.id, 'keep', actor, { name: area.name })
      return res(true, `${area.name} kept.`)
    }
    if (!area) return res(false, 'That area was already merged or marked not an area.')
    if (a.decision === 'not_area') {
      const now = new Date().toISOString()
      const { data: spell } = await admin.from('location_area_aliases').select('id, raw').eq('area_id', area.id).is('removed_at', null)
      const city = (await admin.from('location_cities').select('name').eq('id', area.city_id).maybeSingle()).data?.name as string | undefined
      if (!city) return res(false, 'That city was not found.')
      const { error } = await admin.from('location_areas').update({ removed_at: now, removed_by: actor.id }).eq('id', area.id).is('removed_at', null)
      if (error) return res(false, 'That did not save. Please try again.')
      if ((spell ?? []).length) await admin.from('location_area_aliases').update({ removed_at: now, removed_by: actor.id }).in('id', (spell ?? []).map((s) => s.id as number))
      for (const raw of [area.name, ...(spell ?? []).map((s) => s.raw as string)]) {
        const { error: ie } = await admin.from('location_ignored').insert({ city, raw, reason: a.reason, created_by: actor.id, created_by_email: actor.email })
        if (!ie || ie.code === '23505') {
          await logAdminAction({
            actorId: actor.id,
            actorRole: actor.adminRole,
            actorEmail: actor.email,
            action: 'location.not_area',
            targetType: 'location',
            targetId: `${low(city)}|${low(raw)}`,
            detail: { value: raw, city, before: `Area (${area.name})`, after: `Not an area (${a.reason})`, retiredAreaId: area.id },
          })
        }
      }
      await mark(admin, 'area', a.id, 'not_area', actor, { name: area.name, reason: a.reason, spellings: (spell ?? []).length })
      return res(true, `${area.name} marked not an area.`)
    }
    // merge / split
    const into = await liveArea(admin, a.intoAreaId)
    if (!into || into.city_id !== area.city_id) return res(false, 'Choose an area in the same city.')
    const { data: spellRows } = await admin.from('location_area_aliases').select('raw').eq('area_id', area.id).is('removed_at', null)
    const names = [area.name, ...(spellRows ?? []).map((s) => s.raw as string)]
    if (!(await mergeArea(admin, area, into, actor))) return res(false, 'That did not save. Please try again.')
    if (a.decision === 'merge') {
      await mark(admin, 'area', a.id, 'merge', actor, { name: area.name, into: into.name, intoAreaId: into.id })
      return res(true, `${area.name} merged into ${into.name}.`)
    }
    const landmark = a.landmark.replace(/\s+/g, ' ').trim()
    const city = (await admin.from('location_cities').select('name').eq('id', area.city_id).maybeSingle()).data?.name as string | undefined
    let ids: string[] = []
    if (city) {
      const jobs = await pageAll((f, t) => admin.from('jobs').select('id, area, area_landmark').ilike('city', esc(city)).order('id').range(f, t))
      const wanted = new Set(names.map(low))
      ids = jobs.filter((j) => wanted.has(low(j.area as string | null)) && !((j.area_landmark as string | null) ?? '').trim()).map((j) => j.id as string)
      if (ids.length > 0) await admin.from('jobs').update({ area_landmark: landmark }).in('id', ids)
    }
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action: 'location.landmark',
      targetType: 'location',
      targetId: String(into.id),
      detail: { value: area.name, area: into.name, landmark, city: city ?? null, tuitions: ids.length, jobIds: ids.slice(0, 200), from: 'run_review' },
    })
    await mark(admin, 'area', a.id, 'split', actor, { name: area.name, into: into.name, intoAreaId: into.id, landmark, tuitions: ids.length })
    return res(true, `${area.name} is now ${into.name} (${landmark}).`)
  }

  if (a.kind === 'alias') {
    const row = await inWindow(admin, 'location_area_aliases', a.id)
    if (!row) return res(false, 'That spelling was not saved by the 16 Oct run.')
    if (row.removed_at) return res(false, 'That spelling was already changed.')
    if (a.decision === 'keep') {
      await mark(admin, 'alias', a.id, 'keep', actor, { raw: row.raw })
      return res(true, `“${row.raw}” kept.`)
    }
    const into = await liveArea(admin, a.areaId)
    if (!into || into.city_id !== row.city_id) return res(false, 'Choose an area in the same city.')
    if (into.id === row.area_id) return res(false, 'That is already its match.')
    const before = (await admin.from('location_areas').select('name').eq('id', row.area_id as number).maybeSingle()).data?.name ?? null
    const now = new Date().toISOString()
    const { error } = await admin.from('location_area_aliases').update({ removed_at: now, removed_by: actor.id }).eq('id', a.id).is('removed_at', null)
    if (error) return res(false, 'That did not save. Please try again.')
    const { error: ie } = await admin
      .from('location_area_aliases')
      .insert({ city_id: row.city_id, raw: row.raw, area_id: into.id, created_by: actor.id, created_by_email: actor.email })
    if (ie) {
      // Put the old match back rather than leave the spelling with none.
      await admin.from('location_area_aliases').update({ removed_at: null, removed_by: null }).eq('id', a.id)
      return res(false, 'That did not save. Please try again.')
    }
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action: 'location.alias',
      targetType: 'location',
      targetId: String(into.id),
      detail: { value: row.raw, before, after: into.name, from: 'run_review', replacedAliasId: a.id },
    })
    await mark(admin, 'alias', a.id, 'rematch', actor, { raw: row.raw, before, after: into.name })
    return res(true, `“${row.raw}” now counts as ${into.name}.`)
  }

  // ignored
  const row = await inWindow(admin, 'location_ignored', a.id)
  if (!row) return res(false, 'That value was not marked by the 16 Oct run.')
  if (row.removed_at) return res(false, 'That value was already changed.')
  if (a.decision === 'keep') {
    await mark(admin, 'ignored', a.id, 'keep', actor, { raw: row.raw })
    return res(true, `“${row.raw}” stays not an area.`)
  }
  const city = String(row.city ?? '')
  const { data: cityRow } = await admin.from('location_cities').select('id, name').ilike('name', esc(city)).maybeSingle()
  if (!cityRow) return res(false, `“${city || 'No city'}” is not a city in the list, so an area cannot be saved under it.`)
  let target: { id: number; name: string } | null = null
  if (a.decision === 'same_as') {
    const into = await liveArea(admin, a.areaId)
    if (!into || into.city_id !== cityRow.id) return res(false, 'Choose an area in the same city.')
    target = into
  } else {
    const name = cleanAreaName(a.name).slice(0, 80)
    const { data: same } = await admin.from('location_areas').select('id, name').eq('city_id', cityRow.id).ilike('name', esc(name)).is('removed_at', null).maybeSingle()
    if (same) target = { id: same.id as number, name: same.name as string }
    else {
      const { data: made, error } = await admin.from('location_areas').insert({ city_id: cityRow.id, name }).select('id, name').maybeSingle()
      if (error || !made) return res(false, 'That did not save. Please try again.')
      target = { id: made.id as number, name: made.name as string }
      await logAdminAction({
        actorId: actor.id,
        actorRole: actor.adminRole,
        actorEmail: actor.email,
        action: 'location.area_add',
        targetType: 'location',
        targetId: String(target.id),
        detail: { city: cityRow.name, before: null, after: target.name, from: row.raw, via: 'run_review' },
      })
    }
  }
  const now = new Date().toISOString()
  await admin.from('location_ignored').update({ removed_at: now, removed_by: actor.id }).eq('id', a.id).is('removed_at', null)
  if (low(row.raw as string) !== low(target.name)) {
    const { error } = await admin
      .from('location_area_aliases')
      .insert({ city_id: cityRow.id, raw: row.raw, area_id: target.id, created_by: actor.id, created_by_email: actor.email })
    if (error && error.code !== '23505') {
      await admin.from('location_ignored').update({ removed_at: null, removed_by: null }).eq('id', a.id)
      return res(false, 'That did not save. Please try again.')
    }
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action: 'location.alias',
      targetType: 'location',
      targetId: String(target.id),
      detail: { value: row.raw, city: cityRow.name, before: 'Not an area', after: target.name, from: 'run_review' },
    })
  }
  await mark(admin, 'ignored', a.id, a.decision, actor, { raw: row.raw, area: target.name })
  return res(true, `“${row.raw}” now counts as ${target.name}.`)
}

/** Apply a batch (at most RUN_BATCH_MAX, checked by the route). A refused row
 *  never stops the rest. */
export async function applyRunActions(actions: RunAction[], actor: Actor): Promise<RunResult[]> {
  const admin = createAdminClient()
  if (!admin) return actions.map((a) => ({ kind: a.kind, id: a.id, ok: false, message: 'This is not working right now. Please try again in a few minutes.' }))
  const out: RunResult[] = []
  for (const a of actions) {
    try {
      out.push(await applyOne(admin, a, actor))
    } catch (e) {
      console.error('[location-run-review]', e instanceof Error ? e.message : e)
      out.push({ kind: a.kind, id: a.id, ok: false, message: 'That did not save. Please try again.' })
    }
  }
  revalidateTag(AREA_ALIAS_TAG, 'max')
  revalidateLanding()
  return out
}
