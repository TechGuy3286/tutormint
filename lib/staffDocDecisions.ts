import 'server-only'

// lib/staffDocDecisions.ts — the I/O of lib/docDecisionCore (owner, 5 Nov 2026).
//
//   captureDecisionState()   the item's state (profile columns, its documents,
//                            the selfie address, the photo record) — read
//                            before and after a staff decision
//   recordStaffDecision()    one row in staff_document_decisions
//   loadStaffDocDecisions()  the Owner's "Documents approved by staff" list
//   undoStaffDocDecision()   Owner only: the document goes back to waiting —
//                            its earlier state is written back, so any badge
//                            the decision gave is gone; logged
//   notifyStaffDocDecisionsDaily()  the Owner's daily bell line
//   markCnicNameMismatch()   "Name does not match" on a CNIC (Owner decides it)
// Never logs a name, number or document.

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { notify } from '@/lib/notifications'
import { formatName } from '@/lib/formatName'
import {
  DECISION_PROFILE_COLUMNS,
  DOC_LABEL,
  decisionChanged,
  stateChangedSince,
  staffDocDigest,
  type DecisionState,
} from '@/lib/docDecisionCore'
import type { AdminRole } from '@/lib/adminAccessCore'

type Actor = { id: string; adminRole: AdminRole; email: string | null }
type Item = 'cnic' | 'profile_pic' | 'selfie'
const NOT_NOW = 'This is not working right now. Please try again in a few minutes.'

async function nameOf(admin: NonNullable<ReturnType<typeof createAdminClient>>, id: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()
  return formatName((data?.full_name as string | null) ?? null) || null
}

export async function captureDecisionState(memberId: string, item: Item): Promise<DecisionState | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const cols = DECISION_PROFILE_COLUMNS[item]
  const { data: p } = await admin.from('profiles').select(cols.join(', ')).eq('id', memberId).maybeSingle()
  if (!p) return null
  const profile: Record<string, unknown> = {}
  for (const c of cols) profile[c] = (p as unknown as Record<string, unknown>)[c] ?? null
  const state: DecisionState = { profile, docs: {} }
  if (item !== 'profile_pic') {
    const { data: ds } = await admin.from('user_documents').select('id, status').eq('user_id', memberId).eq('kind', item)
    for (const d of (ds ?? []) as { id: string; status: string }[]) state.docs[d.id] = d.status
  }
  if (item === 'selfie') {
    const { data: tp } = await admin.from('tutor_profiles').select('selfie_url').eq('id', memberId).maybeSingle()
    state.selfieUrl = (tp?.selfie_url as string | null) ?? null
  }
  if (item === 'profile_pic') {
    const { data: r } = await admin.from('avatar_rotations').select('*').eq('user_id', memberId).maybeSingle()
    state.rotation = (r as Record<string, unknown> | null) ?? null
  }
  return state
}

export async function recordStaffDecision(args: {
  actor: Actor
  memberId: string
  memberRole: string | null
  item: Item
  decision: 'approve' | 'reject'
  rereview: boolean
  reason: string | null
  before: DecisionState
  after: DecisionState
}): Promise<void> {
  if (!decisionChanged(args.before, args.after)) return
  const admin = createAdminClient()
  if (!admin) return
  await admin.from('staff_document_decisions').insert({
    member_id: args.memberId,
    member_role: args.memberRole,
    item: args.item,
    decision: args.decision,
    rereview: args.rereview,
    reason: args.reason ? args.reason.slice(0, 500) : null,
    staff_id: args.actor.id,
    staff_name: await nameOf(admin, args.actor.id),
    staff_role: args.actor.adminRole,
    before_state: args.before,
    after_state: args.after,
  })
}

export type StaffDocDecisionRow = {
  id: string
  memberId: string
  memberName: string | null
  memberRole: string | null
  item: Item
  decision: 'approve' | 'reject'
  rereview: boolean
  reason: string | null
  staffName: string | null
  decidedAt: string
  undoneAt: string | null
  undoneByName: string | null
}

export async function loadStaffDocDecisions(opts: { sinceIso?: string; untilIso?: string; includeUndone?: boolean; staffId?: string } = {}): Promise<StaffDocDecisionRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  let q = admin
    .from('staff_document_decisions')
    .select('id, member_id, member_role, item, decision, rereview, reason, staff_name, staff_id, decided_at, undone_at, undone_by_name')
    .order('decided_at', { ascending: false })
    .limit(500)
  if (opts.sinceIso) q = q.gte('decided_at', opts.sinceIso)
  if (opts.untilIso) q = q.lt('decided_at', opts.untilIso)
  if (opts.staffId) q = q.eq('staff_id', opts.staffId)
  if (!opts.includeUndone) q = q.is('undone_at', null)
  const { data } = await q
  const rows = (data ?? []) as Record<string, unknown>[]
  const ids = [...new Set(rows.map((r) => r.member_id as string))]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: ps } = await admin.from('profiles').select('id, full_name').in('id', ids)
    for (const p of (ps ?? []) as { id: string; full_name: string | null }[]) names.set(p.id, formatName(p.full_name) || '')
  }
  return rows.map((r) => ({
    id: String(r.id),
    memberId: String(r.member_id),
    memberName: names.get(r.member_id as string) || null,
    memberRole: (r.member_role as string | null) ?? null,
    item: r.item as Item,
    decision: r.decision as 'approve' | 'reject',
    rereview: !!r.rereview,
    reason: (r.reason as string | null) ?? null,
    staffName: (r.staff_name as string | null) ?? null,
    decidedAt: String(r.decided_at),
    undoneAt: (r.undone_at as string | null) ?? null,
    undoneByName: (r.undone_by_name as string | null) ?? null,
  }))
}

