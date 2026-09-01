// lib/auditLog.ts
//
// Every admin mutation writes a row here: verification decisions, plan
// grants/revokes, payment approvals, suspensions, staff changes, ad CRUD,
// imports.
//
// Written through the service-role client. admin_audit_log has a SELECT policy
// only -- no INSERT/UPDATE/DELETE policy exists -- so nothing holding the anon
// key can add, alter or remove an entry. The trail is append-only by
// construction, not by convention.

import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminRole } from '@/lib/adminAuth'

export type AuditAction =
  | 'tutor.approve'
  | 'tutor.hold'
  | 'tutor.suspend'
  | 'tutor.unsuspend'
  | 'parent.verify.approve'
  | 'parent.verify.reject'
  | 'plan.grant'
  | 'plan.revoke'
  | 'payment.approve'
  | 'payment.reject'
  | 'settings.update'
  | 'staff.create'
  | 'staff.role_change'
  | 'staff.suspend'
  | 'staff.reactivate'
  | 'member.warn'
  | 'member.suspend'
  | 'member.unsuspend'
  | 'report.dismiss'
  | 'report.action'
  | 'video.visibility'

export async function logAdminAction(params: {
  actorId: string
  actorRole: AdminRole
  /** Recorded so the entry still says who acted after the account is deleted. */
  actorEmail?: string | null
  action: AuditAction | string
  targetType: string
  targetId: string
  detail?: Record<string, unknown>
}): Promise<void> {
  const admin = createAdminClient()
  if (!admin) {
    // Never silently lose an audit entry: if it cannot be written, say so.
    console.error('[audit] service-role client unavailable; entry NOT recorded', params.action)
    return
  }

  const { error } = await admin.from('admin_audit_log').insert({
    actor_id: params.actorId,
    actor_role: params.actorRole,
    actor_email: params.actorEmail ?? null,
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId,
    detail: params.detail ?? {},
  })

  if (error) console.error('[audit] failed to record', params.action, error.message)
}
