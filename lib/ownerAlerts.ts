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
import { ROLE_LABEL, type AdminRole } from '@/lib/adminAccessCore'
import { alertBody, changeLines, pakistanTime, shouldAlertOwner, type AlertChange } from '@/lib/ownerAlertCore'

export type OwnerAlertArea = 'Bank transfer details' | 'Payment gateway settings' | 'Plan prices' | 'Team roles'

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
