// lib/staffHandover.ts
//
// When a staff member is paused or removed (owner, 11 Nov 2026), nothing they
// were looking after is dropped: the cities they own in City owners go back to
// "no owner" (= the site Owner, lib/cityOwnersCore) and every tuition they own
// in tuition_owners moves to the site Owner, so its Applications follow-ups
// land on the Owner's list. Supersedes "their tuitions move to each city's
// owner" (24 Oct) — the Owner handles everything himself.
//
// Every move writes admin_audit_log (city_owner.set / job.owner_assign, with
// the reason). Service role. Never logs a phone, CNIC or email.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { logAdminAction } from '@/lib/auditLog'
import { formatName } from '@/lib/formatName'
import type { AdminActor } from '@/lib/adminAuth'
import type { PauseHandover } from '@/lib/staffPauseCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

export async function siteOwnerId(admin: Admin): Promise<string | null> {
  const { data } = await admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner').limit(1).maybeSingle()
  return (data?.id as string | undefined) ?? null
}

export async function actorDisplayName(admin: Admin, id: string): Promise<string> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()
  return formatName((data?.full_name as string | null) ?? '') || 'Owner'
}

/** Move one staff member's cities and tuitions to the site Owner, stamped
 *  `at`. Returns what moved (with each tuition's earlier source). */
export async function handOverToOwner(
  admin: Admin,
  actor: AdminActor,
  userId: string,
  at: string,
  reason: 'former staff' | 'staff paused',
): Promise<PauseHandover | null> {
  const ownerId = await siteOwnerId(admin)
  if (!ownerId) return null
  const actorName = await actorDisplayName(admin, actor.id)

  const { data: owned } = await admin.from('city_owners').select('city').eq('staff_id', userId)
  const cities = (owned ?? []).map((c) => c.city as string)
  if (cities.length) {
    await admin.from('city_owners').update({ staff_id: null, updated_by: actor.id, updated_by_name: actorName, updated_at: at }).eq('staff_id', userId)
    for (const city of cities) {
      await logAdminAction({ actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email, action: 'city_owner.set', targetType: 'city', targetId: city, detail: { from: userId, to: null, reason } })
    }
  }

  const rows = await pageAll<{ job_id: string; source: string | null }>((f, t) =>
    admin.from('tuition_owners').select('job_id, source').eq('staff_id', userId).order('job_id').range(f, t),
  )
  const jobs: PauseHandover['jobs'] = []
  for (const part of chunk(rows, 200)) {
    const ids = part.map((r) => r.job_id)
    const { error } = await admin
      .from('tuition_owners')
      .update({ staff_id: ownerId, source: 'reassigned', assigned_by: actor.id, assigned_by_name: actorName, assigned_at: at })
      .in('job_id', ids)
      .eq('staff_id', userId)
    if (error) continue
    for (const r of part) jobs.push({ jobId: r.job_id, source: r.source ?? null })
  }
  if (jobs.length) {
    const cityOf = new Map<string, string | null>()
    const jrows = await pageAllIn(jobs.map((j) => j.jobId), (part, f, t) => admin.from('jobs').select('id, city').in('id', part).order('id').range(f, t))
    for (const j of jrows) cityOf.set(j.id as string, (j.city as string | null) ?? null)
    for (const part of chunk(jobs, 200)) {
      await admin.from('admin_audit_log').insert(
        part.map((m) => ({
          actor_id: actor.id,
          actor_role: actor.adminRole,
          actor_email: actor.email,
          action: 'job.owner_assign',
          target_type: 'job',
          target_id: m.jobId,
          detail: { from: userId, to: ownerId, city: cityOf.get(m.jobId) ?? null, reason },
        })),
      )
    }
  }
  return { at, ownerId, cities, jobs }
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}
