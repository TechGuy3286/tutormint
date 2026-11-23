import 'server-only'

// lib/memberClaims.ts — who is working on a member (owner, 23 Nov 2026 —
// PR-18 Parts B.4 and C.4). member_work_claims (migration 245), service role.
//
//   "I'm on it" (kind 'on_it') — on the admin member page and in the follow-up
//     mode. The first staff member to tap claims the member; everyone else
//     sees "<name> is on it". For a tutor in a followed-up People stage the
//     claim IS a follow-up of that stage (member_follow_ups channel 'claim'),
//     so the stage chip moves at once. The claimer can release it; only the
//     Owner can reassign it (or release someone else's).
//   Session holds (kind 'session') — the follow-up mode holds the tutor on
//     screen for 10 minutes (claim_follow_up_session, atomic in SQL).
//
// Ids, names of staff and times only; never a phone, email or message.

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { formatName } from '@/lib/formatName'
import type { AdminActor } from '@/lib/adminAuth'
import { recordPipelineFollowUp } from '@/lib/tutorPipelineRecord'
import { refreshPipelineRow, type PipelineRowUpdate } from '@/lib/tutorPipeline'
import { CLAIM_TTL_SECONDS } from '@/lib/followUpModeCore'

const BUSY = 'This is not working right now. Please try again in a few minutes.'

export type OnIt = { staffId: string; staffName: string; at: string }

async function staffNames(ids: string[]): Promise<Map<string, string>> {
  const admin = createAdminClient()
  if (!admin || ids.length === 0) return new Map()
  const { data } = await admin.from('profiles').select('id, full_name').in('id', [...new Set(ids)])
  return new Map((data ?? []).map((p) => [p.id as string, formatName((p.full_name as string | null) ?? '') || 'A staff member']))
}

/** The live "I'm on it" of each member. */
export async function liveOnIt(memberIds: string[]): Promise<Map<string, OnIt>> {
  const out = new Map<string, OnIt>()
  const admin = createAdminClient()
  if (!admin || memberIds.length === 0) return out
  const { data } = await admin
    .from('member_work_claims')
    .select('member_id, staff_id, claimed_at')
    .eq('kind', 'on_it')
    .is('released_at', null)
    .in('member_id', memberIds.slice(0, 500))
  const names = await staffNames((data ?? []).map((r) => r.staff_id as string))
  for (const r of data ?? []) out.set(r.member_id as string, { staffId: r.staff_id as string, staffName: names.get(r.staff_id as string) ?? 'A staff member', at: r.claimed_at as string })
  return out
}

export type ClaimResult =
  | { ok: true; onIt: OnIt; followUp: boolean; moved: PipelineRowUpdate | null }
  | { ok: false; status: number; error: string; onIt?: OnIt }

/** "I'm on it". The first tap wins; a second staff member gets who holds it. */
export async function claimOnIt(actor: AdminActor, memberId: string): Promise<ClaimResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: BUSY }
  const { data: member } = await admin.from('profiles').select('role').eq('id', memberId).maybeSingle()
  if (!member) return { ok: false, status: 404, error: 'That member was not found.' }
  const current = (await liveOnIt([memberId])).get(memberId)
  if (current) {
    if (current.staffId === actor.id) return { ok: true, onIt: current, followUp: false, moved: null }
    return { ok: false, status: 409, error: `${current.staffName} is on it.`, onIt: current }
  }
  const { error } = await admin.from('member_work_claims').insert({ member_id: memberId, staff_id: actor.id, kind: 'on_it' })
  if (error) {
    // Someone else tapped first (the partial unique index).
    const winner = (await liveOnIt([memberId])).get(memberId)
    return winner ? { ok: false, status: 409, error: `${winner.staffName} is on it.`, onIt: winner } : { ok: false, status: 500, error: 'That did not save. Please try again.' }
  }
  await logAdminAction({ actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email, action: 'member.on_it', targetType: 'profile', targetId: memberId, detail: {} })
  // A tutor in a followed-up stage: the claim counts as that stage's follow-up.
  let followUp = false
  let moved: PipelineRowUpdate | null = null
  if (member.role === 'tutor') {
    const r = await recordPipelineFollowUp({ memberId, kind: 'claim', actor, strict: false }).catch(() => null)
    if (r && r.ok) {
      followUp = true
      moved = r.moved
    }
  }
  const onIt = (await liveOnIt([memberId])).get(memberId) ?? { staffId: actor.id, staffName: 'You', at: new Date().toISOString() }
  return { ok: true, onIt, followUp, moved }
}

