import 'server-only'

// lib/staffAlerts.ts — staff and admin alerts go to the in-app bell (owner,
// 27 Oct 2026). Every active staff member whose role opens the screen the alert
// is about gets a bell notification (the Owner always). Email is decided by
// Notification settings (lib/email/policyCore): off for staff alerts, except
// "Bank transfer waiting for approval", which is emailed to the OWNER ACCOUNT's
// own address only. The address is read from the Owner's profile, never
// written in code, and never logged.

import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notifications'
import { roleSatisfies, type AdminRole } from '@/lib/adminAccessCore'

/** Who gets the bell: active staff whose role passes `roles` (the screen's
 *  access list). Pure, so the test reads exactly this. */
export function staffRecipients(
  staff: { id: string; admin_role: string | null; is_suspended?: boolean | null; is_banned?: boolean | null }[],
  roles: readonly AdminRole[],
): string[] {
  return staff
    .filter((s) => !!s.admin_role && !s.is_suspended && !s.is_banned)
    .filter((s) => roleSatisfies(s.admin_role as AdminRole, roles as AdminRole[]))
    .map((s) => s.id)
}

export async function bellStaff(roles: readonly AdminRole[], n: { title: string; body?: string | null; href?: string | null }): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const { data } = await admin.from('profiles').select('id, admin_role, is_suspended, is_banned').eq('role', 'admin').not('admin_role', 'is', null)
  const ids = staffRecipients((data ?? []) as { id: string; admin_role: string | null; is_suspended: boolean | null; is_banned: boolean | null }[], roles)
  for (const id of ids) await notify({ userId: id, kind: 'staff_alert', title: n.title, body: n.body ?? null, href: n.href ?? null })
  return ids.length
}

/** The Owner account's own address (the first Owner by sign-up), or null. */
export async function ownerEmail(): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.from('profiles').select('email').eq('role', 'admin').eq('admin_role', 'owner').order('created_at', { ascending: true }).limit(1).maybeSingle()
  const e = ((data?.email as string | null) ?? '').trim()
  return e || null
}