/** OWNER ONLY (the route checks): the document goes back to waiting. */
export async function undoStaffDocDecision(
  decisionId: string,
  reason: string,
  actor: Actor,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: row } = await admin.from('staff_document_decisions').select('*').eq('id', decisionId).maybeSingle()
  if (!row) return { ok: false, status: 404, error: 'Decision not found.' }
  if (row.undone_at) return { ok: false, status: 409, error: 'This decision was already undone.' }
  const item = row.item as Item
  const memberId = row.member_id as string
  const before = row.before_state as DecisionState
  const after = row.after_state as DecisionState
  const now = await captureDecisionState(memberId, item)
  if (!now) return { ok: false, status: 404, error: 'That member was not found.' }
  if (stateChangedSince(after, now)) {
    return { ok: false, status: 409, error: 'This document has changed since. Check it on the member page instead.' }
  }

  // 1. The profile columns, exactly as before the decision.
  const { error } = await admin.from('profiles').update(before.profile).eq('id', memberId)
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  // 2. The documents' statuses (the approved one back on record, the new one waiting).
  for (const [id, status] of Object.entries(before.docs)) {
    if (now.docs[id] !== status) await admin.from('user_documents').update({ status }).eq('id', id)
  }
  // 3. The selfie address and the photo record.
  if (item === 'selfie' && 'selfieUrl' in before) {
    await admin.from('tutor_profiles').update({ selfie_url: before.selfieUrl ?? null }).eq('id', memberId)
  }
  if (item === 'profile_pic' && before.rotation) {
    await admin.from('avatar_rotations').upsert(before.rotation, { onConflict: 'user_id' })
  }

  const actorName = await nameOf(admin, actor.id)
  await admin
    .from('staff_document_decisions')
    .update({ undone_at: new Date().toISOString(), undone_by: actor.id, undone_by_name: actorName, undo_reason: reason.slice(0, 500) })
    .eq('id', decisionId)
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'document.staff_decision_undo',
    targetType: row.member_role === 'tutor' ? 'tutor_profile' : 'profile',
    targetId: memberId,
    detail: { item, decision: row.decision, staffName: row.staff_name, reason: reason.slice(0, 300) },
  })
  await notify({
    userId: memberId,
    kind: 'verification_pending',
    title: `We're checking your ${DOC_LABEL[item]} again`,
    body: `Your ${DOC_LABEL[item]} is waiting for review again. You don't need to do anything.`,
    href: row.member_role === 'tutor' ? '/tutor/dashboard' : '/parent/verify',
  })
  return { ok: true }
}

const PKT_MS = 5 * 3_600_000

/** Yesterday (Pakistan time) as [startIso, endIso, 'YYYY-MM-DD']. */
export function pkYesterday(now = new Date()): [string, string, string] {
  const pk = new Date(now.getTime() + PKT_MS)
  const todayStartUtc = Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), pk.getUTCDate()) - PKT_MS
  const ydayStartUtc = todayStartUtc - 86_400_000
  return [new Date(ydayStartUtc).toISOString(), new Date(todayStartUtc).toISOString(), new Date(ydayStartUtc + PKT_MS).toISOString().slice(0, 10)]
}

/** A Pakistan-time day 'YYYY-MM-DD' as [startIso, endIso]. */
export function pkDayRange(day: string): [string, string] | null {
  if (!/^\d{4}-\d\d-\d\d$/.test(day)) return null
  const start = Date.parse(`${day}T00:00:00Z`) - PKT_MS
  if (!Number.isFinite(start)) return null
  return [new Date(start).toISOString(), new Date(start + 86_400_000).toISOString()]
}

/** The Owner's daily bell line (daily cron): yesterday's staff document decisions, once a day. */
export async function notifyStaffDocDecisionsDaily(now = new Date()): Promise<{ sent: boolean; count: number }> {
  const admin = createAdminClient()
  if (!admin) return { sent: false, count: 0 }
  const [since, until, label] = pkYesterday(now)
  const rows = await loadStaffDocDecisions({ sinceIso: since, untilIso: until })
  if (rows.length === 0) return { sent: false, count: 0 }
  const { data: owners } = await admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner')
  const owner = (owners ?? [])[0]?.id as string | undefined
  if (!owner) return { sent: false, count: rows.length }
  const { data: already } = await admin
    .from('notifications')
    .select('id')
    .eq('user_id', owner)
    .eq('kind', 'staff_documents_daily')
    .gte('created_at', until)
    .limit(1)
  if ((already ?? []).length > 0) return { sent: false, count: rows.length }
  const d = staffDocDigest(rows, label)
  await notify({ userId: owner, kind: 'staff_documents_daily', title: d.title, body: d.body, href: `/admin/documents/staff-decisions?day=${label}` })
  return { sent: true, count: rows.length }
}

/** "Name does not match" (or clear it — the Owner only clears). */
export async function markCnicNameMismatch(memberId: string, mismatch: boolean, actor: Actor): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: p } = await admin.from('profiles').select('id, role').eq('id', memberId).maybeSingle()
  if (!p) return { ok: false, status: 404, error: 'That member was not found.' }
  const patch = mismatch
    ? { cnic_name_mismatch_at: new Date().toISOString(), cnic_name_mismatch_by: actor.id, cnic_name_mismatch_by_name: await nameOf(admin, actor.id) }
    : { cnic_name_mismatch_at: null, cnic_name_mismatch_by: null, cnic_name_mismatch_by_name: null }
  const { error } = await admin.from('profiles').update(patch).eq('id', memberId)
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: mismatch ? 'document.cnic_name_mismatch' : 'document.cnic_name_mismatch_clear',
    targetType: p.role === 'tutor' ? 'tutor_profile' : 'profile',
    targetId: memberId,
    detail: {},
  })
  return { ok: true }
}
