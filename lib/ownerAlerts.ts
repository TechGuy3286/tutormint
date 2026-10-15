import 'server-only'

// lib/ownerAlerts.ts
//
// Tells the Owner when anyone else changes something only the Owner used to
// change (owner, 13 Oct 2026): bank transfer details, payment gateway settings,
// plan prices, team roles. One email (Resend) and one in-app notification, with
// who, what, before → after and the time in Pakistan time. Account numbers are
// masked to their last 4 digits by the caller (lib/ownerAlertCore).
//
// Best-effort: a failed alert never fails the change it reports — the change is
// already in the Audit log.

import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications'
import { deliverEmail } from '@/lib/notify'
import { OWNER_ONLY_OWNERSHIP, OWNER_PROTECTED, ROLE_LABEL, type AdminRole } from '@/lib/adminAccessCore'
import {
  alertBody,
  blockedAttemptBody,
  changeLines,
  isOwnerProtectionRefusal,
  pakistanTime,
  shouldAlertOwner,
  type AlertChange,
} from '@/lib/ownerAlertCore'

/**
 * A non-Owner tried something Owner protection refused (owner, 15 Oct 2026).
 * Bell notification + email to the Owner with who, what and when (Pakistan
 * time), and an Audit row. Best-effort, like alertOwner: the refusal itself
 * has already happened and never depends on this.
 */
export async function alertOwnerBlocked(params: {
  actor: { id: string; adminRole: AdminRole; email: string | null }
  /** The refusal text; only an Owner-protection refusal raises the alert. */
  problem: string | null
  /** What they tried, in words: "pause the Owner account". */
  what: string
  targetId?: string | null
  when?: Date
}): Promise<void> {
  try {
    if (!isOwnerProtectionRefusal(params.problem, OWNER_PROTECTED, OWNER_ONLY_OWNERSHIP)) return
    if (!shouldAlertOwner(params.actor.adminRole)) return
    const admin = createAdminClient()
    if (!admin) return
    const when = params.when ?? new Date()
    const [{ data: owners }, { data: me }] = await Promise.all([
      admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner'),
      admin.from('profiles').select('full_name').eq('id', params.actor.id).maybeSingle(),
    ])
    const name = ((me?.full_name as string | null) ?? '').trim() || params.actor.email || 'A staff member'
    const who = `${name} (${ROLE_LABEL[params.actor.adminRole] ?? params.actor.adminRole})`

    await admin.from('admin_audit_log').insert({
      actor_id: params.actor.id,
      actor_email: params.actor.email,
      actor_role: params.actor.adminRole,
      action: 'owner.protection_blocked',
      target_type: 'member',
      target_id: params.targetId ?? null,
      detail: { what: params.what, refusal: params.problem },
    })

    for (const o of owners ?? []) {
      const ownerId = o.id as string
      if (ownerId === params.actor.id) continue
      await notify({
        userId: ownerId,
        kind: 'owner_alert',
        title: 'Blocked attempt on the Owner account',
        body: blockedAttemptBody(who, params.what, when),
        href: '/admin/audit',
      })
      await deliverEmail(
        { userId: ownerId },
        {
          id: 'owner_alert',
          area: 'Owner account protection',
          who,
          lines: [`Tried to: ${params.what}.`, 'Owner protection refused it — nothing changed.'],
          when: pakistanTime(when),
          href: '/admin/audit',
        },
      ).catch(() => {})
    }
  } catch (e) {
    console.error('[ownerAlert] blocked-attempt alert failed', e instanceof Error ? e.message : e)
  }
}

export type OwnerAlertArea ='Bank transfer details' | 'Payment gateway settings' | 'Plan prices' | 'Team roles'

export async function alertOwner(params: {
  actor: { id: string; adminRole: AdminRole; email: string | null }
  area: OwnerAlertArea
  changes: AlertChange[]
  /** Where the Owner can look at it. */
  href: string
  when?: Date
}): Promise<void> {
  try {
    if (!shouldAlertOwner(params.actor.adminRole) || params.changes.length === 0) return
    const admin = createAdminClient()
    if (!admin) return

    const [{ data: owners }, { data: me }] = await Promise.all([
      admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner'),
      admin.from('profiles').select('full_name').eq('id', params.actor.id).maybeSingle(),
    ])
    const when = params.when ?? new Date()
    const name = ((me?.full_name as string | null) ?? '').trim() || params.actor.email || 'A staff member'
    const who = `${name} (${ROLE_LABEL[params.actor.adminRole] ?? params.actor.adminRole})`

    for (const o of owners ?? []) {
      const ownerId = o.id as string
      if (ownerId === params.actor.id) continue
      await notify({
        userId: ownerId,
        kind: 'owner_alert',
        title: `${params.area} changed`,
        body: alertBody(who, params.changes, when),
        href: params.href,
      })
      await deliverEmail(
        { userId: ownerId },
        { id: 'owner_alert', area: params.area, who, lines: changeLines(params.changes), when: pakistanTime(when), href: params.href },
      ).catch(() => {})
    }
  } catch (e) {
    console.error('[ownerAlert] failed', params.area, e instanceof Error ? e.message : e)
  }
}
