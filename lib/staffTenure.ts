// lib/staffTenure.ts — server only (owner, 2 Nov 2026, Part G). Loads the
// joining record of each staff account (staff_tenure, else the audit log) and
// writes one when a staff member is added or the Owner sets a date.
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatName } from '@/lib/formatName'
import type { TenureAudit, TenureStored } from '@/lib/staffTenureCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

export async function loadTenureFacts(
  admin: Admin,
  ids: string[],
): Promise<{ stored: Map<string, TenureStored>; audit: Map<string, TenureAudit[]> }> {
  const stored = new Map<string, TenureStored>()
  const audit = new Map<string, TenureAudit[]>()
  if (!ids.length) return { stored, audit }
  const [{ data: rows }, { data: logs }] = await Promise.all([
    admin.from('staff_tenure').select('staff_id, joined_at, joined_by_name, source').in('staff_id', ids),
    admin
      .from('admin_audit_log')
      .select('action, actor_id, target_id, detail, created_at')
      .in('target_id', ids)
      .in('action', ['staff.create', 'staff.grant_existing', 'staff.role_change'])
      .order('created_at')
      .limit(1000),
  ])
  for (const r of rows ?? [])
    stored.set(r.staff_id as string, { joinedAt: r.joined_at as string, joinedByName: (r.joined_by_name as string | null) ?? null, source: r.source as TenureStored['source'] })
  const actorIds = [...new Set((logs ?? []).map((l) => l.actor_id as string | null).filter((x): x is string => !!x))]
  const { data: actors } = actorIds.length ? await admin.from('profiles').select('id, full_name').in('id', actorIds) : { data: [] }
  const names = new Map((actors ?? []).map((a) => [a.id as string, formatName(a.full_name as string | null) || null]))
  for (const l of logs ?? []) {
    const k = l.target_id as string
    const list = audit.get(k) ?? []
    list.push({ action: l.action as string, createdAt: l.created_at as string, actorName: names.get(l.actor_id as string) ?? null, detail: (l.detail as Record<string, unknown> | null) ?? null })
    audit.set(k, list)
  }
  return { stored, audit }
}

/** Record when a staff member joined (first time only — an existing row wins). */
export async function recordStaffJoined(staffId: string, byId: string, source: 'staff.create' | 'staff.grant_existing'): Promise<void> {
  try {
    const admin = createAdminClient()
    if (!admin) return
    const { data: who } = await admin.from('profiles').select('full_name').eq('id', byId).maybeSingle()
    const by = { id: byId, name: formatName((who?.full_name as string | null) ?? null) || null }
    await admin
      .from('staff_tenure')
      .upsert(
        { staff_id: staffId, joined_at: new Date().toISOString(), joined_by: by.id, joined_by_name: by.name, source },
        { onConflict: 'staff_id', ignoreDuplicates: true },
      )
  } catch (e) {
    console.error('[staff-tenure] not recorded:', e instanceof Error ? e.message : 'error')
  }
}