/** Release: the claimer, or the Owner for anyone's. */
export async function releaseOnIt(actor: AdminActor, memberId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: BUSY }
  const current = (await liveOnIt([memberId])).get(memberId)
  if (!current) return { ok: true }
  if (current.staffId !== actor.id && actor.adminRole !== 'owner') return { ok: false, status: 403, error: 'Only the Owner can change who is on it.' }
  await admin
    .from('member_work_claims')
    .update({ released_at: new Date().toISOString(), released_by: actor.id, release_reason: 'released' })
    .eq('member_id', memberId)
    .eq('kind', 'on_it')
    .is('released_at', null)
  await logAdminAction({ actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email, action: 'member.on_it_release', targetType: 'profile', targetId: memberId, detail: { from: current.staffId } })
  return { ok: true }
}

/** Owner only: hand the member to another staff member. */
export async function reassignOnIt(actor: AdminActor, memberId: string, staffId: string): Promise<{ ok: true; onIt: OnIt } | { ok: false; status: number; error: string }> {
  if (actor.adminRole !== 'owner') return { ok: false, status: 403, error: 'Only the Owner can change who is on it.' }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: BUSY }
  const { data: staff } = await admin.from('profiles').select('role, admin_role, is_suspended').eq('id', staffId).maybeSingle()
  if (!staff || staff.role !== 'admin' || !staff.admin_role || staff.is_suspended) return { ok: false, status: 400, error: 'Choose a working staff member.' }
  const current = (await liveOnIt([memberId])).get(memberId)
  const now = new Date().toISOString()
  if (current) {
    if (current.staffId === staffId) return { ok: true, onIt: current }
    await admin
      .from('member_work_claims')
      .update({ released_at: now, released_by: actor.id, release_reason: 'reassigned' })
      .eq('member_id', memberId)
      .eq('kind', 'on_it')
      .is('released_at', null)
  }
  const { error } = await admin.from('member_work_claims').insert({ member_id: memberId, staff_id: staffId, kind: 'on_it' })
  if (error) return { ok: false, status: 409, error: 'Someone else just took it. Refresh and try again.' }
  await logAdminAction({ actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email, action: 'member.on_it_reassign', targetType: 'profile', targetId: memberId, detail: { from: current?.staffId ?? null, to: staffId } })
  const onIt = (await liveOnIt([memberId])).get(memberId)
  return onIt ? { ok: true, onIt } : { ok: false, status: 500, error: 'That did not save. Please try again.' }
}

// ------------------------------------------------------------ sessions ---

/** Hold the first free tutor of `ids` (in order) for this staff member. */
export async function claimNextSession(staffId: string, ids: string[], stage: string): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin || ids.length === 0) return null
  const { data, error } = await admin.rpc('claim_follow_up_session', { p_staff: staffId, p_ids: ids.slice(0, 1000), p_stage: stage, p_ttl_seconds: CLAIM_TTL_SECONDS })
  if (error) {
    console.error(`[follow-up-mode] claim failed code=${error.code ?? '?'}`)
    return null
  }
  return (data as string | null) ?? null
}

/** Does this staff member hold the tutor right now (a live session, or their own I'm on it)? */
export async function holdsMember(staffId: string, memberId: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  const { data } = await admin
    .from('member_work_claims')
    .select('kind, expires_at')
    .eq('member_id', memberId)
    .eq('staff_id', staffId)
    .is('released_at', null)
  const now = Date.now()
  return (data ?? []).some((r) => r.kind === 'on_it' || (r.kind === 'session' && Date.parse(String(r.expires_at)) > now))
}

/** Someone else holds this tutor (a live session or their I'm on it). */
export async function heldByOther(staffId: string, memberId: string): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin.from('member_work_claims').select('staff_id, kind, expires_at').eq('member_id', memberId).is('released_at', null).neq('staff_id', staffId)
  const now = Date.now()
  const other = (data ?? []).find((r) => r.kind === 'on_it' || Date.parse(String(r.expires_at)) > now)
  if (!other) return null
  return (await staffNames([other.staff_id as string])).get(other.staff_id as string) ?? 'A staff member'
}

/** Let go of the tutor on screen (Skip or a recorded outcome). */
export async function releaseSession(staffId: string, memberId: string, reason: 'skip' | 'done'): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin
    .from('member_work_claims')
    .update({ released_at: new Date().toISOString(), released_by: staffId, release_reason: reason })
    .eq('member_id', memberId)
    .eq('staff_id', staffId)
    .eq('kind', 'session')
    .is('released_at', null)
}
