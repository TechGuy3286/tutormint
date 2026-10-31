import 'server-only'

// lib/staffReceipt.ts — the I/O of lib/staffReceiptCore (owner, 31 Oct 2026).
//
//   staffReceiptCheck()   what the rule says for one receipt (no writes)
//   staffApproveReceipt() Backend Support approves a matched receipt: the same
//                         activatePayment as the Owner, the chosen credit
//                         linked, staff_approved_* stamped, audited.
//   markReceiptChecked()  "Checked for the owner" — a stamp, nothing activates.
//   loadStaffApprovals()  the Owner's "Approved by staff" list.
//   undoStaffApproval()   Owner only: back to pending — the badge and the
//                         revenue entry go, the credit link is soft-removed.
//   notifyStaffApprovalsDaily() the daily bell line for the Owner.
// Never logs a name, number or account.

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { notify } from '@/lib/notifications'
import { formatName } from '@/lib/formatName'
import { activatePayment } from '@/lib/payments/activate'
import { existingFeeFor, freeCredits, linkChosenCredit, loadFeeBoard, loadFeePrice, loadFeeRange, loadRefundDues } from '@/lib/feeMatch'
import { staffApprovalsDigest, staffReceiptDecision, type StaffReceiptDecision } from '@/lib/staffReceiptCore'
import type { AdminRole } from '@/lib/adminAccessCore'

type Actor = { id: string; adminRole: AdminRole; email: string | null }
const NOT_NOW = 'This is not working right now. Please try again in a few minutes.'

async function actorName(admin: NonNullable<ReturnType<typeof createAdminClient>>, id: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()
  return formatName((data?.full_name as string | null) ?? null) || null
}

export async function staffReceiptCheck(paymentId: string, actor: { id: string }): Promise<StaffReceiptDecision & { ref?: string; memberId?: string | null }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, reason: 'no_credit', message: NOT_NOW }
  const { data: p } = await admin
    .from('payments')
    .select('id, status, provider, plan_code, created_at, user_id, provider_ref')
    .eq('id', paymentId)
    .maybeSingle()
  if (!p) return { ok: false, reason: 'not_pending', message: 'Payment not found.' }
  const memberId = (p.user_id as string | null) ?? null
  const [{ data: prof }, { data: credit }, board, range, paid, refunds] = await Promise.all([
    memberId ? admin.from('profiles').select('full_name').eq('id', memberId).maybeSingle() : Promise.resolve({ data: null }),
    memberId ? admin.from('staff_signup_credits').select('staff_id').eq('member_id', memberId).maybeSingle() : Promise.resolve({ data: null }),
    loadFeeBoard(),
    loadFeeRange(),
    memberId ? existingFeeFor(memberId) : Promise.resolve(null),
    memberId ? loadRefundDues({ memberId, openOnly: true }) : Promise.resolve([]),
  ])
  const decision = staffReceiptDecision({
    payment: {
      status: (p.status as string | null) ?? null,
      provider: (p.provider as string | null) ?? null,
      planCode: (p.plan_code as string | null) ?? null,
      createdAt: (p.created_at as string | null) ?? null,
      memberId,
      memberName: formatName(((prof as { full_name?: string | null } | null)?.full_name as string | null) ?? null) || null,
    },
    credits: board ? freeCredits(board) : [],
    range,
    creditedToActor: (credit as { staff_id?: string | null } | null)?.staff_id === actor.id,
    alreadyPaid: !!paid,
    refundOpen: refunds.length > 0,
  })
  return { ...decision, ref: String(p.provider_ref ?? p.id), memberId }
}

export async function staffApproveReceipt(paymentId: string, actor: Actor): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const check = await staffReceiptCheck(paymentId, actor)
  if (!check.ok) {
    await logAdminAction({
      actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email,
      action: 'payment.staff_approve_refused', targetType: 'payment', targetId: paymentId,
      detail: { reason: check.reason },
    })
    return { ok: false, status: 403, error: check.message }
  }
  const result = await activatePayment({ paymentId, source: 'manual_approval', actor })
  if (!result.ok) return { ok: false, status: result.status, error: result.error }
  const link = await linkChosenCredit({ creditId: check.creditId, paymentId, feePrice: await loadFeePrice(), ref: check.ref ?? paymentId }, actor)
  const name = await actorName(admin, actor.id)
  await admin
    .from('payments')
    .update({ staff_approved_at: new Date().toISOString(), staff_approved_by: actor.id, staff_approved_by_name: name })
    .eq('id', paymentId)
  await logAdminAction({
    actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email,
    action: 'payment.staff_approve', targetType: 'payment', targetId: paymentId,
    detail: { creditId: check.creditId, linked: link.ok, rule: 'bank credit matched: fee range, 48 hours, sender name' },
  })
  return { ok: true }
}

export async function markReceiptChecked(paymentId: string, actor: Actor): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: p } = await admin.from('payments').select('id, status, provider').eq('id', paymentId).maybeSingle()
  if (!p) return { ok: false, status: 404, error: 'Payment not found.' }
  if (p.status !== 'pending' || p.provider !== 'manual') return { ok: false, status: 409, error: 'Only a bank-transfer receipt waiting for a decision can be marked checked.' }
  const name = await actorName(admin, actor.id)
  const { error } = await admin
    .from('payments')
    .update({ staff_checked_at: new Date().toISOString(), staff_checked_by: actor.id, staff_checked_by_name: name })
    .eq('id', paymentId)
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email,
    action: 'payment.receipt_checked', targetType: 'payment', targetId: paymentId, detail: {},
  })
  return { ok: true }
}

