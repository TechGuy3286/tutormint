// lib/supervisorScope.ts
//
// The SERVER half of the Supervisor rule (owner, 24 Oct 2026; pure rule in
// lib/adminAccessCore supervisorMayChangeTuition / supervisorMayChangeCity).
// A Supervisor sees every staff member's lists but changes only:
//   • a tuition they own (tuition_owners.staff_id), and the applications on it;
//   • a tutor in a city they own (city_owners), for Follow-ups.
// Every other role is unaffected (these return null at once). Called by each
// write route after its own access check; hiding a button is never the control.

import 'server-only'

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminActor } from '@/lib/adminAuth'
import { SUPERVISOR_OWN_ONLY, supervisorMayChangeCity, supervisorMayChangeTuition } from '@/lib/adminAccessCore'
import { pageAllIn } from '@/lib/pageAll'

const refused = () => NextResponse.json({ error: SUPERVISOR_OWN_ONLY }, { status: 403 })

/** 403 unless every one of these tuitions is the Supervisor's own. */
export async function refuseSupervisorTuitions(actor: AdminActor, jobIds: (string | null | undefined)[]): Promise<NextResponse | null> {
  if (actor.adminRole !== 'supervisor') return null
  const ids = [...new Set(jobIds.filter((j): j is string => !!j))]
  if (ids.length === 0) return null
  const admin = createAdminClient()
  if (!admin) return refused()
  const rows = await pageAllIn(ids, (part, from, to) =>
    admin.from('tuition_owners').select('job_id, staff_id').in('job_id', part).order('job_id').range(from, to),
  )
  const owner = new Map(rows.map((r) => [r.job_id as string, (r.staff_id as string | null) ?? null]))
  return ids.every((id) => supervisorMayChangeTuition(actor, owner.get(id) ?? null)) ? null : refused()
}

/** 403 unless the application's tuition is the Supervisor's own. */
export async function refuseSupervisorApplication(actor: AdminActor, applicationId: string | null | undefined): Promise<NextResponse | null> {
  if (actor.adminRole !== 'supervisor' || !applicationId) return null
  const admin = createAdminClient()
  if (!admin) return refused()
  const { data } = await admin.from('applications').select('job_id').eq('id', applicationId).maybeSingle()
  return refuseSupervisorTuitions(actor, [(data?.job_id as string | null) ?? null])
}

/** The city owner of a member's city (tutor profile first, then profile). */
async function cityOwnerOf(memberId: string): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const [{ data: tp }, { data: p }] = await Promise.all([
    admin.from('tutor_profiles').select('city').eq('id', memberId).maybeSingle(),
    admin.from('profiles').select('city').eq('id', memberId).maybeSingle(),
  ])
  const city = ((tp?.city as string | null) || (p?.city as string | null) || '').trim().toLowerCase()
  if (!city) return null
  const { data: owners } = await admin.from('city_owners').select('city, staff_id')
  const row = (owners ?? []).find((o) => ((o.city as string) ?? '').trim().toLowerCase() === city)
  return (row?.staff_id as string | null) ?? null
}

/** 403 unless the member lives in a city the Supervisor owns. */
export async function refuseSupervisorMember(actor: AdminActor, memberId: string | null | undefined): Promise<NextResponse | null> {
  if (actor.adminRole !== 'supervisor' || !memberId) return null
  return supervisorMayChangeCity(actor, await cityOwnerOf(memberId)) ? null : refused()
}
