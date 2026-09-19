import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { tallyStaffActivity, emptyStaffCounts, STAFF_METRIC_ACTIONS, type StaffCounts } from '@/lib/staffActivityCore'

// Staff activity, read from admin_audit_log BY ACTOR (PR29 §2.2).
//
// The point of reading by actor: a team tuition is posted on the TutorMint team
// account, so counting jobs by their owner shows the team account 26 posts and
// every staff member zero. The audit log records who ACTED, so grouping by
// actor_id surfaces the real work — Aqsa's 26 job.post rows are hers, though the
// tuitions belong to the team account.
//
// The tally is pure (lib/staffActivityCore), so the windows are unit-testable;
// this file is the I/O around it. Bounded to the metric actions, so it reads a
// small slice of the log, not the whole thing.

export type StaffActivityRow = {
  id: string
  name: string
  email: string | null
  adminRole: string | null
  counts: StaffCounts
}

/** Every staff member with their counts, for the /admin/staff-activity list. */
export async function loadStaffActivity(): Promise<StaffActivityRow[]> {
  const admin = createAdminClient()
  if (!admin) return []

  const { data: staff } = await admin
    .from('profiles')
    .select('id, full_name, email, admin_role')
    .eq('role', 'admin')
    .order('full_name', { ascending: true })
  const rows = staff ?? []
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id as string)
  const { data: audit } = await admin
    .from('admin_audit_log')
    .select('actor_id, action, created_at')
    .in('actor_id', ids)
    .in('action', STAFF_METRIC_ACTIONS)

  const counts = tallyStaffActivity(
    (audit ?? []).map((a) => ({
      actorId: a.actor_id as string | null,
      action: a.action as string,
      createdAt: a.created_at as string,
    })),
  )

  return rows.map((r) => ({
    id: r.id as string,
    name: (r.full_name as string | null) ?? '—',
    email: (r.email as string | null) ?? null,
    adminRole: (r.admin_role as string | null) ?? null,
    counts: counts.get(r.id as string) ?? emptyStaffCounts(),
  }))
}

/** One staff member's counts, for the staff-activity card on their member page. */
export async function loadStaffCountsFor(actorId: string): Promise<StaffCounts> {
  const admin = createAdminClient()
  if (!admin) return emptyStaffCounts()
  const { data: audit } = await admin
    .from('admin_audit_log')
    .select('actor_id, action, created_at')
    .eq('actor_id', actorId)
    .in('action', STAFF_METRIC_ACTIONS)
  const counts = tallyStaffActivity(
    (audit ?? []).map((a) => ({
      actorId: a.actor_id as string | null,
      action: a.action as string,
      createdAt: a.created_at as string,
    })),
  )
  return counts.get(actorId) ?? emptyStaffCounts()
}