export type StaffApprovalRow = {
  id: string
  ref: string
  memberId: string | null
  memberName: string | null
  planCode: string | null
  staffName: string | null
  approvedAt: string
  undoneAt: string | null
}

export async function loadStaffApprovals(opts: { sinceIso?: string; untilIso?: string; includeUndone?: boolean } = {}): Promise<StaffApprovalRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  let q = admin
    .from('payments')
    .select('id, provider_ref, user_id, plan_code, staff_approved_at, staff_approved_by_name, staff_approval_undone_at')
    .not('staff_approved_at', 'is', null)
    .order('staff_approved_at', { ascending: false })
    .limit(500)
  if (opts.sinceIso) q = q.gte('staff_approved_at', opts.sinceIso)
  if (opts.untilIso) q = q.lt('staff_approved_at', opts.untilIso)
  if (!opts.includeUndone) q = q.is('staff_approval_undone_at', null)
  const { data } = await q
  const rows = (data ?? []) as Record<string, unknown>[]
  const ids = [...new Set(rows.map((r) => r.user_id as string | null).filter((x): x is string => !!x))]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: ps } = await admin.from('profiles').select('id, full_name').in('id', ids)
    for (const p of (ps ?? []) as { id: string; full_name: string | null }[]) names.set(p.id, formatName(p.full_name) || '')
  }
  return rows.map((r) => ({
    id: String(r.id),
    ref: String(r.provider_ref ?? r.id),
    memberId: (r.user_id as string | null) ?? null,
    memberName: r.user_id ? names.get(r.user_id as string) || null : null,
    planCode: (r.plan_code as string | null) ?? null,
    staffName: (r.staff_approved_by_name as string | null) ?? null,
    approvedAt: String(r.staff_approved_at),
    undoneAt: (r.staff_approval_undone_at as string | null) ?? null,
  }))
}

/** OWNER ONLY (the route checks): undo a staff approval. */
export async function undoStaffApproval(paymentId: string, reason: string, actor: Actor): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: p } = await admin
    .from('payments')
    .select('id, status, user_id, plan_code, staff_approved_at, staff_approval_undone_at')
    .eq('id', paymentId)
    .maybeSingle()
  if (!p) return { ok: false, status: 404, error: 'Payment not found.' }
  if (!p.staff_approved_at) return { ok: false, status: 409, error: 'This payment was not approved by staff.' }
  if (p.staff_approval_undone_at) return { ok: false, status: 409, error: 'This approval was already undone.' }
  const now = new Date().toISOString()

  // 1. The revenue entry: the payment is no longer approved.
  const { error } = await admin
    .from('payments')
    .update({ status: 'pending', reviewed_by: null, reviewed_at: null, rounding_pkr: null, staff_approval_undone_at: now, staff_approval_undone_by: actor.id, staff_approval_undo_reason: reason.slice(0, 500) })
    .eq('id', paymentId)
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  // 2. The credit link: soft-removed, so the credit is back in Needs attention.
  await admin.from('settlement_links').update({ removed_at: now }).eq('kind', 'receipt').eq('target', paymentId).is('removed_at', null)
  // 3. The badge / plan.
  const memberId = (p.user_id as string | null) ?? null
  let badgeRemoved = false
  if (memberId && p.plan_code === 'verified') {
    const other = await existingFeeFor(memberId)
    if (!other) {
      await admin.from('tutor_profiles').update({ verified_fee_paid_at: null }).eq('id', memberId)
      badgeRemoved = true
    }
  } else if (memberId) {
    await admin.from('subscriptions').update({ status: 'cancelled' }).eq('payment_id', paymentId).in('status', ['active', 'paused'])
    badgeRemoved = true
  }
  await logAdminAction({
    actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email,
    action: 'payment.staff_approve_undo', targetType: 'payment', targetId: paymentId,
    detail: { planCode: p.plan_code, badgeRemoved, reason: reason.slice(0, 300) },
  })
  return { ok: true }
}

const PKT_MS = 5 * 3_600_000

/** The Owner's daily bell line (daily cron): yesterday's staff approvals, once a day. */
export async function notifyStaffApprovalsDaily(now = new Date()): Promise<{ sent: boolean; count: number }> {
  const admin = createAdminClient()
  if (!admin) return { sent: false, count: 0 }
  const pk = new Date(now.getTime() + PKT_MS)
  const todayStartUtc = Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), pk.getUTCDate()) - PKT_MS
  const ydayStartUtc = todayStartUtc - 86_400_000
  const rows = await loadStaffApprovals({ sinceIso: new Date(ydayStartUtc).toISOString(), untilIso: new Date(todayStartUtc).toISOString() })
  if (rows.length === 0) return { sent: false, count: 0 }
  const { data: owners } = await admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner')
  const owner = (owners ?? [])[0]?.id as string | undefined
  if (!owner) return { sent: false, count: rows.length }
  const { data: already } = await admin
    .from('notifications')
    .select('id')
    .eq('user_id', owner)
    .eq('kind', 'staff_approvals_daily')
    .gte('created_at', new Date(todayStartUtc).toISOString())
    .limit(1)
  if ((already ?? []).length > 0) return { sent: false, count: rows.length }
  const label = new Date(ydayStartUtc + PKT_MS).toISOString().slice(0, 10)
  const d = staffApprovalsDigest(rows, label)
  await notify({ userId: owner, kind: 'staff_approvals_daily', title: d.title, body: d.body, href: '/admin/payments/staff-approved' })
  return { sent: true, count: rows.length }
}
