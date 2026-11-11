// lib/followUpDismissals.ts
//
// "Not interested" on Follow-ups (owner, 21 Oct 2026; migration 191). Every
// unfinished sign-up stays on Follow-ups until they finish — or until staff
// mark them "Not interested", which moves them to a hidden group. Undo stamps
// undone_at; nothing is deleted. Who and when are on the row and in
// admin_audit_log (member.not_interested / member.not_interested_undo), which
// the member page's timeline reads.
//
// Service role. Callers (POST /api/admin/follow-ups/not-interested) check the
// list's own SCREEN_ACCESS first.

import 'server-only'

import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { logAdminAction } from '@/lib/auditLog'
import { formatName } from '@/lib/formatName'
import type { AdminRole } from '@/lib/adminAuth'
import { isNiReason, niMarkProblem, niReturns, NI_RETURNED_BY, type NiMark, type NiReason, type NiReturnEvent } from '@/lib/notInterestedCore'

export type NotInterestedMark = { id: string; at: string; by: string | null; note: string | null; reason: NiReason | null }

type Actor = { id: string; adminRole: AdminRole; email?: string | null }

/** Every live "Not interested" mark, by member. One read per request. */
export const loadNotInterested = cache(async (): Promise<Map<string, NotInterestedMark>> => {
  const out = new Map<string, NotInterestedMark>()
  const admin = createAdminClient()
  if (!admin) return out
  const rows = await pageAll((from, to) =>
    admin
      .from('follow_up_dismissals')
      .select('id, member_id, staff_name, note, created_at, quick_reason')
      .is('undone_at', null)
      .order('id')
      .range(from, to),
  ).catch(() => [])
  for (const r of rows)
    out.set(r.member_id as string, {
      id: r.id as string,
      at: r.created_at as string,
      by: formatName((r.staff_name as string | null) ?? null) || null,
      note: (r.note as string | null) ?? null,
      reason: isNiReason(r.quick_reason) ? (r.quick_reason as NiReason) : null,
    })
  return out
})

async function staffName(admin: NonNullable<ReturnType<typeof createAdminClient>>, id: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()
  return (data?.full_name as string | null) ?? null
}

/** Mark a member "Not interested". A member already marked stays as they are. */
export async function markNotInterested(
  memberId: string,
  reason: unknown,
  note: string | null,
  actor: Actor,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  // A reason is required (owner, 11 Nov 2026).
  const problem = niMarkProblem(reason, note)
  if (problem) return { ok: false, status: 400, error: problem }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: member } = await admin.from('profiles').select('id, role').eq('id', memberId).maybeSingle()
  if (!member || member.role === 'admin') return { ok: false, status: 404, error: 'That member was not found.' }
  const clean = (note ?? '').trim().slice(0, 500) || null
  const { error } = await admin.from('follow_up_dismissals').insert({
    member_id: memberId,
    note: clean,
    quick_reason: reason as NiReason,
    staff_id: actor.id,
    staff_name: await staffName(admin, actor.id),
  })
  // 23505 = already marked (the one-live-mark index) — nothing to do.
  if (error && error.code !== '23505') return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  if (!error)
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email ?? null,
      action: 'member.not_interested',
      targetType: 'profile',
      targetId: memberId,
      detail: { role: member.role, reason, hasNote: !!clean },
    })
  return { ok: true }
}

/** Undo: the mark stays on record, stamped undone, and the member is back on
 *  Follow-ups. */
export async function undoNotInterested(memberId: string, actor: Actor): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: rows, error } = await admin
    .from('follow_up_dismissals')
    .update({ undone_at: new Date().toISOString(), undone_by: actor.id, undone_by_name: await staffName(admin, actor.id) })
    .eq('member_id', memberId)
    .is('undone_at', null)
    .select('id')
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  if ((rows ?? []).length > 0)
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email ?? null,
      action: 'member.not_interested_undo',
      targetType: 'profile',
      targetId: memberId,
      detail: {},
    })
  return { ok: true }
}

/**
 * A marked member who uploads a document or pays comes back on their own
 * (owner, 11 Nov 2026): the live mark is stamped undone ("Returned on their
 * own"), their People card returns to its stage, and the mark stays in their
 * history. Never throws — it must not fail the upload or payment.
 */
export async function returnFromNotInterested(memberId: string, event: NiReturnEvent): Promise<boolean> {
  try {
    const admin = createAdminClient()
    if (!admin) return false
    const { data: live } = await admin.from('follow_up_dismissals').select('id, created_at').eq('member_id', memberId).is('undone_at', null).maybeSingle()
    const now = new Date().toISOString()
    if (!live || !niReturns({ at: live.created_at as string }, event, now)) return false
    const { data: done } = await admin
      .from('follow_up_dismissals')
      .update({ undone_at: now, undone_by: null, undone_by_name: NI_RETURNED_BY })
      .eq('id', live.id as string)
      .is('undone_at', null)
      .select('id')
    if (!done?.length) return false
    await admin.from('admin_audit_log').insert({
      actor_id: memberId,
      actor_role: 'member',
      actor_email: null,
      action: 'member.not_interested_return',
      target_type: 'profile',
      target_id: memberId,
      detail: { event },
    })
    const { data: p } = await admin.from('profiles').select('role').eq('id', memberId).maybeSingle()
    if (p?.role === 'tutor') {
      const { setPipelineNotInterested } = await import('@/lib/tutorPipeline')
      await setPipelineNotInterested(memberId, false)
    }
    const { markSummaryDirty } = await import('@/lib/summaryDirty')
    await markSummaryDirty()
    return true
  } catch {
    return false
  }
}

/** One member's live mark, for the card at once after marking. */
export async function liveMark(memberId: string): Promise<NiMark | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('follow_up_dismissals')
    .select('staff_name, note, created_at, quick_reason')
    .eq('member_id', memberId)
    .is('undone_at', null)
    .maybeSingle()
  if (!data) return null
  return {
    at: data.created_at as string,
    by: formatName((data.staff_name as string | null) ?? null) || null,
    note: (data.note as string | null) ?? null,
    reason: isNiReason(data.quick_reason) ? (data.quick_reason as NiReason) : null,
  }
}
