// lib/cityOwners.ts
//
// The server half of City owners (owner, 22 Oct 2026; rules in
// lib/cityOwnersCore). A tuition no staff member posted belongs to its city's
// owner; a city with no owner goes to the site Owner. Staff-posted tuitions
// and owners the site Owner chose by hand are never changed. Every assignment
// is in admin_audit_log (job.owner_assign, by "system: city owners").

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminActor } from '@/lib/adminAuth'
import { cityKey, cityOwnerFor, cityRuleApplies } from '@/lib/cityOwnersCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

export const CITY_RULE_ACTOR = 'system: city owners'

type OwnerRow = { job_id: string; staff_id: string | null; source: string; posted_by: string | null }

export type CityOwnerSetting = { city: string; staffId: string | null; staffName: string | null; updatedAt: string; updatedByName: string | null }

async function siteOwnerId(admin: Admin): Promise<string | null> {
  const { data } = await admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner').limit(1).maybeSingle()
  return (data?.id as string | undefined) ?? null
}

async function cityMap(admin: Admin): Promise<Map<string, string>> {
  const { data } = await admin.from('city_owners').select('city, staff_id')
  const map = new Map<string, string>()
  for (const r of data ?? []) if (r.staff_id) map.set(cityKey(r.city as string), r.staff_id as string)
  return map
}

/** The settings screen's rows, with staff names. */
export async function loadCityOwners(): Promise<CityOwnerSetting[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data } = await admin.from('city_owners').select('city, staff_id, updated_at, updated_by_name').order('city')
  const ids = [...new Set((data ?? []).map((r) => r.staff_id as string | null).filter((v): v is string => !!v))]
  const { data: people } = ids.length ? await admin.from('profiles').select('id, full_name').in('id', ids) : { data: [] }
  const nameBy = new Map((people ?? []).map((p) => [p.id as string, formatName(p.full_name as string | null) || 'Staff']))
  return (data ?? []).map((r) => ({
    city: r.city as string,
    staffId: (r.staff_id as string | null) ?? null,
    staffName: r.staff_id ? (nameBy.get(r.staff_id as string) ?? 'Former staff') : null,
    updatedAt: r.updated_at as string,
    updatedByName: (r.updated_by_name as string | null) ?? null,
  }))
}

export type CityRuleResult = { assigned: number; byStaff: Record<string, number> }

/**
 * Give every tuition the city rule applies to (optionally only `jobIds`) its
 * city's owner. One owner row upserted and one audit row per change.
 */
export async function applyCityRule(opts: { jobIds?: string[]; cities?: string[] } = {}): Promise<CityRuleResult> {
  const out: CityRuleResult = { assigned: 0, byStaff: {} }
  const admin = createAdminClient()
  if (!admin) return out
  const ownerId = await siteOwnerId(admin)
  if (!ownerId) return out
  const map = await cityMap(admin)

  const jobs = opts.jobIds
    ? await pageAllIn<{ id: string; city: string | null }, string>(opts.jobIds, (ids, from, to) =>
        admin.from('jobs').select('id, city').in('id', ids).order('id').range(from, to),
      )
    : await pageAll<{ id: string; city: string | null }>((from, to) => admin.from('jobs').select('id, city').order('id').range(from, to))
  const wanted = opts.cities ? new Set(opts.cities.map(cityKey)) : null
  const list = wanted ? jobs.filter((j) => wanted.has(cityKey(j.city))) : jobs
  if (list.length === 0) return out

  const rows = await pageAllIn<OwnerRow, string>(
    list.map((j) => j.id),
    (ids, from, to) => admin.from('tuition_owners').select('job_id, staff_id, source, posted_by').in('job_id', ids).order('job_id').range(from, to),
  )
  const rowBy = new Map(rows.map((r) => [r.job_id, r]))
  for (const j of list) {
    const row = rowBy.get(j.id)
    if (!cityRuleApplies(row ? { staffId: row.staff_id, source: row.source, postedBy: row.posted_by } : undefined)) continue
    const to = cityOwnerFor(j.city, map, ownerId)
    if (row && row.staff_id === to && row.source === 'city') continue
    const { error } = await admin
      .from('tuition_owners')
      .upsert(
        { job_id: j.id, staff_id: to, source: 'city', assigned_by: null, assigned_by_name: CITY_RULE_ACTOR, assigned_at: new Date().toISOString() },
        { onConflict: 'job_id' },
      )
    if (error) continue
    await admin.from('admin_audit_log').insert({
      actor_id: null,
      actor_role: 'owner',
      actor_email: CITY_RULE_ACTOR,
      action: 'job.owner_assign',
      target_type: 'job',
      target_id: j.id,
      detail: { from: row?.staff_id ?? null, to, city: j.city, rule: map.has(cityKey(j.city)) ? 'city owner' : 'no city owner — site Owner' },
    })
    out.assigned++
    out.byStaff[to] = (out.byStaff[to] ?? 0) + 1
  }
  return out
}

/** A newly posted parent tuition gets its city's owner. Tolerant. */
export async function assignNewTuitionOwner(jobId: string): Promise<void> {
  try {
    await applyCityRule({ jobIds: [jobId] })
  } catch {
    /* the tuition is posted; the owner can be set later */
  }
}

export type SetCityOwnerResult = { ok: true; reassigned: number } | { ok: false; status: 400 | 403 | 503; error: string }

/**
 * Set (or clear, with staffId null) one city's owner. Only the site Owner —
 * the route checks too. The row is kept when cleared. Tuitions the city rule
 * already gave that city are re-pointed to the new owner (or the site Owner).
 */
export async function setCityOwner(args: { actor: AdminActor; city: string; staffId: string | null }): Promise<SetCityOwnerResult> {
  if (args.actor.adminRole !== 'owner') return { ok: false, status: 403, error: 'Only the Owner can change city owners.' }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const city = args.city.replace(/\s+/g, ' ').trim()
  if (!city || city.length > 80) return { ok: false, status: 400, error: 'Choose a city.' }
  const { data: known } = await admin.from('location_cities').select('name').ilike('name', city).limit(1).maybeSingle()
  if (!known) return { ok: false, status: 400, error: 'Choose a city from the list.' }
  const name = known.name as string
  if (args.staffId) {
    const { data: s } = await admin.from('profiles').select('id, role, admin_role, is_suspended').eq('id', args.staffId).maybeSingle()
    if (!s || s.role !== 'admin' || !s.admin_role || s.is_suspended) return { ok: false, status: 400, error: 'Choose a staff member from the list.' }
  }
  const { data: before } = await admin.from('city_owners').select('staff_id').eq('city', name).maybeSingle()
  const { data: me } = await admin.from('profiles').select('full_name').eq('id', args.actor.id).maybeSingle()
  const { error } = await admin.from('city_owners').upsert(
    { city: name, staff_id: args.staffId, updated_by: args.actor.id, updated_by_name: formatName(me?.full_name as string | null) || null, updated_at: new Date().toISOString() },
    { onConflict: 'city' },
  )
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: args.actor.id,
    actorRole: args.actor.adminRole,
    actorEmail: args.actor.email,
    action: 'city_owner.set',
    targetType: 'city',
    targetId: name,
    detail: { from: (before?.staff_id as string | null) ?? null, to: args.staffId },
  })
  const res = await applyCityRule({ cities: [name] })
  return { ok: true, reassigned: res.assigned }
}
