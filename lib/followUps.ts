import 'server-only'

// lib/followUps.ts — the shared follow-up record (owner, 9 Oct 2026). The I/O
// around lib/followUpCore: load each member's follow-up state for a list,
// record one (WhatsApp click, "Mark as followed up"), undo one. Every write is
// audited (admin_audit_log) and goes on the member's timeline. Nothing is
// deleted — Undo stamps undone_at.

import { pageAllIn } from '@/lib/pageAll'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminRole } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { absoluteUrl } from '@/lib/siteUrl'
import {
  STUCK_TEMPLATE_KEY,
  followUpState,
  type FollowUpChannel,
  type FollowUpRecord,
  type FollowUpSource,
  type FollowUpState,
} from '@/lib/followUpCore'

type Actor = { id: string; adminRole: AdminRole; email: string | null }

/** Where a stuck tutor continues: onboarding (the proxy sends a signed-out
 *  visitor to /login?next=/tutor/onboarding first). */
export function continueLink(): string {
  return absoluteUrl('/tutor/onboarding')
}

/** Each member's follow-up state (undone rows ignored). */
export async function loadFollowUpStates(memberIds: string[], now = new Date()): Promise<Map<string, FollowUpState>> {
  const out = new Map<string, FollowUpState>()
  const admin = createAdminClient()
  const ids = [...new Set(memberIds.filter(Boolean))]
  if (!admin || ids.length === 0) return out
  const rows = (await pageAllIn(ids, (part, from, to) =>
    admin
      .from('member_follow_ups')
      .select('id, member_id, channel, template_key, created_at, staff_name, staff_email, undone_at')
      .in('member_id', part)
      .is('undone_at', null)
      .order('id')
      .range(from, to),
  )) as FollowUpRecord[]
  const by = new Map<string, FollowUpRecord[]>()
  for (const r of rows) by.set(r.member_id, [...(by.get(r.member_id) ?? []), r])
  for (const id of ids) out.set(id, followUpState(by.get(id) ?? [], now.getTime()))
  return out
}

/** The stuck-in-onboarding template body, as stored (null when missing). */
export async function loadStuckTemplate(): Promise<{ key: string; body: string } | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.from('admin_message_templates').select('key, body').eq('key', STUCK_TEMPLATE_KEY).maybeSingle()
  return data?.body ? { key: data.key as string, body: data.body as string } : null
}

export async function recordFollowUp(params: {
  memberId: string
  channel: FollowUpChannel
  templateKey: string | null
  source: FollowUpSource
  actor: Actor
}): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const { memberId, channel, templateKey, source, actor } = params
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: member } = await admin.auth.admin.getUserById(memberId).catch(() => ({ data: null }))
  if (!member?.user) return { ok: false, status: 404, error: 'That member was not found.' }
  const { data: me } = await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle()
  const { data, error } = await admin
    .from('member_follow_ups')
    .insert({
      member_id: memberId,
      channel,
      template_key: templateKey,
      source,
      staff_id: actor.id,
      staff_email: actor.email,
      staff_name: (me?.full_name as string | null) ?? null,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'member.follow_up',
    targetType: 'profile',
    targetId: memberId,
    detail: { followUpId: data.id, channel, templateKey, source },
  })
  await logActivity({
    userId: memberId,
    event: 'follow_up_sent',
    targetType: 'profile',
    targetId: memberId,
    meta: { channel, templateKey, source },
  })
  return { ok: true, id: data.id as string }
}

/** Undo: the record stays, stamped undone, and stops counting. */
export async function undoFollowUp(id: string, actor: Actor): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: row } = await admin.from('member_follow_ups').select('id, member_id, undone_at').eq('id', id).maybeSingle()
  if (!row) return { ok: false, status: 404, error: 'That follow-up was not found.' }
  if (row.undone_at) return { ok: true }
  const { error } = await admin
    .from('member_follow_ups')
    .update({ undone_at: new Date().toISOString(), undone_by: actor.id })
    .eq('id', id)
    .is('undone_at', null)
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'member.follow_up_undo',
    targetType: 'profile',
    targetId: row.member_id as string,
    detail: { followUpId: id },
  })
  await logActivity({ userId: row.member_id as string, event: 'follow_up_undone', targetType: 'profile', targetId: row.member_id as string, meta: { followUpId: id } })
  return { ok: true }
}
