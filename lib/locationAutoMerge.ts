import 'server-only'

// lib/locationAutoMerge.ts — the automatic merges of the Locations clean-up
// (owner, 28 Oct 2026) and their Undo.
//
// scripts/dataop-locations-cleanup.ts --apply writes one admin_audit_log row
// per merge (action location.auto_merge) whose detail is the AutoMergeRecord:
// everything needed to put it back. Undo (OWNER ONLY — the route) follows
// lib/locationBucketsCore undoPlan: the spelling row is taken back (stamped
// removed_at, never deleted), moved spellings go back to the added area, and a
// retired added area is restored. An Undo is its own Audit row
// (location.auto_merge_undo, target = the merge's Audit id), so a merge is
// undone once.

import { revalidateTag } from 'next/cache'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { revalidateLanding } from '@/lib/landingRevalidate'
import { AREA_ALIAS_TAG } from '@/lib/areaAliases'
import { undoPlan, type AutoMergeRecord } from '@/lib/locationBucketsCore'
import type { AdminRole } from '@/lib/adminAccessCore'

export const AUTO_MERGE_ACTION = 'location.auto_merge'
export const AUTO_MERGE_UNDO_ACTION = 'location.auto_merge_undo'

export type AutoMergeItem = {
  auditId: string
  at: string
  record: AutoMergeRecord
  undoneAt: string | null
}

type Actor = { id: string; adminRole: AdminRole; email?: string | null }

/** Every automatic merge, newest first, with whether it was undone. Reads only. */
export async function loadAutoMerges(): Promise<AutoMergeItem[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const [{ data: merges }, { data: undos }] = await Promise.all([
    admin.from('admin_audit_log').select('id, created_at, detail').eq('action', AUTO_MERGE_ACTION).order('created_at', { ascending: false }).limit(1000),
    admin.from('admin_audit_log').select('target_id, created_at').eq('action', AUTO_MERGE_UNDO_ACTION).limit(1000),
  ])
  const undone = new Map((undos ?? []).map((u) => [u.target_id as string, u.created_at as string]))
  return (merges ?? []).map((m) => ({
    auditId: m.id as string,
    at: m.created_at as string,
    record: m.detail as AutoMergeRecord,
    undoneAt: undone.get(m.id as string) ?? null,
  }))
}

/** Undo one automatic merge, exactly. OWNER ONLY (checked by the route). */
export async function undoAutoMerge(auditId: string, actor: Actor): Promise<{ ok: true; line: string } | { ok: false; status: 400 | 409 | 503; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: row } = await admin.from('admin_audit_log').select('id, action, detail').eq('id', auditId).maybeSingle()
  if (!row || row.action !== AUTO_MERGE_ACTION) return { ok: false, status: 400, error: 'That automatic merge was not found. Reload the page.' }
  const { data: done } = await admin.from('admin_audit_log').select('id').eq('action', AUTO_MERGE_UNDO_ACTION).eq('target_id', auditId).limit(1)
  if ((done ?? []).length > 0) return { ok: false, status: 409, error: 'This merge was already undone.' }
  const rec = row.detail as AutoMergeRecord

  // The spelling row must still be live — if someone took it back or changed
  // it since, an Undo would not put back what the merge changed.
  const { data: alias } = await admin.from('location_area_aliases').select('id, area_id, removed_at').eq('id', rec.aliasId).maybeSingle()
  if (!alias || alias.removed_at || (alias.area_id as number) !== rec.intoAreaId) {
    return { ok: false, status: 409, error: 'Can’t undo — this spelling has been changed since. Fix it on Locations instead.' }
  }

  const now = new Date().toISOString()
  for (const step of undoPlan(rec)) {
    if (step.op === 'take_back_alias') {
      const { error } = await admin.from('location_area_aliases').update({ removed_at: now, removed_by: actor.id }).eq('id', step.aliasId).is('removed_at', null)
      if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
    } else if (step.op === 'move_aliases') {
      // Only the rows the merge moved, and only while they still point where it put them.
      await admin.from('location_area_aliases').update({ area_id: step.toAreaId }).in('id', step.aliasIds).eq('area_id', rec.intoAreaId).is('removed_at', null)
    } else {
      await admin.from('location_areas').update({ removed_at: null, removed_by: null }).eq('id', step.areaId)
    }
  }

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: AUTO_MERGE_UNDO_ACTION,
    targetType: 'audit',
    targetId: auditId,
    detail: { city: rec.city, value: rec.value, before: rec.intoName, after: rec.kind === 'staff_area' ? `Area added by staff (${rec.value}) restored` : 'Free text', kind: rec.kind },
  })
  revalidateTag(AREA_ALIAS_TAG, 'max')
  revalidateLanding()
  return { ok: true, line: `“${rec.value}” no longer counts as ${rec.intoName}.` }
}
